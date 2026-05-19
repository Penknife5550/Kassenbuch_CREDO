-- Enums für das konfigurierbare DMS-Feldmapping
CREATE TYPE "FieldSource" AS ENUM ('BOOKING_FIELD', 'CONSTANT');

CREATE TYPE "BookingField" AS ENUM (
  'BOOKING_DATE',
  'RECEIPT_NUMBER',
  'AMOUNT',
  'DEBIT_CREDIT',
  'ACCOUNT_NUMBER',
  'ACCOUNT_NAME',
  'COUNTER_ACCOUNT_NUMBER',
  'COUNTER_ACCOUNT_NAME',
  'COST_CENTER_CODE',
  'COST_CENTER_NAME',
  'DESCRIPTION',
  'TAX_KEY',
  'BELEGART_CODE',
  'BELEGART_LABEL',
  'SCHOOL_NAME',
  'SCHOOL_CODE',
  'DMS_MANDANTEN_NR',
  'DATEV_MANDANTEN_NR',
  'CREATED_BY',
  'FILE_INDEX'
);

CREATE TYPE "FieldFormat" AS ENUM (
  'RAW',
  'DATE_DDMMYYYY',
  'DATE_ISO',
  'DATE_YYYYMMDD',
  'NUMBER_DE',
  'NUMBER_DE_CURRENCY',
  'NUMBER_DOT',
  'UPPER',
  'LOWER'
);

-- Mapping-Tabelle pro Schule
CREATE TABLE "dms_field_mappings" (
  "id"                   TEXT          NOT NULL,
  "school_id"            TEXT          NOT NULL,
  "source"               "FieldSource" NOT NULL,
  "bookingField"         "BookingField",
  "constant_value"       TEXT,
  "dms_key"              TEXT          NOT NULL,
  "format"               "FieldFormat",
  "max_length"           INTEGER,
  "sort_order"           INTEGER       NOT NULL DEFAULT 0,
  "is_active"            BOOLEAN       NOT NULL DEFAULT true,
  "include_on_separator" BOOLEAN       NOT NULL DEFAULT true,
  "created_at"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "dms_field_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dms_field_mappings_school_id_dms_key_key"
  ON "dms_field_mappings"("school_id", "dms_key");

CREATE INDEX "dms_field_mappings_school_id_sort_order_idx"
  ON "dms_field_mappings"("school_id", "sort_order");

ALTER TABLE "dms_field_mappings"
  ADD CONSTRAINT "dms_field_mappings_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Konsistenz: source=BOOKING_FIELD braucht bookingField, source=CONSTANT braucht constant_value
ALTER TABLE "dms_field_mappings"
  ADD CONSTRAINT "dms_field_mappings_source_payload_chk"
  CHECK (
    (source = 'BOOKING_FIELD' AND "bookingField" IS NOT NULL) OR
    (source = 'CONSTANT'      AND "constant_value" IS NOT NULL)
  );
