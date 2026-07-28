import { prisma } from "@/lib/db";
import { ApiError, dataResponse, errorResponse, serverErrorResponse } from "@/lib/errors";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const NAME_MAX = 128;

function parseName(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be a JSON object.");
  }
  const keys = Object.keys(body as Record<string, unknown>);
  const unknown = keys.filter((key) => key !== "name");
  if (unknown.length > 0) {
    throw new ApiError("validation_failed", "Unknown fields in request body.", {
      unknown_fields: unknown,
    });
  }
  const raw = (body as Record<string, unknown>).name;
  if (typeof raw !== "string") {
    throw new ApiError("validation_failed", "A catalog name is required.", {
      name: "Provide a name between 1 and 128 characters.",
    });
  }
  const name = raw.trim();
  if (name.length < 1 || name.length > NAME_MAX) {
    throw new ApiError("validation_failed", "A catalog name is required.", {
      name: "Provide a name between 1 and 128 characters.",
    });
  }
  if (/[\0/\\]/.test(name)) {
    throw new ApiError("validation_failed", "That catalog name contains invalid characters.", {
      name: "Slashes and null bytes are not allowed.",
    });
  }
  return name;
}

export async function GET() {
  try {
    const catalogs = await prisma.catalog.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return dataResponse(
      catalogs.map((catalog) => ({
        id: catalog.id,
        name: catalog.name,
        product_count: catalog._count.products,
      })),
    );
  } catch (error) {
    logError("api.failed", error, { route: "GET /api/catalogs" });
    return serverErrorResponse();
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("validation_failed", "Request body must be valid JSON.");
    }
    const name = parseName(body);

    const existing = await prisma.catalog.findUnique({ where: { name } });
    if (existing) {
      throw new ApiError("validation_failed", "A catalog with that name already exists.", {
        name: "This name is taken.",
      });
    }

    const catalog = await prisma.catalog.create({ data: { name } });
    return dataResponse({ id: catalog.id, name: catalog.name, product_count: 0 }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api.failed", error, { route: "POST /api/catalogs" });
    return serverErrorResponse();
  }
}
