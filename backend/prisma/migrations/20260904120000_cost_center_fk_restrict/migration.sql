-- Fremdschluessel-Verhalten der Kostenstelle an das der Konten angleichen.
--
-- bookings.cost_center_id stand auf ON DELETE SET NULL (Prisma-Default fuer eine
-- optionale Relation). Damit haette ein Loeschen im Rennen mit einer gerade
-- entstehenden Buchung deren Kostenstelle STILL auf NULL gesetzt: kein Fehler,
-- keine Spur, ein stiller Datenverlust in Journal, DATEV-KOST1 und DMS-projektnr1.
--
-- RESTRICT laesst die Datenbank stattdessen scheitern (Prisma P2003). Die Route
-- faengt das ab und meldet dem Anwender, dass inzwischen gebucht wurde. Der
-- gleiche Schutz gilt fuer Konten seit 0001_init (bookings_account_id_fkey).
--
-- accounts.default_cost_center_id steht aus demselben Grund auf SET NULL und
-- wird mit gehaertet: die Anwendung blockiert diesen Fall zwar (Konten mit
-- Standard-Kostenstelle verhindern das Entfernen), aber die Pruefung liest und
-- loescht nicht in einer Transaktion. Setzt ein zweiter Admin die Kostenstelle
-- als Standard, waehrend der erste sie entfernt, faellt die Zuweisung sonst
-- still auf NULL — und die Vorbelegung der Buchungsmaske ist ohne Spur weg.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_cost_center_id_fkey";

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cost_center_id_fkey"
  FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounts" DROP CONSTRAINT "accounts_default_cost_center_id_fkey";

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_default_cost_center_id_fkey"
  FOREIGN KEY ("default_cost_center_id") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
