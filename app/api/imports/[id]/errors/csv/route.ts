import { prisma } from "@/lib/db";
import { ApiError, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Prefix to prevent CSV injection attacks
const CSV_INJECTION_PREFIX = "'";

function escapeCsvField(value: string | null): string {
  if (value === null || value === undefined) return "";
  const v = String(value);
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  if (v.match(/^[@=+-]/)) {
    return `${CSV_INJECTION_PREFIX}${v}`;
  }
  return v;
}

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

    const headers = ["row_number", "phase", "column_name", "code", "severity", "message"];
    const rows = errors.map((e) => [
      String(e.rowNumber),
      e.phase,
      e.columnName || "",
      e.code,
      e.severity,
      e.message,
    ]);

    let csv = headers.map(escapeCsvField).join(",") + "\n";
    for (const row of rows) {
      csv += row.map(escapeCsvField).join(",") + "\n";
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-${importId}-errors.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports/[id]/errors/csv" });
    return serverErrorResponse();
  }
}
