import { prisma } from "@/lib/db";
import { ApiError, listResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const PER_PAGE_MAX = 100;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const per_page = Number(url.searchParams.get("per_page") || "20");
    if (!Number.isInteger(page) || page < 1) {
      throw new ApiError("validation_failed", "Invalid pagination parameters.", {
        page: "page must be a positive integer.",
      });
    }
    if (!Number.isInteger(per_page) || per_page < 1 || per_page > PER_PAGE_MAX) {
      throw new ApiError("validation_failed", "Invalid pagination parameters.", {
        per_page: `per_page must be between 1 and ${PER_PAGE_MAX}.`,
      });
    }
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

    return listResponse(errors, { page, per_page, total });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "GET /api/imports/[id]/errors" });
    return serverErrorResponse();
  }
}
