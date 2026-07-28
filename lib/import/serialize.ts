import type { Import } from "@prisma/client";

/** API shapes for imports; see docs/api-contracts.md. Stored JSON columns are text. */

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toImportSummary(row: Import) {
  return {
    id: row.id,
    catalog_id: row.catalogId,
    source_label: row.sourceLabel,
    original_filename: row.originalFilename,
    file_size_bytes: row.fileSizeBytes,
    delimiter: row.delimiter,
    delimiter_uncertain: row.delimiterUncertain,
    encoding: row.encoding,
    state: row.state,
    total_rows: row.totalRows,
    processed_rows: row.processedRows,
    error_rows: row.errorRows,
    warning_rows: row.warningRows,
    dry_run: {
      would_create: row.wouldCreate,
      would_update: row.wouldUpdate,
      would_skip: row.wouldSkip,
    },
    result: {
      created: row.createdCount,
      updated: row.updatedCount,
      skipped: row.skippedCount,
    },
    batch_size: row.batchSize,
    last_committed_batch: row.lastCommittedBatch,
    failing_batch: row.failingBatch,
    pause_reason: row.pauseReason,
    started_at: row.startedAt?.toISOString() ?? null,
    finished_at: row.finishedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export function toImportDetail(row: Import) {
  return {
    ...toImportSummary(row),
    headers: parseJson<string[]>(row.headerJson, []),
    mapping: parseJson<Record<string, string> | null>(row.mappingJson, null),
  };
}
