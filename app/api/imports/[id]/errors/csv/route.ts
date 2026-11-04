import { prisma } from "@/lib/db";
import { ApiError, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";
import { reportCsvLine } from "@/lib/csv/report";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const importRow = await prisma.import.findUnique({ where: { id: importId } });
    if (!importRow) throw new ApiError("not_found", "That import does not exist.");

    const errors = await prisma.importRowError.findMany({
      where: { importId },
      orderBy: { rowNumber: "asc" },
    });

    const headers = ["row_number", "phase", "severity", "column", "code", "message"];
    let csv = reportCsvLine(headers);
    for (const e of errors) {
      csv += reportCsvLine([e.rowNumber, e.phase, e.severity, e.columnName, e.code, e.message]);
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-${importId}-report.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports/[id]/errors/csv" });
    return serverErrorResponse();
  }
}
