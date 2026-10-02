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

export async function isDayFinalized(
  schoolId: string,
  date: Date,
  db: Pick<TxClient, 'dailyClosing'> = prisma,
): Promise<boolean> {
  const closing = await db.dailyClosing.findUnique({
    where: {
      schoolId_closingDate: {
        schoolId,
        closingDate: date,
      },
    },
  });
  return !!closing;
}

export const DAY_CLOSED = 'Tagesabschluss für dieses Datum bereits durchgeführt. Keine Buchungen möglich.';

/**
 * Stellt IN der Transaktion sicher, dass der Tag nicht abgeschlossen ist. Eine
 * Pruefung vor der Transaktion reicht nicht: der Tagesabschluss kann bis zur
 * Buchung fertig werden, und die Buchung landete dann unfestgeschrieben im
 * abgeschlossenen Tag, an Soll- und Istbestand des Abschlusses vorbei.
 * Ueberlappen sich Abschluss und Buchung, bricht Serializable eine der beiden
 * Transaktionen ab (P2034).
 *
 * Wirft `CLOSED:<Meldung>` — bookingErrorToResponse macht daraus die 409-Antwort.
 */
export async function assertDayOpen(tx: TxClient, schoolId: string, date: Date, message = DAY_CLOSED): Promise<void> {
  if (await isDayFinalized(schoolId, date, tx)) throw new Error(`CLOSED:${message}`);
}

export type BookingDateResult =
  | { ok: true; date: Date }
  | { ok: false; error: string };

/**
 * Buchungsdatum aus der Anfrage. Fehlt es, gilt heute; ein Datum in der
 * Zukunft wird abgewiesen.
 */
export function resolveBookingDate(raw?: string): BookingDateResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!raw) return { ok: true, date: today };

  const date = new Date(raw);
  date.setHours(0, 0, 0, 0);
  if (isNaN(date.getTime())) return { ok: false, error: 'Ungültiges Buchungsdatum' };
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
 * Legt eine Einzelbuchung in einer laufenden Transaktion an: Kostenstelle
 * nutzbar, Tag nicht abgeschlossen, Saldo-Pruefung bei Ausgaben, naechste
 * Belegnummer, Buchung. Die Transaktion muss Serializable laufen, sonst sind
 * die Pruefungen gegen parallele Buchungen und Abschluesse nicht dicht.
 *
 * Alle Pruefungen stehen hier und nicht davor, damit ein Wiederholungsversuch
 * (retryOnWriteConflict) sie erneut durchlaeuft.
 *
 * Wirft `GONE:`, `CLOSED:` oder `BALANCE:` mit der Meldung dahinter —
 * bookingErrorToResponse macht daraus die Antwort.
 */
export async function createBookingInTx(tx: TxClient, input: NewBooking) {
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
 * Faengt den Sekundenbruchteil zwischen Pruefung und INSERT ab: verschwindet
 * eine Kostenstelle oder ein Konto genau dann, weist die Datenbank das INSERT
 * per Fremdschluessel ab (P2003). Ohne diesen Zweig saehe der Anwender
 * ausgerechnet dort einen nichtssagenden 500er.
 */
function foreignKeyMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('code' in err) || err.code !== 'P2003') return null;
  const field = String((err as { meta?: { field_name?: unknown } }).meta?.field_name ?? '');
  return field.includes('cost_center') ? COST_CENTER_GONE : ACCOUNT_GONE;
}

export const WRITE_CONFLICT = 'Gleichzeitig wurde eine andere Buchung gespeichert. Bitte noch einmal buchen.';

/**
 * P2034: zwei Buchungen derselben Schule trafen im selben Moment ein. Beide
 * greifen nach der naechsten Belegnummer; PostgreSQL bricht bei Serializable
 * eine der beiden Transaktionen ab, ohne dass sie etwas geschrieben hat.
 */
export function isWriteConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && err.code === 'P2034';
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
