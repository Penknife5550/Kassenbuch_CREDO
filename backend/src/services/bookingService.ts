import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prismaClient';
import { checkCostCentersUsable } from './costCenterService';

export type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function getNextReceiptNumber(tx: TxClient, schoolId: string): Promise<number> {
  const seq = await tx.receiptSequence.update({
    where: { schoolId },
    data: { lastNumber: { increment: 1 } },
  });
  return seq.lastNumber;
}

export async function calculateCashBalance(schoolId: string, upToDate?: Date): Promise<Prisma.Decimal> {
  const dateCondition = upToDate
    ? Prisma.sql`AND booking_date <= ${upToDate}`
    : Prisma.empty;

  const result = await prisma.$queryRaw<{ balance: Prisma.Decimal | null }[]>`
    SELECT COALESCE(
      SUM(CASE WHEN debit_credit = 'S' THEN amount ELSE -amount END),
      0
    ) as balance
    FROM bookings
    WHERE school_id = ${schoolId} ${dateCondition}
  `;

  return result[0]?.balance ?? new Prisma.Decimal(0);
}

export async function calculateCashBalanceTx(tx: TxClient, schoolId: string): Promise<Prisma.Decimal> {
  const result = await (tx as unknown as PrismaClient).$queryRaw<{ balance: Prisma.Decimal | null }[]>`
    SELECT COALESCE(
      SUM(CASE WHEN debit_credit = 'S' THEN amount ELSE -amount END),
      0
    ) as balance
    FROM bookings
    WHERE school_id = ${schoolId}
  `;

  return result[0]?.balance ?? new Prisma.Decimal(0);
}

/** Heute, 0 Uhr — dieselbe Rechnung wie fuer Buchungs- und Abschlussdatum. */
function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Meldung fuer eine Buchung in einen abgeschlossenen Tag. Das Datum kommt aus
 * einer DATE-Spalte (UTC-Mitternacht). Ist heute schon abgeschlossen, hilft
 * kein anderes Datum — ein spaeteres laege in der Zukunft.
 */
export function dayClosedMessage(closedThrough: Date, today: Date = startOfToday()): string {
  const closedKey = closedThrough.toISOString().slice(0, 10);
  if (closedKey >= today.toISOString().slice(0, 10)) {
    return 'Die Kasse ist für heute bereits abgeschlossen. Buchungen sind erst ab morgen wieder möglich.';
  }
  const [year, month, day] = closedKey.split('-');
  return `Die Kasse ist bis einschließlich ${day}.${month}.${year} abgeschlossen. Bitte ein späteres Buchungsdatum wählen.`;
}

/**
 * Stellt IN der Transaktion sicher, dass der Tag nicht abgeschlossen ist.
 *
 * Ein Tagesabschluss schliesst nicht nur seinen eigenen Tag, sondern alle
 * Tage bis dahin: er schreibt alle Buchungen bis zu seinem Datum fest und
 * haelt den gezaehlten Bestand fest. Eine spaeter rueckdatierte Buchung laege
 * unfestgeschrieben davor, und der Bestand des Abschlusses passte nicht mehr
 * zum Journal. Deshalb zaehlt jeder Abschluss ab dem Buchungsdatum.
 *
 * Eine Pruefung vor der Transaktion reicht nicht: der Tagesabschluss kann bis
 * zur Buchung fertig werden. Ueberlappen sich Abschluss und Buchung, bricht
 * Serializable eine der beiden Transaktionen ab (P2034).
 *
 * Wirft `CLOSED:<Meldung>` — bookingErrorToResponse macht daraus die
 * 409-Antwort. Ohne eigene Meldung nennt sie den Tag, bis zu dem abgeschlossen ist.
 */
export async function assertDayOpen(tx: TxClient, schoolId: string, date: Date, message?: string): Promise<void> {
  const closing = await tx.dailyClosing.findFirst({
    where: { schoolId, closingDate: { gte: date } },
    orderBy: { closingDate: 'desc' },
    select: { closingDate: true },
  });
  if (closing) throw new Error(`CLOSED:${message ?? dayClosedMessage(closing.closingDate)}`);
}

export type BookingDateResult =
  | { ok: true; date: Date }
  | { ok: false; error: string };

/**
 * Frueheste Jahreszahl eines Buchungsdatums. Ein zweistellig getipptes Jahr
 * kommt als "0026" an; gebucht laege es im Jahr 26 und fehlte in jeder
 * Auswertung, zaehlte aber im Kassenbestand.
 */
const MIN_BOOKING_YEAR = 2000;

/**
 * Buchungsdatum aus der Anfrage (JJJJ-MM-TT). Fehlt es, gilt heute; ein Datum
 * in der Zukunft, vor dem Jahr 2000 oder ein Tag, den es nicht gibt, wird
 * abgewiesen.
 */
