import { prisma } from "@/lib/db";
import { ApiError, listResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const exists = await prisma.import.findUnique({
      where: { id: importId },
      select: { id: true },
    });
    if (exists === null) throw new ApiError("not_found", "That import does not exist.");

    const url = new URL(request.url);
    const page = positiveInt(url.searchParams.get("page"), 1);
    const per_page = Math.min(100, positiveInt(url.searchParams.get("per_page"), 50));
    const severity = url.searchParams.get("severity");
    const code = url.searchParams.get("code");

    const where: { importId: number; severity?: string; code?: string } = { importId };
    if (severity) where.severity = severity;
    if (code) where.code = code;

    const total = await prisma.importRowError.count({ where });
    const errors = await prisma.importRowError.findMany({
      where,
      orderBy: { rowNumber: "asc" },
      skip: (page - 1) * per_page,
      take: per_page,
    });

    // docs/api-contracts.md shape; storage stays camelCase.
    const data = errors.map((e) => ({
      row_number: e.rowNumber,
      column: e.columnName,
      code: e.code,
      severity: e.severity,
      phase: e.phase,
      message: e.message,
    }));
    return listResponse(data, { page, per_page, total });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports/[id]/errors" });
    return serverErrorResponse();
  }
}

/** A positive integer query value, or the fallback for anything else (NaN, 0, "abc"). */
function positiveInt(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}
