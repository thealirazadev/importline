import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const row = await prisma.import.findUnique({ where: { id: importId } });
    if (row === null) throw new ApiError("not_found", "That import does not exist.");

    // docs/api-contracts.md: the lightweight poll payload.
    const validRows = (row.totalRows ?? 0) - row.errorRows;
    const applying = row.state === "applying";
    const status = {
      state: row.state,
      total_rows: row.totalRows,
      processed_rows: row.processedRows,
      current_batch: applying ? row.lastCommittedBatch + 1 : null,
      total_batches: row.totalRows === null ? null : Math.ceil(validRows / row.batchSize),
      dry_run: {
        would_create: row.wouldCreate,
        would_update: row.wouldUpdate,
        would_skip: row.wouldSkip,
      },
      result: { created: row.createdCount, updated: row.updatedCount, skipped: row.skippedCount },
      error_rows: row.errorRows,
      warning_rows: row.warningRows,
      pause_reason: row.pauseReason,
      cancel_requested: row.cancelRequested,
    };

    return dataResponse(status);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports/[id]/status" });
    return serverErrorResponse();
  }
}
