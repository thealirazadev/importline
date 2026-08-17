import { prisma } from "@/lib/db";
import { logInfo, logError } from "@/lib/logger";
import { readRecords, csvOptionsFor, isBlankRecord } from "@/lib/csv/stream";
import { validateAndNormalizeRow, type Mapping } from "./row";

const ROW_LIMIT = 500_000;
const BATCH_SIZE = 500;
const SKU_CHUNK_SIZE = 1000;

export async function runValidationJob(importId: number): Promise<void> {
  const importRow = await prisma.import.findUnique({ where: { id: importId } });
  if (!importRow) {
    logError("validate.failed", new Error("Import not found"), { import_id: importId });
    return;
  }

  if (!importRow.mappingJson) {
    await prisma.import.update({
      where: { id: importId },
      data: { state: "failed", pauseReason: "no_mapping" },
    });
    logError("validate.failed", new Error("No mapping"), { import_id: importId });
    return;
  }

  const mapping = JSON.parse(importRow.mappingJson) as Mapping;
  const headers = JSON.parse(importRow.headerJson) as string[];

  try {
    // Clear any prior validation rows
    await prisma.importRowError.deleteMany({ where: { importId } });

    let rowNumber = 0;
    let errorRows = 0;
    let warningRows = 0;
    const errors: Array<{
      phase: string;
      rowNumber: number;
      columnName: string | null;
      code: string;
      severity: string;
      message: string;
    }> = [];
    const skuMap = new Map<string, { hash: string; rowNumber: number }>();

    const records = readRecords(importRow.storedPath, csvOptionsFor(importRow));

    for await (const record of records) {
      if (rowNumber >= ROW_LIMIT) {
        await prisma.import.update({
          where: { id: importId },
          data: { state: "failed", pauseReason: "row_limit_exceeded" },
        });
        logError("validate.failed", new Error("Row limit exceeded"), { import_id: importId });
        return;
      }

      // Skip header and blank rows
      if (record.rowNumber === 1 || isBlankRecord(record.cells)) {
        continue;
      }

      rowNumber++;

      // Check for cancel
      const check = await prisma.import.findUnique({ where: { id: importId } });
      if (check?.cancelRequested) {
        await prisma.import.update({
          where: { id: importId },
          data: { state: "cancelled" },
        });
        logInfo("import.cancelled", { import_id: importId });
        return;
      }

      // Convert cells array to object using headers
      const rawRow: Record<string, string> = {};
      headers.forEach((header, index) => {
        rawRow[header] = record.cells[index] || "";
      });

      const validation = validateAndNormalizeRow(
        rawRow,
        mapping,
        headers.length,
        record.cells.length,
      );

      if (!validation.ok) {
        errorRows++;
        for (const err of validation.errors) {
          errors.push({
            phase: "validate",
            rowNumber,
            columnName: err.field || null,
            code: err.code,
            severity: "error",
            message: err.message,
          });
        }
      } else {
        const normalized = validation.value;
        // Check for duplicate SKU
        const prior = skuMap.get(normalized.sku);
        if (prior) {
          warningRows++;
          errors.push({
            phase: "validate",
            rowNumber,
            columnName: "sku",
            code: "duplicate_sku",
            severity: "warning",
            message: `SKU "${normalized.sku}" seen at row ${prior.rowNumber}; last occurrence wins`,
          });
        }
        skuMap.set(normalized.sku, { hash: validation.hash, rowNumber });
      }

      // Write errors in batches
      if (errors.length >= BATCH_SIZE) {
        await prisma.importRowError.createMany({
          data: errors.map((e) => ({ ...e, importId })),
        });
        errors.length = 0;
      }
    }

    // Write remaining errors
    if (errors.length > 0) {
      await prisma.importRowError.createMany({
        data: errors.map((e) => ({ ...e, importId })),
      });
    }

    // Compute dry-run counts
    const skuList = Array.from(skuMap.keys());
    let wouldCreate = 0;
    let wouldUpdate = 0;
    let wouldSkip = 0;

    for (let i = 0; i < skuList.length; i += SKU_CHUNK_SIZE) {
      const chunk = skuList.slice(i, i + SKU_CHUNK_SIZE);
      const existing = await prisma.product.findMany({
        where: {
          catalogId: importRow.catalogId,
          sku: { in: chunk },
        },
        select: { sku: true, rowHash: true },
      });

      const existingMap = new Map(existing.map((p) => [p.sku, p.rowHash]));
      for (const sku of chunk) {
        const rowData = skuMap.get(sku);
        if (!rowData) continue; // Should never happen, but safe guard
        if (!existingMap.has(sku)) {
          wouldCreate++;
        } else if (existingMap.get(sku) === rowData.hash) {
          wouldSkip++;
        } else {
          wouldUpdate++;
        }
      }
    }

    // Transition to validated
    await prisma.import.update({
      where: { id: importId },
      data: {
        state: "validated",
        totalRows: rowNumber,
        errorRows,
        warningRows,
        wouldCreate,
        wouldUpdate,
        wouldSkip,
      },
    });

    logInfo("validate.completed", {
      import_id: importId,
      total_rows: rowNumber,
      error_rows: errorRows,
      would_create: wouldCreate,
      would_update: wouldUpdate,
      would_skip: wouldSkip,
    });
  } catch (error) {
    await prisma.import.update({
      where: { id: importId },
      data: { state: "failed", pauseReason: "validation_error" },
    });
    logError("validate.failed", error, { import_id: importId });
  }
}
