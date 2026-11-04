import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError, logInfo } from "@/lib/logger";
import { checkMapping } from "@/lib/import/mapping";

export const dynamic = "force-dynamic";

interface MappingRequest {
  mapping?: unknown;
  delimiter?: string;
  encoding?: string;
  save_template?: string;
}

const VALID_DELIMITERS = [",", ";", "\t", "|"];
const VALID_ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "windows-1252"];
const TEMPLATE_NAME_MAX = 128;

async function readPayload(request: Request): Promise<MappingRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("validation_failed", "Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be a JSON object.");
  }
  return body as MappingRequest;
}

function parseTemplateName(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return null;
  if (name.length > TEMPLATE_NAME_MAX || /[\0/\\]/.test(name)) {
    throw new ApiError("validation_failed", "That template name cannot be used.", {
      save_template: `Use at most ${TEMPLATE_NAME_MAX} characters, without slashes or null bytes.`,
    });
  }
  return name;
}

export async function PUT(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const row = await prisma.import.findUnique({ where: { id: importId } });
    if (row === null) throw new ApiError("not_found", "That import does not exist.");

    const payload = await readPayload(_request);
    const delimiter = payload.delimiter;
    const encoding = payload.encoding;
    const templateName = parseTemplateName(payload.save_template);

    const headers = JSON.parse(row.headerJson) as string[];
    const checked = checkMapping(payload.mapping, headers);
    if (!checked.ok) {
      throw new ApiError("validation_failed", "Invalid mapping", checked.errors);
    }
    const mapping = checked.mapping;

    if (delimiter && !VALID_DELIMITERS.includes(delimiter)) {
      throw new ApiError("validation_failed", "Invalid delimiter");
    }

    if (encoding && !VALID_ENCODINGS.includes(encoding)) {
      throw new ApiError("validation_failed", "Invalid encoding");
    }

    // Transition and enqueue together, so the import can never sit in validating without a job.
    const transitioned = await prisma.$transaction(async (tx) => {
      const updated = await tx.import.updateMany({
        where: { id: importId, state: { in: ["uploaded", "validated"] } },
        data: {
          mappingJson: JSON.stringify(mapping),
          delimiter: delimiter || row.delimiter,
          encoding: encoding || row.encoding,
          state: "validating",
          startedAt: new Date(),
        },
      });
      if (updated.count === 0) return false;
      await tx.job.create({
        data: {
          type: "validate",
          importId,
          state: "queued",
          runAfter: new Date(),
        },
      });
      return true;
    });
    if (!transitioned) {
      throw new ApiError("state_conflict", "The mapping can only be changed before applying.", {
        state: row.state,
      });
    }

    // Save template if requested
    if (templateName) {
      const headerSignature = [...headers].sort().join("|");
      await prisma.mappingTemplate.upsert({
        where: { name: templateName },
        create: {
          name: templateName,
          mappingJson: JSON.stringify(mapping),
          headerSignature,
        },
        update: {
          mappingJson: JSON.stringify(mapping),
          headerSignature,
          lastUsedAt: new Date(),
        },
      });
    }

    logInfo("mapping.saved", { import_id: importId, template_name: templateName || null });

    return dataResponse({ ok: true });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "PUT /api/imports/[id]/mapping" });
    return serverErrorResponse();
  }
}
