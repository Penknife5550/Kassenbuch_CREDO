import { BookingField, DmsFieldMapping, FieldFormat, FieldSource, Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { decimalToNumber } from '../utils/decimal';

// ─── Default-Mapping (verbindlich) ──────────────────────────────────────────
// Quelle: BELEGE_PLAN.html §5.4 — abgestimmt mit den DMS-Feldnamen.
export interface DefaultMappingRow {
  source: FieldSource;
  bookingField: BookingField | null;
  constantValue: string | null;
  dmsKey: string;
  format: FieldFormat | null;
  maxLength: number | null;
  sortOrder: number;
  includeOnSeparator: boolean;
}

export const DEFAULT_DMS_MAPPING: DefaultMappingRow[] = [
  { sortOrder: 10, source: 'BOOKING_FIELD', bookingField: 'DMS_MANDANTEN_NR',  constantValue: null, dmsKey: 'mandant',          format: 'RAW',           maxLength: null, includeOnSeparator: true },
  { sortOrder: 20, source: 'BOOKING_FIELD', bookingField: 'BELEGART_CODE',     constantValue: null, dmsKey: 'dokumentart',      format: 'RAW',           maxLength: null, includeOnSeparator: true },
  { sortOrder: 30, source: 'BOOKING_FIELD', bookingField: 'BOOKING_DATE',      constantValue: null, dmsKey: 'datumindokument1', format: 'DATE_DDMMYYYY', maxLength: null, includeOnSeparator: true },
  { sortOrder: 40, source: 'BOOKING_FIELD', bookingField: 'AMOUNT',            constantValue: null, dmsKey: 'betagsumme',       format: 'NUMBER_DE',     maxLength: null, includeOnSeparator: true },
  { sortOrder: 50, source: 'BOOKING_FIELD', bookingField: 'COST_CENTER_CODE',  constantValue: null, dmsKey: 'projektnr1',       format: 'RAW',           maxLength: null, includeOnSeparator: true },
  { sortOrder: 60, source: 'CONSTANT',      bookingField: null,                constantValue: '1',  dmsKey: 'sichtid1',          format: null,            maxLength: null, includeOnSeparator: true },
  { sortOrder: 70, source: 'BOOKING_FIELD', bookingField: 'DESCRIPTION',       constantValue: null, dmsKey: 'textindokument',   format: 'RAW',           maxLength: 60,   includeOnSeparator: true },
  { sortOrder: 80, source: 'BOOKING_FIELD', bookingField: 'ACCOUNT_NUMBER',          constantValue: null, dmsKey: 'Kontonr1',         format: 'RAW',           maxLength: null, includeOnSeparator: true },
  { sortOrder: 81, source: 'BOOKING_FIELD', bookingField: 'COUNTER_ACCOUNT_NUMBER',  constantValue: null, dmsKey: 'Kontonr2',         format: 'RAW',           maxLength: null, includeOnSeparator: true },
  { sortOrder: 90, source: 'BOOKING_FIELD', bookingField: 'RECEIPT_NUMBER',          constantValue: null, dmsKey: 'belegnr',          format: 'RAW',           maxLength: null, includeOnSeparator: true },
];

/**
 * Idempotent: Fügt Kontonr2 für alle Schools nach, denen es im Mapping noch fehlt.
 * Bestehende User-Änderungen (Reihenfolge, isActive, maxLength) werden NICHT überschrieben.
 * Wird beim Backend-Start einmalig ausgeführt.
 */
export async function backfillKontonr2Mapping(): Promise<void> {
  const schoolsWithoutKontonr2 = await prisma.school.findMany({
    where: { dmsFieldMappings: { none: { dmsKey: 'Kontonr2' } } },
    select: { id: true },
  });
  if (schoolsWithoutKontonr2.length === 0) return;
  const row = DEFAULT_DMS_MAPPING.find(r => r.dmsKey === 'Kontonr2');
  if (!row) return;
  await prisma.dmsFieldMapping.createMany({
    data: schoolsWithoutKontonr2.map(s => ({ schoolId: s.id, ...row })),
    skipDuplicates: true,
  });
  console.log(`[dmsMapping] Backfill Kontonr2: ${schoolsWithoutKontonr2.length} School(s) ergänzt`);
}

export async function createDefaultDmsMappingForSchool(schoolId: string): Promise<void> {
  // skipDuplicates greift über das @@unique([schoolId, dmsKey])
  await prisma.dmsFieldMapping.createMany({
    data: DEFAULT_DMS_MAPPING.map(row => ({ schoolId, ...row })),
    skipDuplicates: true,
  });
}

// ─── Builder: Resolver + Formatter + Sanitize + Truncate ────────────────────

export const QR_UNSTRUCTURED_MAX = 140;

export interface BookingForMapping {
  id: string;
  schoolId: string;
  receiptNumber: number;
  bookingDate: Date;
  amount: Prisma.Decimal;
  debitCredit: 'S' | 'H';
  description: string;
  taxKey: string | null;
  account: { accountNumber: string; name: string };
  counterAccount: { accountNumber: string; name: string };
  costCenter: { code: string; name: string } | null;
  school: { name: string; code: string; dmsMandantenNummer: string | null };
  createdBy: { displayName: string };
  // pro Beleg gesetzt vom Aufrufer
  belegartCode?: string | null;
  belegartLabel?: string | null;
}

export class DmsBuilderError extends Error {
  constructor(message: string, readonly bookingId: string, readonly currentLength: number) {
    super(message);
    this.name = 'DmsBuilderError';
  }
}

// Sanitize: |, :, Whitespace-Sonderzeichen rauswerfen, doppelte Whitespaces kollabieren
const SANITIZE = /[|:\r\n\t]+/g;
const COLLAPSE_WS = /\s{2,}/g;

export function sanitize(value: string): string {
  return value.replace(SANITIZE, ' ').replace(COLLAPSE_WS, ' ').trim();
}

// Code-point-sichere Trunkierung (Umlaute bleiben heil)
export function truncate(value: string, maxLength: number | null): string {
  if (!maxLength || maxLength <= 0) return value;
  const chars = Array.from(value); // splittet nach Unicode-Codepoints
  if (chars.length <= maxLength) return value;
  return chars.slice(0, maxLength - 1).join('') + '…'; // …
}

function formatDate(d: Date, fmt: FieldFormat): string {
  const yyyy = d.getFullYear().toString();
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  switch (fmt) {
    case 'DATE_DDMMYYYY': return `${dd}.${mm}.${yyyy}`;
    case 'DATE_ISO':      return `${yyyy}-${mm}-${dd}`;
    case 'DATE_YYYYMMDD': return `${yyyy}${mm}${dd}`;
    default: return `${dd}.${mm}.${yyyy}`;
  }
}

function formatNumber(value: number, fmt: FieldFormat): string {
  switch (fmt) {
    case 'NUMBER_DE':          return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
    case 'NUMBER_DE_CURRENCY': return `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })} EUR`;
    case 'NUMBER_DOT':         return value.toFixed(2);
    default:                    return value.toFixed(2);
  }
}

export function applyFormat(raw: string, format: FieldFormat | null, rawValue?: unknown): string {
  if (!format || format === 'RAW') return raw;
  // Format kontextabhängig: bei Datum/Number mit Originalwert arbeiten
  if (rawValue instanceof Date && (format === 'DATE_DDMMYYYY' || format === 'DATE_ISO' || format === 'DATE_YYYYMMDD')) {
    return formatDate(rawValue, format);
  }
  if (typeof rawValue === 'number' && (format === 'NUMBER_DE' || format === 'NUMBER_DE_CURRENCY' || format === 'NUMBER_DOT')) {
    return formatNumber(rawValue, format);
  }
  if (format === 'UPPER') return raw.toLocaleUpperCase('de-DE');
  if (format === 'LOWER') return raw.toLocaleLowerCase('de-DE');
  return raw;
}

interface ResolvedValue {
  raw: string;
  rawTyped?: Date | number;
}

export function resolveField(
  booking: BookingForMapping,
  field: BookingField,
  fileIndex: number,
  totalFiles: number,
  datevMandantenNr: string | null,
): ResolvedValue {
  switch (field) {
    case 'BOOKING_DATE':
      return { raw: booking.bookingDate.toISOString().slice(0, 10), rawTyped: booking.bookingDate };
    case 'RECEIPT_NUMBER':
      return { raw: `${booking.bookingDate.getFullYear()}-${String(booking.receiptNumber).padStart(5, '0')}` };
    case 'AMOUNT': {
      const num = decimalToNumber(booking.amount);
      return { raw: num.toFixed(2), rawTyped: num };
    }
    case 'DEBIT_CREDIT':           return { raw: booking.debitCredit };
    case 'ACCOUNT_NUMBER':         return { raw: booking.account.accountNumber };
    case 'ACCOUNT_NAME':           return { raw: booking.account.name };
    case 'COUNTER_ACCOUNT_NUMBER': return { raw: booking.counterAccount.accountNumber };
    case 'COUNTER_ACCOUNT_NAME':   return { raw: booking.counterAccount.name };
    case 'COST_CENTER_CODE':       return { raw: booking.costCenter?.code ?? '' };
    case 'COST_CENTER_NAME':       return { raw: booking.costCenter?.name ?? '' };
    case 'DESCRIPTION':            return { raw: booking.description };
    case 'TAX_KEY':                return { raw: booking.taxKey ?? '' };
    case 'BELEGART_CODE':          return { raw: booking.belegartCode ?? '' };
    case 'BELEGART_LABEL':         return { raw: booking.belegartLabel ?? '' };
    case 'SCHOOL_NAME':            return { raw: booking.school.name };
    case 'SCHOOL_CODE':            return { raw: booking.school.code };
    case 'DMS_MANDANTEN_NR':       return { raw: booking.school.dmsMandantenNummer ?? '' };
    case 'DATEV_MANDANTEN_NR':     return { raw: datevMandantenNr ?? '' };
    case 'CREATED_BY':             return { raw: booking.createdBy.displayName };
    case 'FILE_INDEX':             return { raw: `${fileIndex}/${totalFiles}` };
  }
}

export interface BuiltLine {
  unstructured: string;
  fields: Array<{ dmsKey: string; value: string; includeOnSeparator: boolean }>;
}

export function buildPayloadLine(
  booking: BookingForMapping,
  mapping: DmsFieldMapping[],
  fileIndex: number,
  totalFiles: number,
  datevMandantenNr: string | null,
): BuiltLine {
  const active = mapping.filter(m => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const fields: BuiltLine['fields'] = [];

  for (const m of active) {
    let raw = '';
    let rawTyped: Date | number | undefined;
    if (m.source === 'CONSTANT') {
      raw = m.constantValue ?? '';
    } else if (m.bookingField) {
      const resolved = resolveField(booking, m.bookingField, fileIndex, totalFiles, datevMandantenNr);
      raw = resolved.raw;
      rawTyped = resolved.rawTyped;
    }
    const formatted = applyFormat(raw, m.format, rawTyped);
    const safe = sanitize(formatted);
    const capped = truncate(safe, m.maxLength);
    fields.push({ dmsKey: m.dmsKey, value: capped, includeOnSeparator: m.includeOnSeparator });
  }

  const unstructured = fields.map(f => `${f.dmsKey}:${f.value}`).join('|');

  if (Array.from(unstructured).length > QR_UNSTRUCTURED_MAX) {
    throw new DmsBuilderError(
      `QR-Payload überschreitet ${QR_UNSTRUCTURED_MAX} Zeichen (gemessen: ${Array.from(unstructured).length}). ` +
      `Buchung ${booking.id}: Feld deaktivieren oder maxLength reduzieren.`,
      booking.id,
      Array.from(unstructured).length,
    );
  }

  return { unstructured, fields };
}

// ─── Mapping-Cache (LRU mit 10-Min-TTL) ────────────────────────────────────
interface CacheEntry { value: DmsFieldMapping[]; expiresAt: number }
const CACHE_TTL_MS = 10 * 60 * 1000;
const mappingCache = new Map<string, CacheEntry>();

export async function getMappingCached(schoolId: string): Promise<DmsFieldMapping[]> {
  const now = Date.now();
  const cached = mappingCache.get(schoolId);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await prisma.dmsFieldMapping.findMany({
    where: { schoolId },
    orderBy: { sortOrder: 'asc' },
  });
  mappingCache.set(schoolId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export function invalidateMappingCache(schoolId: string): void {
  mappingCache.delete(schoolId);
}
