import { prisma } from "@/lib/db";
import { ApiError, listResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface ErrorQuery {
  page?: string;
  per_page?: string;
  severity?: string;
  code?: string;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const importId = Number(id);
    if (!Number.isInteger(importId) || importId < 1) {
      throw new ApiError("not_found", "That import does not exist.");
    }

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const per_page = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page") || "20")));
    const severity = url.searchParams.get("severity");
    const code = url.searchParams.get("code");

    const where: any = { importId };
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
