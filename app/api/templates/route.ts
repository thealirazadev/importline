import { prisma } from "@/lib/db";
import { dataResponse, serverErrorResponse } from "@/lib/errors";
import { type FieldMap, toHeaderMap } from "@/lib/import/mapping";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** GET /api/templates: saved mappings, most recently used first (docs/api-contracts.md). */
export async function GET() {
  try {
    const templates = await prisma.mappingTemplate.findMany({
      orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
    });
    return dataResponse(
      templates.map((t) => ({
        id: t.id,
        name: t.name,
        header_signature: t.headerSignature,
        mapping: toHeaderMap(JSON.parse(t.mappingJson) as FieldMap),
        last_used_at: t.lastUsedAt?.toISOString() ?? null,
      })),
    );
  } catch (error) {
    logError("api.failed", error, { route: "GET /api/templates" });
    return serverErrorResponse();
  }
}