export function resolveBookingDate(raw?: string): BookingDateResult {
  const today = startOfToday();
  if (!raw) return { ok: true, date: today };

  const parsed = new Date(raw);
  // "2026-02-30" wuerde sonst stillschweigend zum 2. Maerz
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: 'Ungültiges Buchungsdatum' };
  }
  if (parsed.getUTCFullYear() < MIN_BOOKING_YEAR) {
    return { ok: false, error: 'Das Buchungsdatum liegt vor dem Jahr 2000. Bitte das Datum prüfen.' };
  }

  const date = new Date(raw);
  date.setHours(0, 0, 0, 0);
  if (date > today) return { ok: false, error: 'Buchungsdatum darf nicht in der Zukunft liegen.' };
  return { ok: true, date };
}

export interface NewBooking {
  schoolId: string;
  bookingDate: Date;
  amount: Prisma.Decimal;
  debitCredit: 'S' | 'H';
  accountId: string;
  counterAccountId: string;
  costCenterId?: string;
  description: string;
  taxKey?: string;
  createdById: string;
}

/**
 * Legt eine Einzelbuchung in einer laufenden Transaktion an: Konten und
 * Kostenstelle nutzbar, Tag nicht abgeschlossen, Saldo-Pruefung bei Ausgaben,
 * naechste Belegnummer, Buchung. Die Transaktion muss Serializable laufen,
 * sonst sind die Pruefungen gegen parallele Buchungen und Abschluesse nicht dicht.
 *
 * Alle Pruefungen stehen hier und nicht davor, damit ein Wiederholungsversuch
 * (retryOnWriteConflict) sie erneut durchlaeuft.
 *
 * Wirft `GONE:`, `CLOSED:` oder `BALANCE:` mit der Meldung dahinter —
 * bookingErrorToResponse macht daraus die Antwort.
 */
export async function createBookingInTx(tx: TxClient, input: NewBooking) {
  await assertAccountsUsable(tx, [input.accountId, input.counterAccountId]);
  await assertCostCentersUsable(tx, [input.costCenterId]);
  await assertDayOpen(tx, input.schoolId, input.bookingDate);

  if (input.debitCredit === 'H') {
    const currentBalance = await calculateCashBalanceTx(tx, input.schoolId);
    const newBalance = currentBalance.sub(input.amount);
    if (newBalance.isNegative()) {
      throw new Error(`BALANCE:Kassenbestand darf nicht negativ werden. Aktueller Bestand: ${currentBalance.toString()} EUR`);
    }
  }

  const receiptNumber = await getNextReceiptNumber(tx, input.schoolId);

  return tx.booking.create({
    data: {
      schoolId: input.schoolId,
      receiptNumber,
      bookingDate: input.bookingDate,
      amount: input.amount,
      debitCredit: input.debitCredit,
      accountId: input.accountId,
      counterAccountId: input.counterAccountId,
      costCenterId: input.costCenterId,
      description: input.description,
      taxKey: input.taxKey,
      createdById: input.createdById,
    },
    include: {
      account: { select: { accountNumber: true, name: true } },
      counterAccount: { select: { accountNumber: true, name: true } },
      costCenter: { select: { code: true, name: true } },
      createdBy: { select: { displayName: true } },
    },
  });
}

/**
 * Stellt IN der Transaktion sicher, dass keine der Buchungen schon storniert
 * ist. Die Route prueft das vorab — zwischen jener Pruefung und dem Beginn der
 * Transaktion kann ein zweiter Storno derselben Buchung aber schon fertig
 * sein. Ohne diese Pruefung liefe er ein zweites Mal durch, und der
 * Kassenbestand stimmte nicht mehr. Ueberlappen sich die beiden Transaktionen
 * stattdessen, bricht Serializable eine von ihnen ab (P2034).
 *
 * Wirft `STORNO:<Meldung>` — bookingErrorToResponse macht daraus die 409-Antwort.
 */
export async function assertNotStornoed(tx: TxClient, bookingIds: string[], message: string): Promise<void> {
  const stornos = await tx.booking.count({ where: { stornoOfId: { in: bookingIds } } });
  if (stornos > 0) throw new Error(`STORNO:${message}`);
}

/**
 * Meldung fuer eine Kostenstelle, die es beim Buchen nicht mehr gibt.
 *
 * Das Zod-Schema prueft nur die UUID-Form. Ein Browser-Tab, der vor einer
 * Deaktivierung geoeffnet wurde, kennt die Kostenstelle aber weiterhin — ohne
 * Pruefung koennte er darauf buchen und sie damit zurueck in Journal,
 * DATEV-KOST1 und DMS-Trennseite holen. Gilt nur fuer NEUE Buchungen; ein
 * Storno uebernimmt die Kostenstelle des Originals und wird nicht geprueft.
 */
export const COST_CENTER_GONE = 'Diese Kostenstelle ist nicht mehr verfügbar. Bitte laden Sie die Seite neu.';

/**
 * Stellt IN der Transaktion sicher, dass alle Kostenstellen existieren und
 * aktiv sind. Wirft `GONE:<Meldung>` — bookingErrorToResponse macht daraus
 * die 400-Antwort.
 */
