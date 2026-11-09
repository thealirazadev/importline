import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { headerSignature, validateMapping } from "@/lib/import/mapping";
import { toImportDetail } from "@/lib/import/serialize";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface MappingRequest {
  mapping?: unknown;
  delimiter?: string;
  encoding?: string;
  save_template?: string;
  /** Accepted for older clients; `save_template` is the documented name. */
  template_name?: string;
}

const VALID_DELIMITERS = [",", ";", "\t", "|"];
const VALID_ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "windows-1252"];
const MAX_TEMPLATE_NAME = 128;

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const row = await prisma.import.findUnique({ where: { id: importId } });
    if (row === null) throw new ApiError("not_found", "That import does not exist.");

    let payload: MappingRequest;
    try {
      payload = (await request.json()) as MappingRequest;
    } catch {
      throw new ApiError("validation_failed", "The request body is not valid JSON.");
    }

    const headers = JSON.parse(row.headerJson) as string[];
    const result = validateMapping(headers, payload.mapping);
    if (result.errors) throw new ApiError("validation_failed", "Invalid mapping", result.errors);

    const details: Record<string, string> = {};
    if (payload.delimiter !== undefined && !VALID_DELIMITERS.includes(payload.delimiter)) {
      details.delimiter = "must be one of , ; tab |";
    }
    if (payload.encoding !== undefined && !VALID_ENCODINGS.includes(payload.encoding)) {
      details.encoding = `must be one of ${VALID_ENCODINGS.join(", ")}`;
    }
    const templateName = (payload.save_template ?? payload.template_name)?.trim() || null;
    if (templateName !== null && templateName.length > MAX_TEMPLATE_NAME) {
      details.save_template = `at most ${MAX_TEMPLATE_NAME} characters`;
    }
    if (Object.keys(details).length) {
      throw new ApiError("validation_failed", "Invalid mapping request", details);
    }

    const mappingJson = JSON.stringify(result.fieldMap);
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const moved = await tx.import.update({
          where: { id: importId, state: { in: ["uploaded", "validated"] } },
          data: {
            mappingJson,
            delimiter: payload.delimiter ?? row.delimiter,
            encoding: payload.encoding ?? row.encoding,
            state: "validating",
            startedAt: new Date(),
          },
        });
        await tx.job.create({
          data: { type: "validate", importId, state: "queued", runAfter: new Date() },
        });
        if (templateName !== null) {
          const signature = headerSignature(headers);
          await tx.mappingTemplate.upsert({
            where: { name: templateName },
            create: { name: templateName, mappingJson, headerSignature: signature },
            update: { mappingJson, headerSignature: signature, lastUsedAt: new Date() },
          });
        }
        return moved;
      });
    } catch (error) {
      // The guarded update matched no row: the import left uploaded/validated meanwhile.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new ApiError("state_conflict", `The import is ${row.state}; mapping is not allowed.`);
      }
      throw error;
    }

    logInfo("mapping.saved", { import_id: importId, template_name: templateName });
    return dataResponse(toImportDetail(updated));
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "PUT /api/imports/[id]/mapping" });
    return serverErrorResponse();
  }
}
