-- Belegarten pro Mandant (konfigurierbar)
CREATE TABLE "belegarten" (
  "id"         TEXT NOT NULL,
  "school_id"  TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "belegarten_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "belegarten_school_id_code_key" ON "belegarten"("school_id", "code");
CREATE INDEX "belegarten_school_id_sort_order_idx" ON "belegarten"("school_id", "sort_order");

ALTER TABLE "belegarten"
  ADD CONSTRAINT "belegarten_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Schools: DMS-Mandantennummer + Belegart-Defaults
ALTER TABLE "schools" ADD COLUMN "dms_mandanten_nummer" TEXT;
ALTER TABLE "schools" ADD COLUMN "belegart_default_id"  TEXT;
ALTER TABLE "schools" ADD COLUMN "belegart_required"    BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "schools"
  ADD CONSTRAINT "schools_belegart_default_id_fkey"
  FOREIGN KEY ("belegart_default_id") REFERENCES "belegarten"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Belege pro Buchung (1:n)
CREATE TABLE "booking_receipts" (
  "id"             TEXT NOT NULL,
  "booking_id"     TEXT NOT NULL,
  "belegart_id"    TEXT,
  "original_name"  TEXT NOT NULL,
  "mime_type"      TEXT NOT NULL,
  "size_bytes"     INTEGER NOT NULL,
  "storage_path"   TEXT NOT NULL,
  "sha256"         TEXT NOT NULL,
  "page_count"     INTEGER,
  "uploaded_by_id" TEXT NOT NULL,
  "uploaded_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"     TIMESTAMP(3),

  CONSTRAINT "booking_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_receipts_booking_id_idx" ON "booking_receipts"("booking_id");
CREATE INDEX "booking_receipts_sha256_idx" ON "booking_receipts"("sha256");

ALTER TABLE "booking_receipts"
  ADD CONSTRAINT "booking_receipts_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_receipts"
  ADD CONSTRAINT "booking_receipts_belegart_id_fkey"
  FOREIGN KEY ("belegart_id") REFERENCES "belegarten"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "booking_receipts"
  ADD CONSTRAINT "booking_receipts_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
