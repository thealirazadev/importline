import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface MappingRequest {
  mapping: Record<string, string | null>;
  delimiter?: string;
  encoding?: string;
  template_name?: string;
}

const VALID_FIELDS = new Set([
  "sku",
  "name",
  "price",
  "stock",
  "category",
  "description",
  "image_url",
]);
const VALID_DELIMITERS = [",", ";", "\t", "|"];
const VALID_ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "windows-1252"];
const REQUIRED_FIELDS = ["sku", "name", "price"];

export async function PUT(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const row = await prisma.import.findUnique({ where: { id: importId } });
    if (row === null) throw new ApiError("not_found", "That import does not exist.");

    const payload = (await _request.json()) as MappingRequest;
    const mapping = payload.mapping || {};
    const delimiter = payload.delimiter;
    const encoding = payload.encoding;
    const templateName = payload.template_name;

    // Validate mapping
    const fieldErrors: Record<string, string> = {};
    const headers = JSON.parse(row.headerJson) as string[];
    const headerSet = new Set(headers);

    for (const [field, header] of Object.entries(mapping)) {
      if (!VALID_FIELDS.has(field)) {
        fieldErrors[field] = `Unknown field: ${field}`;
      } else if (header && !headerSet.has(header)) {
        fieldErrors[field] = `Header "${header}" not found in file`;
      }
    }

    for (const required of REQUIRED_FIELDS) {
      if (!mapping[required]) {
        fieldErrors[required] = `${required} is required`;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      const details: Record<string, string> = fieldErrors;
      throw new ApiError("validation_failed", "Invalid mapping", details);
    }

    if (delimiter && !VALID_DELIMITERS.includes(delimiter)) {
      throw new ApiError("validation_failed", "Invalid delimiter");
    }

    if (encoding && !VALID_ENCODINGS.includes(encoding)) {
      throw new ApiError("validation_failed", "Invalid encoding");
    }

    // Transition to validating and enqueue job
    const updated = await prisma.import.update({
      where: { id: importId, state: { in: ["uploaded", "validated"] } },
      data: {
        mappingJson: JSON.stringify(mapping),
        delimiter: delimiter || row.delimiter,
        encoding: encoding || row.encoding,
        state: "validating",
        startedAt: new Date(),
      },
    });

    if (!updated) throw new ApiError("state_conflict", "Import state changed");

    // Enqueue validate job
    await prisma.job.create({
      data: {
        type: "validate",
        importId,
        state: "queued",
        runAfter: new Date(),
      },
    });

    // Save template if requested
    if (templateName) {
      const headerSignature = headers.sort().join("|");
      await prisma.mappingTemplate.upsert({
        where: { name: templateName },
        create: {
          name: templateName,
          mappingJson: JSON.stringify(mapping),
          headerSignature,
        },
        update: {
          mappingJson: JSON.stringify(mapping),
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
