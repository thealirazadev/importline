import { prisma } from "@/lib/db";
import { ApiError, errorResponse, serverErrorResponse } from "@/lib/errors";
import { csvCell } from "@/lib/csv/cell";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const PAGE = 1000;
const COLUMNS = ["row_number", "phase", "severity", "column", "code", "message"];

/** GET /api/imports/{id}/errors/csv: the row report, streamed page by page. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }
    const importRow = await prisma.import.findUnique({ where: { id: importId } });
    if (importRow === null) throw new ApiError("not_found", "That import does not exist.");

    const encoder = new TextEncoder();
    let cursor: number | undefined;
    let headerSent = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!headerSent) {
            headerSent = true;
            controller.enqueue(encoder.encode(COLUMNS.join(",") + "\n"));
            return;
          }
          const page = await prisma.importRowError.findMany({
            where: { importId },
            orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
            take: PAGE,
            ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
          });
          if (page.length === 0) {
            controller.close();
            return;
          }
          cursor = page[page.length - 1].id;
          const lines = page.map((e) =>
            [String(e.rowNumber), e.phase, e.severity, e.columnName, e.code, e.message]
              .map(csvCell)
              .join(","),
          );
          controller.enqueue(encoder.encode(lines.join("\n") + "\n"));
        } catch (error) {
          logError("api.failed", error, { route: "GET /api/imports/[id]/errors/csv" });
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
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
