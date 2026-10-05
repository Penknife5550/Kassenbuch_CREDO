import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

// Mock the prismaClient module before importing the service
vi.mock('../prismaClient', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    receiptSequence: {
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../prismaClient';
import {
  getNextReceiptNumber,
  calculateCashBalance,
  calculateCashBalanceTx,
  resolveBookingDate,
  createBookingInTx,
  assertAccountsUsable,
  assertCostCentersUsable,
  assertDayOpen,
  assertNotStornoed,
  bookingErrorToResponse,
  isWriteConflict,
  retryOnWriteConflict,
  dayClosedMessage,
  COST_CENTER_GONE,
  ACCOUNT_GONE,
  WRITE_CONFLICT,
} from './bookingService';

describe('bookingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getNextReceiptNumber', () => {
    it('should return the incremented receipt number from the sequence', async () => {
      const mockTx = {
        receiptSequence: {
          update: vi.fn().mockResolvedValue({ schoolId: 'school-1', lastNumber: 42 }),
        },
      };

      const result = await getNextReceiptNumber(mockTx as any, 'school-1');

      expect(result).toBe(42);
      expect(mockTx.receiptSequence.update).toHaveBeenCalledWith({
        where: { schoolId: 'school-1' },
        data: { lastNumber: { increment: 1 } },
      });
    });

    it('should return 1 for the first booking', async () => {
      const mockTx = {
        receiptSequence: {
          update: vi.fn().mockResolvedValue({ schoolId: 'school-1', lastNumber: 1 }),
        },
      };

      const result = await getNextReceiptNumber(mockTx as any, 'school-1');

      expect(result).toBe(1);
    });

    it('should use the correct schoolId in the query', async () => {
      const mockTx = {
        receiptSequence: {
          update: vi.fn().mockResolvedValue({ schoolId: 'school-xyz', lastNumber: 100 }),
        },
      };

      await getNextReceiptNumber(mockTx as any, 'school-xyz');

      expect(mockTx.receiptSequence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { schoolId: 'school-xyz' },
        }),
      );
    });
  });

  describe('calculateCashBalance', () => {
    it('should return balance from raw query', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { balance: new Prisma.Decimal(1500) },
      ]);

      const result = await calculateCashBalance('school-1');

      expect(result).toEqual(new Prisma.Decimal(1500));
    });

    it('should return zero when balance is null', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ balance: null }]);

      const result = await calculateCashBalance('school-1');

      expect(result).toEqual(new Prisma.Decimal(0));
    });

    it('should return zero when query returns empty array', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await calculateCashBalance('school-1');

      expect(result).toEqual(new Prisma.Decimal(0));
    });
  });

  describe('calculateCashBalanceTx', () => {
    it('should return balance from raw query within transaction', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([
          { balance: new Prisma.Decimal(2500) },
        ]),
      };

      const result = await calculateCashBalanceTx(mockTx as any, 'school-1');

      expect(result).toEqual(new Prisma.Decimal(2500));
    });

    it('should return zero when balance is null in transaction', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ balance: null }]),
      };

      const result = await calculateCashBalanceTx(mockTx as any, 'school-1');

      expect(result).toEqual(new Prisma.Decimal(0));
    });
  });

  describe('resolveBookingDate', () => {
    const midnight = (date: Date) => {
      const copy = new Date(date);
      copy.setHours(0, 0, 0, 0);
      return copy;
    };

    it('nimmt heute, wenn kein Datum mitkommt', () => {
      const result = resolveBookingDate(undefined);

      expect(result).toEqual({ ok: true, date: midnight(new Date()) });
    });

    // Bewusst gegen den Kalendertag geprueft und nicht gegen dieselbe Rechnung
    // wie in der Funktion: der Tag der Anfrage muss der gebuchte Tag sein.
    it('uebernimmt ein Datum in der Vergangenheit', () => {
      const result = resolveBookingDate('2024-03-15');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { date } = result;
      expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2024, 3, 15]);
      expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([0, 0, 0]);
    });

    it('weist ein Datum in der Zukunft ab', () => {
      const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

      expect(resolveBookingDate(tomorrow)).toEqual({
        ok: false,
        error: 'Buchungsdatum darf nicht in der Zukunft liegen.',
      });
    });

    it('weist ein Datum ab, das es nicht gibt', () => {
      expect(resolveBookingDate('2024-13-45')).toEqual({ ok: false, error: 'Ungültiges Buchungsdatum' });
    });

    // Vorher wurde der 30. Februar stillschweigend zum 2. Maerz.
    it('weist einen Tag ab, den es in diesem Monat nicht gibt, und laesst den Schalttag zu', () => {
      expect(resolveBookingDate('2026-02-30')).toEqual({ ok: false, error: 'Ungültiges Buchungsdatum' });
      expect(resolveBookingDate('2025-02-29')).toEqual({ ok: false, error: 'Ungültiges Buchungsdatum' });
      expect(resolveBookingDate('2024-02-29').ok).toBe(true);
    });

    // Ein zweistellig getipptes Jahr kommt als "0026" an.
    it('weist ein Jahr vor 2000 ab', () => {
      expect(resolveBookingDate('0026-10-02')).toEqual({
        ok: false,
        error: 'Das Buchungsdatum liegt vor dem Jahr 2000. Bitte das Datum prüfen.',
      });
      expect(resolveBookingDate('2000-01-01').ok).toBe(true);
    });
  });

  describe('createBookingInTx', () => {
    const input = {
      schoolId: 'school-1',
      bookingDate: new Date('2024-03-15'),
      amount: new Prisma.Decimal(100),
      debitCredit: 'H' as const,
      accountId: 'kasse-1',
      counterAccountId: 'gegen-1',
      description: 'Büromaterial',
      createdById: 'user-1',
    };

    function makeTx(balance: number, state: {
      closedThrough?: Date; costCenters?: Array<{ id: string; isActive: boolean }>; activeAccounts?: number;
    } = {}) {
      return {
        $queryRaw: vi.fn().mockResolvedValue([{ balance: new Prisma.Decimal(balance) }]),
        receiptSequence: { update: vi.fn().mockResolvedValue({ lastNumber: 43 }) },
        booking: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'booking-1', ...data })) },
        dailyClosing: { findFirst: vi.fn().mockResolvedValue(state.closedThrough ? { closingDate: state.closedThrough } : null) },
        costCenter: { findMany: vi.fn().mockResolvedValue(state.costCenters ?? []) },
        account: { count: vi.fn().mockResolvedValue(state.activeAccounts ?? 2) },
      };
    }

    // Ein vor der Deaktivierung geoeffnetes Fenster kennt das Konto noch.
    it('bucht nicht auf ein deaktiviertes Konto und zieht dann keine Belegnummer', async () => {
      const tx = makeTx(250, { activeAccounts: 1 });

      await expect(createBookingInTx(tx as any, input)).rejects.toThrow(`GONE:${ACCOUNT_GONE}`);
      expect(tx.account.count).toHaveBeenCalledWith({ where: { id: { in: ['kasse-1', 'gegen-1'] }, isActive: true } });
      expect(tx.receiptSequence.update).not.toHaveBeenCalled();
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('bucht eine Ausgabe mit der naechsten Belegnummer', async () => {
      const tx = makeTx(250);

      const booking = await createBookingInTx(tx as any, input);

      expect(booking.receiptNumber).toBe(43);
      expect(tx.booking.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ schoolId: 'school-1', receiptNumber: 43, debitCredit: 'H' }),
      }));
    });

    // Eine abgewiesene Ausgabe darf weder buchen noch eine Belegnummer ziehen.
    it('weist eine Ausgabe ueber dem Kassenbestand ab, bevor eine Belegnummer vergeben wird', async () => {
      const tx = makeTx(50);

      await expect(createBookingInTx(tx as any, input)).rejects.toThrow(/^BALANCE:Kassenbestand darf nicht negativ werden/);
      expect(tx.receiptSequence.update).not.toHaveBeenCalled();
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('laesst eine Ausgabe zu, die den Bestand genau auf null bringt', async () => {
      const tx = makeTx(100);

      await expect(createBookingInTx(tx as any, input)).resolves.toBeDefined();
    });

    it('prueft bei einer Einnahme keinen Kassenbestand', async () => {
      const tx = makeTx(0);

      await createBookingInTx(tx as any, { ...input, debitCredit: 'S' });

      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.booking.create).toHaveBeenCalled();
    });

    // Der Tagesabschluss kann fertig werden, waehrend die Buchung unterwegs
    // ist. Die Pruefung in der Transaktion faengt das ab — auch beim
    // Wiederholungsversuch nach einem Schreibkonflikt mit dem Abschluss.
    it('bucht nicht in einen abgeschlossenen Tag und zieht dann keine Belegnummer', async () => {
      const tx = makeTx(250, { closedThrough: new Date('2024-03-15') });

      await expect(createBookingInTx(tx as any, input)).rejects.toThrow(/^CLOSED:Die Kasse ist bis einschließlich 15\.03\.2024 abgeschlossen/);
      expect(tx.receiptSequence.update).not.toHaveBeenCalled();
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('bucht nicht auf eine deaktivierte oder verschwundene Kostenstelle', async () => {
      const deactivated = makeTx(250, { costCenters: [{ id: 'kst-1', isActive: false }] });
      const missing = makeTx(250, { costCenters: [] });

      await expect(createBookingInTx(deactivated as any, { ...input, costCenterId: 'kst-1' })).rejects.toThrow(`GONE:${COST_CENTER_GONE}`);
      await expect(createBookingInTx(missing as any, { ...input, costCenterId: 'kst-1' })).rejects.toThrow(`GONE:${COST_CENTER_GONE}`);
      expect(deactivated.booking.create).not.toHaveBeenCalled();
      expect(missing.booking.create).not.toHaveBeenCalled();
    });

    it('bucht auf eine aktive Kostenstelle und fragt ohne Kostenstelle gar nicht nach', async () => {
      const withCostCenter = makeTx(250, { costCenters: [{ id: 'kst-1', isActive: true }] });
      const without = makeTx(250);

      await expect(createBookingInTx(withCostCenter as any, { ...input, costCenterId: 'kst-1' })).resolves.toBeDefined();
      await expect(createBookingInTx(without as any, input)).resolves.toBeDefined();
      expect(without.costCenter.findMany).not.toHaveBeenCalled();
    });
  });

  describe('assertDayOpen', () => {
    const txWith = (closingDate: Date | null) => ({
      dailyClosing: { findFirst: vi.fn().mockResolvedValue(closingDate ? { closingDate } : null) },
    });

    it('laesst die Buchung zu, wenn es ab ihrem Datum keinen Abschluss gibt', async () => {
      const tx = txWith(null);

      await expect(assertDayOpen(tx as any, 'school-1', new Date('2024-03-15'))).resolves.toBeUndefined();
    });

    // Ein Abschluss schliesst alle Tage bis dahin. Gefragt wird deshalb nach
    // jedem Abschluss AB dem Buchungsdatum, nicht nur nach dem des Tages selbst:
    // sonst liesse sich nach dem Abschluss vom Freitag noch auf Mittwoch buchen.
    it('fragt nach dem juengsten Abschluss ab dem Buchungsdatum', async () => {
      const tx = txWith(null);
      const wednesday = new Date('2024-03-13');

      await assertDayOpen(tx as any, 'school-1', wednesday);

      expect(tx.dailyClosing.findFirst).toHaveBeenCalledWith({
        where: { schoolId: 'school-1', closingDate: { gte: wednesday } },
        orderBy: { closingDate: 'desc' },
        select: { closingDate: true },
      });
    });

    it('nennt den Tag, bis zu dem die Kasse abgeschlossen ist', async () => {
      const friday = txWith(new Date('2024-03-15'));

      await expect(assertDayOpen(friday as any, 'school-1', new Date('2024-03-13'))).rejects.toThrow(
        'CLOSED:Die Kasse ist bis einschließlich 15.03.2024 abgeschlossen. Bitte ein späteres Buchungsdatum wählen.',
      );
    });

    // Ist heute schon abgeschlossen, laege jedes spaetere Datum in der Zukunft.
    it('sagt bei einem Abschluss von heute, dass erst morgen wieder gebucht werden kann', () => {
      const today = new Date('2026-10-05T00:00:00Z');

      expect(dayClosedMessage(new Date('2026-10-05T00:00:00Z'), today))
        .toBe('Die Kasse ist für heute bereits abgeschlossen. Buchungen sind erst ab morgen wieder möglich.');
      expect(dayClosedMessage(new Date('2026-10-02T00:00:00Z'), today))
        .toBe('Die Kasse ist bis einschließlich 02.10.2026 abgeschlossen. Bitte ein späteres Buchungsdatum wählen.');
    });

    it('bricht mit der Meldung des Aufrufers ab, wenn er eine mitgibt', async () => {
      const tx = txWith(new Date('2024-03-15'));

      await expect(assertDayOpen(tx as any, 'school-1', new Date('2024-03-15'), 'Tagesabschluss bereits durchgeführt'))
        .rejects.toThrow('CLOSED:Tagesabschluss bereits durchgeführt');
    });
  });

  // Eine Splittbuchung hat je Zeile eine Kostenstelle; eine einzige
  // deaktivierte genuegt, damit nichts gebucht wird.
  describe('assertCostCentersUsable', () => {
    const txWith = (found: Array<{ id: string; isActive: boolean }>) => ({
      costCenter: { findMany: vi.fn().mockResolvedValue(found) },
    });

    it('laesst aktive Kostenstellen und Zeilen ohne Kostenstelle durch', async () => {
      const tx = txWith([{ id: 'kst-1', isActive: true }, { id: 'kst-2', isActive: true }]);

      await expect(assertCostCentersUsable(tx as any, ['kst-1', undefined, 'kst-2'])).resolves.toBeUndefined();
    });

    it('bricht ab, sobald eine der Kostenstellen deaktiviert oder verschwunden ist', async () => {
      const deactivated = txWith([{ id: 'kst-1', isActive: true }, { id: 'kst-2', isActive: false }]);
      const missing = txWith([{ id: 'kst-1', isActive: true }]);

      await expect(assertCostCentersUsable(deactivated as any, ['kst-1', 'kst-2'])).rejects.toThrow(`GONE:${COST_CENTER_GONE}`);
      await expect(assertCostCentersUsable(missing as any, ['kst-1', 'kst-2'])).rejects.toThrow(`GONE:${COST_CENTER_GONE}`);
    });
  });

  describe('assertAccountsUsable', () => {
    it('zaehlt jedes Konto nur einmal und laesst aktive durch', async () => {
      const tx = { account: { count: vi.fn().mockResolvedValue(2) } };

      await expect(assertAccountsUsable(tx as any, ['kasse-1', 'erloese', 'erloese'])).resolves.toBeUndefined();
      expect(tx.account.count).toHaveBeenCalledWith({ where: { id: { in: ['kasse-1', 'erloese'] }, isActive: true } });
    });

    it('bricht ab, sobald eines der Konten deaktiviert oder verschwunden ist', async () => {
      const tx = { account: { count: vi.fn().mockResolvedValue(1) } };

      await expect(assertAccountsUsable(tx as any, ['kasse-1', 'erloese'])).rejects.toThrow(`GONE:${ACCOUNT_GONE}`);
    });
  });

  describe('assertNotStornoed', () => {
    it('laesst den Storno zu, solange keine Stornobuchung existiert', async () => {
      const tx = { booking: { count: vi.fn().mockResolvedValue(0) } };

      await expect(assertNotStornoed(tx as any, ['b-1', 'b-2'], 'Diese Splittbuchung wurde bereits storniert'))
        .resolves.toBeUndefined();
      expect(tx.booking.count).toHaveBeenCalledWith({ where: { stornoOfId: { in: ['b-1', 'b-2'] } } });
    });

    // Zwei fast gleichzeitige Stornos derselben Buchung: der zweite hat die
    // Vorab-Pruefung der Route schon hinter sich, wenn der erste fertig wird.
    // Ohne die Pruefung in der Transaktion wurde er ein zweites Mal gebucht.
    it('bricht ab, wenn inzwischen ein Storno derselben Buchung gespeichert wurde', async () => {
      const tx = { booking: { count: vi.fn().mockResolvedValue(1) } };

      await expect(assertNotStornoed(tx as any, ['b-1'], 'Diese Buchung wurde bereits storniert'))
        .rejects.toThrow('STORNO:Diese Buchung wurde bereits storniert');
    });
  });

  describe('bookingErrorToResponse', () => {
    it('macht aus dem Saldo-Fehler eine 409 ohne das interne Praefix', () => {
      const result = bookingErrorToResponse(new Error('BALANCE:Kassenbestand darf nicht negativ werden. Aktueller Bestand: 50 EUR'));

      expect(result).toEqual({
        status: 409,
        error: 'Kassenbestand darf nicht negativ werden. Aktueller Bestand: 50 EUR',
      });
    });

    it('macht aus dem Storno-Konflikt eine 409 ohne das interne Praefix', () => {
      expect(bookingErrorToResponse(new Error('STORNO:Diese Buchung wurde bereits storniert')))
        .toEqual({ status: 409, error: 'Diese Buchung wurde bereits storniert' });
    });

    it('meldet den abgeschlossenen Tag als 409 und die fehlende Kostenstelle als 400', () => {
      const closed = dayClosedMessage(new Date('2024-03-15'));
      expect(bookingErrorToResponse(new Error(`CLOSED:${closed}`))).toEqual({ status: 409, error: closed });
      expect(bookingErrorToResponse(new Error(`GONE:${COST_CENTER_GONE}`))).toEqual({ status: 400, error: COST_CENTER_GONE });
    });

    it('nennt bei verletztem Fremdschluessel die Kostenstelle oder das Konto', () => {
      const costCenter = { code: 'P2003', meta: { field_name: 'bookings_cost_center_id_fkey (index)' } };
      const account = { code: 'P2003', meta: { field_name: 'bookings_counter_account_id_fkey (index)' } };

      expect(bookingErrorToResponse(costCenter)).toEqual({ status: 400, error: COST_CENTER_GONE });
      expect(bookingErrorToResponse(account)).toEqual({ status: 400, error: ACCOUNT_GONE });
    });

    // So meldet Prisma 6.19 den Fremdschluessel tatsaechlich (gegen PostgreSQL nachgestellt).
    it('erkennt die Kostenstelle auch in der Fehlerform von Prisma 6', () => {
      const costCenter = { code: 'P2003', meta: { modelName: 'Booking', constraint: 'bookings_cost_center_id_fkey' } };

      expect(bookingErrorToResponse(costCenter)).toEqual({ status: 400, error: COST_CENTER_GONE });
    });

    // Vorher lief dieser Fall als "Interner Serverfehler" auf.
    it('macht aus einer parallelen Buchung eine 409 mit Aufforderung zum Wiederholen', () => {
      expect(bookingErrorToResponse({ code: 'P2034' })).toEqual({ status: 409, error: WRITE_CONFLICT });
    });

    // Bricht PostgreSQL die Transaktion in einer Roh-Abfrage ab (Saldo-Summe),
    // kommt der Abbruch als P2010 mit dem SQLSTATE an — vorher ein 500er.
    it('erkennt den Abbruch auch, wenn er in einer Roh-Abfrage passiert', () => {
      expect(isWriteConflict({ code: 'P2010', meta: { code: '40001', message: 'could not serialize access' } })).toBe(true);
      expect(isWriteConflict({ code: 'P2010', meta: { code: '40P01' } })).toBe(true);
      expect(isWriteConflict({ code: 'P2010', meta: { code: '23505' } })).toBe(false);
      expect(bookingErrorToResponse({ code: 'P2010', meta: { code: '40001' } })).toEqual({ status: 409, error: WRITE_CONFLICT });
    });

    it('kennt fremde Fehler nicht — der Aufrufer antwortet mit 500', () => {
      expect(bookingErrorToResponse(new Error('Verbindung verloren'))).toBeNull();
      expect(bookingErrorToResponse(null)).toBeNull();
    });
  });

  describe('retryOnWriteConflict', () => {
    const conflict = { code: 'P2034' };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('laeuft ohne Konflikt genau einmal', async () => {
      const run = vi.fn().mockResolvedValue('gebucht');
      const beforeRetry = vi.fn();

      await expect(retryOnWriteConflict(run, beforeRetry)).resolves.toBe('gebucht');
      expect(run).toHaveBeenCalledTimes(1);
      expect(beforeRetry).not.toHaveBeenCalled();
    });

    it('wiederholt nach einem Konflikt und raeumt vor jedem neuen Versuch auf', async () => {
      const calls: string[] = [];
      const run = vi.fn()
        .mockImplementationOnce(async () => { calls.push('run'); throw conflict; })
        .mockImplementationOnce(async () => { calls.push('run'); throw conflict; })
        .mockImplementationOnce(async () => { calls.push('run'); return 'gebucht'; });
      const beforeRetry = vi.fn(async () => { calls.push('aufraeumen'); });

      const result = retryOnWriteConflict(run, beforeRetry);
      await vi.runAllTimersAsync();

      await expect(result).resolves.toBe('gebucht');
      expect(calls).toEqual(['run', 'aufraeumen', 'run', 'aufraeumen', 'run']);
    });

    it('gibt nach fuenf Versuchen auf und reicht den Konflikt weiter', async () => {
      const run = vi.fn().mockRejectedValue(conflict);
      const beforeRetry = vi.fn().mockResolvedValue(undefined);

      const assertion = expect(retryOnWriteConflict(run, beforeRetry)).rejects.toBe(conflict);
      await vi.runAllTimersAsync();

      await assertion;
      expect(run).toHaveBeenCalledTimes(5);
      // Nach dem letzten Versuch raeumt der Aufrufer selbst auf.
      expect(beforeRetry).toHaveBeenCalledTimes(4);
    });

    // Ein Saldo-Fehler oder ein Ausfall der Datenbank wird durch Wiederholen nicht besser.
    it('wiederholt andere Fehler nicht', async () => {
      const failure = new Error('BALANCE:Kassenbestand darf nicht negativ werden.');
      const run = vi.fn().mockRejectedValue(failure);
      const beforeRetry = vi.fn();

      await expect(retryOnWriteConflict(run, beforeRetry)).rejects.toBe(failure);
      expect(run).toHaveBeenCalledTimes(1);
      expect(beforeRetry).not.toHaveBeenCalled();
    });
  });
});
