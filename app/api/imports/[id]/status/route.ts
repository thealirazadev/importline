import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface ImportStatus {
  id: number;
  state: string;
  processedRows: number;
  totalRows: number | null;
  errorRows: number;
  warningRows: number;
  wouldCreate: number | null;
  wouldUpdate: number | null;
  wouldSkip: number | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failingBatch: number | null;
  pauseReason: string | null;
  lastCommittedBatch: number;
  cancelRequested: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const row = await prisma.import.findUnique({ where: { id: importId } });
    if (row === null) throw new ApiError("not_found", "That import does not exist.");

    const status: ImportStatus = {
      id: row.id,
      state: row.state,
      processedRows: row.processedRows,
      totalRows: row.totalRows,
      errorRows: row.errorRows,
      warningRows: row.warningRows,
      wouldCreate: row.wouldCreate,
      wouldUpdate: row.wouldUpdate,
      wouldSkip: row.wouldSkip,
      createdCount: row.createdCount,
      updatedCount: row.updatedCount,
      skippedCount: row.skippedCount,
      failingBatch: row.failingBatch,
      pauseReason: row.pauseReason,
      lastCommittedBatch: row.lastCommittedBatch,
      cancelRequested: row.cancelRequested,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };

    return dataResponse(status);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports/[id]/status" });
    return serverErrorResponse();
  }
}
