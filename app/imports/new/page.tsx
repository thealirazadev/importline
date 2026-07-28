import Link from "next/link";
import { prisma } from "@/lib/db";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function NewImportPage() {
  const catalogs = await prisma.catalog.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New import</h1>
      {catalogs.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          No catalogs exist yet. Run the seed script to create the default catalog.
        </p>
      ) : (
        <UploadForm catalogs={catalogs} />
      )}
      <p>
        <Link href="/imports" className="text-accent">
          Back to imports
        </Link>
      </p>
    </div>
  );
}
