import { prisma } from "@/lib/db";
import { ApiError, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";
import { reportCsvLine } from "@/lib/csv/report";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const HEADERS = ["row_number", "phase", "severity", "column", "code", "message"];

/** Streams the report a page at a time, so a 500k-row report never sits in memory at once. */
function reportStream(importId: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor: number | null = null;
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(reportCsvLine(HEADERS)));
          return;
        }
        const page = await prisma.importRowError.findMany({
          where: { importId },
          orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
          take: PAGE_SIZE,
          ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
        let chunk = "";
        for (const e of page) {
          chunk += reportCsvLine([
            e.rowNumber,
            e.phase,
            e.severity,
            e.columnName,
            e.code,
            e.message,
          ]);
        }
        if (chunk.length > 0) controller.enqueue(encoder.encode(chunk));
        if (page.length < PAGE_SIZE) controller.close();
        else cursor = page[page.length - 1].id;
      } catch (error) {
        logError("api.failed", error, {
          route: "GET /api/imports/[id]/errors/csv",
          import_id: importId,
        });
        controller.error(error);
      }
    },
  });
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

    return new NextResponse(reportStream(importId), {
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
