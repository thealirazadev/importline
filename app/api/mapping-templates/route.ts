import { prisma } from "@/lib/db";
import { dataResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const templates = await prisma.mappingTemplate.findMany({
      orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
    });
    return dataResponse(templates);
  } catch (error) {
    logError("api.failed", error, { route: "GET /api/mapping-templates" });
    return serverErrorResponse();
  }
}
