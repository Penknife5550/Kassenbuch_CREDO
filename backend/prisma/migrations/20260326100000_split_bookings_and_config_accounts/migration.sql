-- Feature 2: Konfigurierbare Konten für Anfangsbestand und Kassendifferenz pro Schule
ALTER TABLE "schools" ADD COLUMN "anfangsbestand_account_id" TEXT;
ALTER TABLE "schools" ADD COLUMN "kassendifferenz_account_id" TEXT;

ALTER TABLE "schools" ADD CONSTRAINT "schools_anfangsbestand_account_id_fkey"
  FOREIGN KEY ("anfangsbestand_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "schools" ADD CONSTRAINT "schools_kassendifferenz_account_id_fkey"
  FOREIGN KEY ("kassendifferenz_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Feature 4: Splittbuchungen
ALTER TABLE "bookings" ADD COLUMN "split_group_id" TEXT;

-- Remove unique constraint on [school_id, receipt_number] to allow split bookings
-- (multiple booking lines can share the same receipt number within a split group)
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_school_id_receipt_number_key";

-- Add index for efficient split group lookups
CREATE INDEX "bookings_split_group_id_idx" ON "bookings"("split_group_id");
