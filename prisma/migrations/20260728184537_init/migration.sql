-- CreateTable
CREATE TABLE "catalogs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "catalog_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "row_hash" TEXT NOT NULL,
    "last_import_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "products_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "products_last_import_id_fkey" FOREIGN KEY ("last_import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "imports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "catalog_id" INTEGER NOT NULL,
    "source_label" TEXT,
    "original_filename" TEXT NOT NULL,
    "stored_path" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL,
    "delimiter_uncertain" BOOLEAN NOT NULL DEFAULT false,
    "encoding" TEXT NOT NULL,
    "header_json" TEXT NOT NULL,
    "mapping_json" TEXT,
    "state" TEXT NOT NULL,
    "total_rows" INTEGER,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "warning_rows" INTEGER NOT NULL DEFAULT 0,
    "would_create" INTEGER,
    "would_update" INTEGER,
    "would_skip" INTEGER,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "batch_size" INTEGER NOT NULL,
    "last_committed_batch" INTEGER NOT NULL DEFAULT 0,
    "failing_batch" INTEGER,
    "pause_reason" TEXT,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "started_at" DATETIME,
    "finished_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "imports_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "import_id" INTEGER NOT NULL,
    "batch_number" INTEGER NOT NULL,
    "first_row" INTEGER NOT NULL,
    "last_row" INTEGER NOT NULL,
    "created_count" INTEGER NOT NULL,
    "updated_count" INTEGER NOT NULL,
    "skipped_count" INTEGER NOT NULL,
    "applied_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "import_batches_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "import_row_errors" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "import_id" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "column_name" TEXT,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "import_row_errors_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "import_changes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "import_id" INTEGER NOT NULL,
    "batch_number" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fields_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "import_changes_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mapping_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "mapping_json" TEXT NOT NULL,
    "header_signature" TEXT NOT NULL,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "import_id" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_after" DATETIME NOT NULL,
    "locked_by" TEXT,
    "heartbeat_at" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "jobs_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "catalog_locks" (
    "catalog_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "import_id" INTEGER NOT NULL,
    "worker_id" TEXT NOT NULL,
    "acquired_at" DATETIME NOT NULL,
    "heartbeat_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "catalog_locks_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "catalog_locks_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "catalogs_name_key" ON "catalogs"("name");

-- CreateIndex
CREATE INDEX "products_catalog_id_updated_at_idx" ON "products"("catalog_id", "updated_at");

-- CreateIndex
CREATE INDEX "products_last_import_id_idx" ON "products"("last_import_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_catalog_id_sku_key" ON "products"("catalog_id", "sku");

-- CreateIndex
CREATE INDEX "imports_catalog_id_created_at_idx" ON "imports"("catalog_id", "created_at");

-- CreateIndex
CREATE INDEX "imports_state_idx" ON "imports"("state");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_import_id_batch_number_key" ON "import_batches"("import_id", "batch_number");

-- CreateIndex
CREATE INDEX "import_row_errors_import_id_row_number_idx" ON "import_row_errors"("import_id", "row_number");

-- CreateIndex
CREATE INDEX "import_row_errors_import_id_severity_idx" ON "import_row_errors"("import_id", "severity");

-- CreateIndex
CREATE INDEX "import_changes_import_id_id_idx" ON "import_changes"("import_id", "id");

-- CreateIndex
CREATE INDEX "import_changes_import_id_sku_idx" ON "import_changes"("import_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_templates_name_key" ON "mapping_templates"("name");

-- CreateIndex
CREATE INDEX "mapping_templates_header_signature_idx" ON "mapping_templates"("header_signature");

-- CreateIndex
CREATE INDEX "jobs_state_run_after_idx" ON "jobs"("state", "run_after");