export async function assertCostCentersUsable(tx: TxClient, ids: Array<string | null | undefined>): Promise<void> {
  const check = await checkCostCentersUsable(tx, ids);
  if (!check.ok) throw new Error(`GONE:${COST_CENTER_GONE}`);
}

export const ACCOUNT_GONE = 'Ein ausgewähltes Konto ist nicht mehr verfügbar. Bitte laden Sie die Seite neu.';

/**
 * Stellt IN der Transaktion sicher, dass alle Konten existieren und aktiv
 * sind — dieselbe Regel wie fuer Kostenstellen. Ein vor der Deaktivierung
 * geoeffnetes Fenster kennt das Konto noch; ohne Pruefung kaeme es zurueck in
 * Journal, DATEV und Eigenbeleg. Wirft `GONE:<Meldung>`.
 */
export async function assertAccountsUsable(tx: TxClient, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const active = await tx.account.count({ where: { id: { in: unique }, isActive: true } });
  if (active !== unique.length) throw new Error(`GONE:${ACCOUNT_GONE}`);
}

/**
 * Faengt den Sekundenbruchteil zwischen Pruefung und INSERT ab: verschwindet
 * eine Kostenstelle oder ein Konto genau dann, weist die Datenbank das INSERT
 * per Fremdschluessel ab (P2003). Ohne diesen Zweig saehe der Anwender
 * ausgerechnet dort einen nichtssagenden 500er.
 *
 * Prisma 6 nennt die verletzte Regel in meta.constraint, aeltere Versionen in
 * meta.field_name — gesucht wird deshalb in allem, was meta enthaelt.
 */
function foreignKeyMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('code' in err) || err.code !== 'P2003') return null;
  const meta = JSON.stringify((err as { meta?: unknown }).meta ?? {});
  return meta.includes('cost_center') ? COST_CENTER_GONE : ACCOUNT_GONE;
}

export const WRITE_CONFLICT = 'Gleichzeitig wurde eine andere Buchung gespeichert. Bitte noch einmal buchen.';

/** SQLSTATE fuer gescheiterte Serialisierung und Deadlock: nichts geschrieben, ein neuer Versuch hilft. */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

/**
 * P2034: zwei Buchungen derselben Schule trafen im selben Moment ein. Beide
 * greifen nach der naechsten Belegnummer; PostgreSQL bricht bei Serializable
 * eine der beiden Transaktionen ab, ohne dass sie etwas geschrieben hat.
 *
 * Trifft der Abbruch eine Roh-Abfrage ($queryRaw, etwa die Saldo-Summe),
 * meldet Prisma ihn als P2010 mit dem SQLSTATE in meta.code.
 */
export function isWriteConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  if (err.code === 'P2034') return true;
  const sqlState = (err as { meta?: { code?: unknown } }).meta?.code;
  return err.code === 'P2010' && RETRYABLE_SQLSTATES.has(String(sqlState));
}

const WRITE_CONFLICT_ATTEMPTS = 5;

/**
 * Wiederholt eine Serializable-Transaktion, die an einer parallelen Buchung
 * gescheitert ist. Der neue Versuch sieht den Stand der anderen Buchung und
 * gelingt; die kurze, zufaellige Pause entzerrt mehrere Wartende.
 *
 * Nur fuer Transaktionen, die alle ihre Pruefungen selbst enthalten. Eine
 * Pruefung VOR der Transaktion ("Tag schon abgeschlossen?") liefe beim zweiten
 * Versuch nicht noch einmal.
 */
export async function retryOnWriteConflict<T>(
  run: () => Promise<T>,
  beforeRetry: () => Promise<unknown>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isWriteConflict(err) || attempt >= WRITE_CONFLICT_ATTEMPTS) throw err;
      await beforeRetry();
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 40));
    }
  }
}

/**
 * Fachliche Absagen aus einer Transaktion tragen eines dieser Praefixe, der
 * Text dahinter geht an den Anwender. Der Wert ist der HTTP-Status.
 */
const REJECTIONS: Record<string, number> = { 'BALANCE:': 409, 'STORNO:': 409, 'CLOSED:': 409, 'GONE:': 400 };

/**
 * Uebersetzt die erwartbaren Fehler einer Buchungs-Transaktion in Status und
 * Meldung. null heisst: unbekannter Fehler, der Aufrufer antwortet mit 500.
 */
export function bookingErrorToResponse(err: unknown): { status: number; error: string } | null {
  const fkMessage = foreignKeyMessage(err);
  if (fkMessage) return { status: 400, error: fkMessage };
  if (err instanceof Error) {
    const { message } = err;
    const prefix = Object.keys(REJECTIONS).find((p) => message.startsWith(p));
    if (prefix) return { status: REJECTIONS[prefix], error: message.slice(prefix.length) };
  }
  if (isWriteConflict(err)) return { status: 409, error: WRITE_CONFLICT };
  return null;
}
