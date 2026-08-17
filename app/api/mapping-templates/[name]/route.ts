import { prisma } from "@/lib/db";
import { dataResponse, errorResponse, serverErrorResponse, ApiError } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await context.params;
    if (!name) {
      throw new ApiError("not_found", "Template not found");
    }

    const deleted = await prisma.mappingTemplate.delete({ where: { name } });
    if (!deleted) throw new ApiError("not_found", "Template not found");

    return dataResponse({ ok: true });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof Error && error.message.includes("not found")) {
      return errorResponse(new ApiError("not_found", "Template not found"));
    }
    logError("api.failed", error, { route: "DELETE /api/mapping-templates/[name]" });
    return serverErrorResponse();
  }
}
