import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";
import { csvOptionsFor, readPreview } from "@/lib/csv/stream";

export const dynamic = "force-dynamic";

const PREVIEW_ROWS = 20;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }
    const row = await prisma.import.findUnique({ where: { id: importId } });
    if (row === null) throw new ApiError("not_found", "That import does not exist.");

    const preview = await readPreview(row.storedPath, {
      ...csvOptionsFor(row),
      rows: PREVIEW_ROWS,
    });
    return dataResponse({ headers: preview.headers, rows: preview.rows });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports/[id]/preview" });
    return serverErrorResponse();
  }
}
