-- Index fuer die Frage "gibt es zu dieser Buchung schon einen Storno?".
-- Der Storno stellt sie seit 9a7be90 innerhalb seiner Serializable-Transaktion.
-- Ohne Index liest PostgreSQL dafuer die ganze Tabelle und merkt sich die
-- Lesesperre auf alle Buchungen: jede gleichzeitige Buchung irgendeines
-- Mandanten wird dann zum moeglichen Konfliktpartner. Mit Index ist es ein
-- gezielter Zugriff. Er bedient auch das Nachladen der Stornos zu einer Buchung.
CREATE INDEX "bookings_storno_of_id_idx" ON "bookings"("storno_of_id");
