import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  ApiError,
  dataResponse,
  errorResponse,
  listResponse,
  serverErrorResponse,
} from "@/lib/errors";
import { logError, logInfo } from "@/lib/logger";
import { detectFromSample } from "@/lib/csv/detect";
import { toImportSummary } from "@/lib/import/serialize";
import { MalformedUploadError, UploadTooLargeError, receiveUpload } from "@/lib/upload";

export const dynamic = "force-dynamic";

const SOURCE_LABEL_MAX = 128;
const FILENAME_MAX = 255;
const PER_PAGE_DEFAULT = 50;
const PER_PAGE_MAX = 200;

function parsePagination(url: URL): { page: number; perPage: number } {
  const page = Number(url.searchParams.get("page") ?? 1);
  const perPage = Number(url.searchParams.get("per_page") ?? PER_PAGE_DEFAULT);
  if (!Number.isInteger(page) || page < 1) {
    throw new ApiError("validation_failed", "Invalid pagination parameters.", {
      page: "page must be a positive integer.",
    });
  }
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > PER_PAGE_MAX) {
    throw new ApiError("validation_failed", "Invalid pagination parameters.", {
      per_page: `per_page must be between 1 and ${PER_PAGE_MAX}.`,
    });
  }
  return { page, perPage };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { page, perPage } = parsePagination(url);

    const catalogParam = url.searchParams.get("catalog_id");
    const stateParam = url.searchParams.get("state");
    const where: { catalogId?: number; state?: string } = {};
    if (catalogParam !== null) {
      const catalogId = Number(catalogParam);
      if (!Number.isInteger(catalogId) || catalogId < 1) {
        throw new ApiError("validation_failed", "Invalid catalog filter.", {
          catalog_id: "catalog_id must be a positive integer.",
        });
      }
      where.catalogId = catalogId;
    }
    if (stateParam !== null && stateParam !== "") where.state = stateParam;

    const [rows, total] = await Promise.all([
      prisma.import.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.import.count({ where }),
    ]);

    return listResponse(rows.map(toImportSummary), { page, per_page: perPage, total });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports" });
    return serverErrorResponse();
  }
}

/** Display-only: control characters and path separators are stripped before storage. */
function safeFilename(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[/\\]/g, "_")
    .trim();
  return (cleaned.length > 0 ? cleaned : "upload.csv").slice(0, FILENAME_MAX);
}

function parseCatalogId(raw: string | undefined): number {
  const value = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isInteger(value) || value < 1) {
    throw new ApiError("validation_failed", "A catalog is required.", {
      catalog_id: "Provide the id of an existing catalog.",
    });
  }
  return value;
}

function parseSourceLabel(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === "") return null;
  if (value.length > SOURCE_LABEL_MAX || value.includes("\0")) {
    throw new ApiError("validation_failed", "That source label cannot be used.", {
      source_label: `Use at most ${SOURCE_LABEL_MAX} characters.`,
    });
  }
  return value;
}

export async function POST(request: Request) {
  const dataDir = env.IMPORTLINE_DATA_DIR;
  const tempDir = path.join(dataDir, "tmp");
  let tempPath: string | null = null;

  try {
    const contentType = request.headers.get("content-type");
    if (contentType === null || !contentType.toLowerCase().includes("multipart/form-data")) {
      throw new ApiError("unsupported_media_type", "Send the CSV as multipart/form-data.");
    }

    const upload = await receiveUpload(request, {
      tempDir,
      maxBytes: env.IMPORT_MAX_FILE_MB * 1024 * 1024,
    });
    tempPath = upload.file?.tempPath ?? null;

    if (upload.file === null || upload.file.sizeBytes === 0) {
      throw new ApiError("validation_failed", "Attach a CSV file to upload.", {
        file: "A non-empty CSV file is required.",
      });
    }
    const catalogId = parseCatalogId(upload.fields.catalog_id);
    const sourceLabel = parseSourceLabel(upload.fields.source_label);

    const catalog = await prisma.catalog.findUnique({ where: { id: catalogId } });
    if (catalog === null) {
      throw new ApiError("validation_failed", "That catalog does not exist.", {
        catalog_id: "Unknown catalog.",
      });
    }

    const detection = detectFromSample(upload.file.sample);
    const created = await prisma.import.create({
      data: {
        catalogId,
        sourceLabel,
        originalFilename: safeFilename(upload.file.originalFilename),
        storedPath: upload.file.tempPath,
        fileSizeBytes: upload.file.sizeBytes,
        fileSha256: upload.file.sha256,
        delimiter: detection.delimiter,
        delimiterUncertain: detection.delimiterUncertain,
        encoding: detection.encoding,
        headerJson: JSON.stringify(detection.headers),
        state: "uploaded",
        batchSize: env.IMPORT_BATCH_SIZE,
      },
    });

    await mkdir(dataDir, { recursive: true });
    const storedPath = path.join(dataDir, `${created.id}-${upload.file.sha256.slice(0, 12)}.csv`);
    try {
      await rename(upload.file.tempPath, storedPath);
    } catch (error) {
      await prisma.import.delete({ where: { id: created.id } }).catch(() => undefined);
      throw error;
    }
    tempPath = null;
    const stored = await prisma.import.update({
      where: { id: created.id },
      data: { storedPath },
    });

    logInfo("import.uploaded", {
      import_id: stored.id,
      catalog_id: catalogId,
      size_bytes: stored.fileSizeBytes,
    });
    logInfo("import.detected", {
      import_id: stored.id,
      encoding: stored.encoding,
      delimiter: stored.delimiter,
      delimiter_uncertain: stored.delimiterUncertain,
      headers: detection.headers.length,
    });

    return dataResponse(
      {
        id: stored.id,
        catalog_id: stored.catalogId,
        source_label: stored.sourceLabel,
        original_filename: stored.originalFilename,
        file_size_bytes: stored.fileSizeBytes,
        file_sha256: stored.fileSha256,
        delimiter: stored.delimiter,
        delimiter_uncertain: stored.delimiterUncertain,
        encoding: stored.encoding,
        headers: detection.headers,
        state: stored.state,
        matched_template: null,
        created_at: stored.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    if (tempPath !== null) await unlink(tempPath).catch(() => undefined);
    if (error instanceof UploadTooLargeError) {
      return errorResponse(
        new ApiError("file_too_large", `Uploads are limited to ${env.IMPORT_MAX_FILE_MB} MB.`, {
          max_mb: env.IMPORT_MAX_FILE_MB,
        }),
      );
    }
    if (error instanceof MalformedUploadError) {
      return errorResponse(
        new ApiError("unsupported_media_type", "Send the CSV as multipart/form-data."),
      );
    }
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "POST /api/imports" });
    return serverErrorResponse();
  }
}
