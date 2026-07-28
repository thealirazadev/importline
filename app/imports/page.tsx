import Link from "next/link";
import { prisma } from "@/lib/db";
import { StateBadge } from "@/components/StateBadge";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ImportsPage() {
  const imports = await prisma.import.findMany({
    orderBy: { id: "desc" },
    take: PAGE_SIZE,
    include: { catalog: { select: { name: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Imports</h1>
        <Link
          href="/imports/new"
          className="rounded-card bg-accent px-4 py-2 font-medium text-white"
        >
          New import
        </Link>
      </div>

      {imports.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          No imports yet. Start your first import.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[0.8125rem] font-medium text-muted">
                <th scope="col" className="px-3 py-2">
                  Id
                </th>
                <th scope="col" className="px-3 py-2">
                  Source
                </th>
                <th scope="col" className="px-3 py-2">
                  File
                </th>
                <th scope="col" className="px-3 py-2">
                  Catalog
                </th>
                <th scope="col" className="px-3 py-2">
                  State
                </th>
                <th scope="col" className="px-3 py-2">
                  Rows
                </th>
                <th scope="col" className="px-3 py-2">
                  Created / updated / skipped
                </th>
                <th scope="col" className="px-3 py-2">
                  Errors
                </th>
                <th scope="col" className="px-3 py-2">
                  Uploaded
                </th>
              </tr>
            </thead>
            <tbody>
              {imports.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono">{row.id}</td>
                  <td className="px-3 py-2">{row.sourceLabel ?? "-"}</td>
                  <td className="px-3 py-2 font-mono">{row.originalFilename}</td>
                  <td className="px-3 py-2">{row.catalog.name}</td>
                  <td className="px-3 py-2">
                    <StateBadge state={row.state} />
                  </td>
                  <td className="px-3 py-2">{row.totalRows ?? "-"}</td>
                  <td className="px-3 py-2 font-mono">
                    {row.createdCount} / {row.updatedCount} / {row.skippedCount}
                  </td>
                  <td className="px-3 py-2">{row.errorRows}</td>
                  <td className="px-3 py-2 text-muted">{row.createdAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
