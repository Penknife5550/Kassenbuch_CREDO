ALTER TABLE "daily_closings" ADD COLUMN "comment" TEXT;
ALTER TABLE "daily_closings" ADD COLUMN "correction_booking_id" TEXT;
ALTER TABLE "daily_closings" ADD COLUMN "denomination_counts" JSONB;
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_correction_booking_id_fkey"
  FOREIGN KEY ("correction_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_correction_booking_id_key" UNIQUE ("correction_booking_id");
