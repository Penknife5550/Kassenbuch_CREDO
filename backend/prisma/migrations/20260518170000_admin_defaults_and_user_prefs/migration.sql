-- Punkt 1: Buchungsdatum-Default pro Mandant konfigurierbar
CREATE TYPE "BookingDateMode" AS ENUM ('TODAY', 'EMPTY');

ALTER TABLE "schools" ADD COLUMN "default_booking_date_mode" "BookingDateMode" NOT NULL DEFAULT 'TODAY';

-- Punkt 3: Standard-Kostenstelle pro Konto
ALTER TABLE "accounts" ADD COLUMN "default_cost_center_id" TEXT;

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_default_cost_center_id_fkey"
  FOREIGN KEY ("default_cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Punkt 5: Spaltenreihenfolge pro Benutzer
ALTER TABLE "users" ADD COLUMN "table_column_order" JSONB;
