-- Eigenbelege, die direkt im Kassenbuch erzeugt werden.
-- Die Tabelle haelt nur, was nicht in der Buchung steht (Gegenpartei, Grund,
-- Positionen). Das PDF selbst liegt als gewoehnlicher Eintrag in
-- "booking_receipts" und laeuft dadurch unveraendert in den DMS-Export.
CREATE TABLE "eigenbelege" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "positions" JSONB NOT NULL,
    "payee_signs" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eigenbelege_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eigenbelege_booking_id_key" ON "eigenbelege"("booking_id");
CREATE UNIQUE INDEX "eigenbelege_receipt_id_key" ON "eigenbelege"("receipt_id");

-- RESTRICT auf beiden Seiten: ein erzeugter Beleg darf weder mit der Buchung
-- noch mit der Belegdatei still verschwinden.
ALTER TABLE "eigenbelege"
  ADD CONSTRAINT "eigenbelege_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "eigenbelege"
  ADD CONSTRAINT "eigenbelege_receipt_id_fkey"
  FOREIGN KEY ("receipt_id") REFERENCES "booking_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aussteller der Belege (Rechtstraeger dieser Installation). Genau eine Zeile
-- mit id = 'default'. Bewusst ohne Vorbelegung: der Aussteller ist je
-- Mandanten-Stack verschieden und wird in der Mandantenverwaltung eingetragen.
CREATE TABLE "receipt_issuer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_issuer_pkey" PRIMARY KEY ("id")
);
