import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/templates/{id}: `{ deleted: true }`, or 404 when it does not exist. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const templateId = Number(id);
    if (!Number.isInteger(templateId) || templateId < 1) {
      throw new ApiError("not_found", "That template does not exist.");
    }
    try {
      await prisma.mappingTemplate.delete({ where: { id: templateId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new ApiError("not_found", "That template does not exist.");
      }
      throw error;
    }
    return dataResponse({ deleted: true });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "DELETE /api/templates/[id]" });
    return serverErrorResponse();
  }
}
