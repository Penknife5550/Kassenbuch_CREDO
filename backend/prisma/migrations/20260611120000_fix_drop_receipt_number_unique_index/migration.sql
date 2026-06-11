-- Fix: 20260326100000_split_bookings_and_config_accounts wollte die Eindeutigkeit
-- von (school_id, receipt_number) entfernen, nutzte aber DROP CONSTRAINT.
-- 0001_init hat sie als eigenständigen UNIQUE INDEX angelegt — den entfernt
-- DROP CONSTRAINT in PostgreSQL nicht, und IF EXISTS verschluckte den Fehler.
-- Folge: Splittbuchungen (mehrere Zeilen mit gleicher Belegnummer) scheiterten
-- in Produktion mit P2002.

-- Reihenfolge wichtig: Falls die Eindeutigkeit doch als Constraint existiert,
-- zuerst Constraint entfernen (nimmt den Index mit); danach den Index-Fall abräumen.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_school_id_receipt_number_key";
DROP INDEX IF EXISTS "bookings_school_id_receipt_number_key";
