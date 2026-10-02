import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

// Mock the prismaClient module before importing the service
vi.mock('../prismaClient', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    dailyClosing: {
      findUnique: vi.fn(),
    },
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
  isDayFinalized,
  resolveBookingDate,
  createBookingInTx,
  bookingErrorToResponse,
  retryOnWriteConflict,
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

  describe('isDayFinalized', () => {
    it('should return true when a daily closing exists for the date', async () => {
      vi.mocked(prisma.dailyClosing.findUnique).mockResolvedValue({
        id: 'closing-1',
        schoolId: 'school-1',
        closingDate: new Date('2024-03-15'),
        expectedBalance: new Prisma.Decimal(1000),
        actualBalance: new Prisma.Decimal(1000),
        difference: new Prisma.Decimal(0),
        closedById: 'user-1',
        createdAt: new Date(),
      });

      const result = await isDayFinalized('school-1', new Date('2024-03-15'));

      expect(result).toBe(true);
    });

    it('should return false when no daily closing exists', async () => {
      vi.mocked(prisma.dailyClosing.findUnique).mockResolvedValue(null);

      const result = await isDayFinalized('school-1', new Date('2024-03-15'));

      expect(result).toBe(false);
    });

    it('should query with correct schoolId and date composite key', async () => {
      vi.mocked(prisma.dailyClosing.findUnique).mockResolvedValue(null);

      const testDate = new Date('2024-06-01');
      await isDayFinalized('school-abc', testDate);

      expect(prisma.dailyClosing.findUnique).toHaveBeenCalledWith({
        where: {
          schoolId_closingDate: {
            schoolId: 'school-abc',
            closingDate: testDate,
          },
        },
      });
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

    it('uebernimmt ein Datum in der Vergangenheit', () => {
      const result = resolveBookingDate('2024-03-15');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.date).toEqual(midnight(new Date('2024-03-15')));
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

    function makeTx(balance: number) {
      return {
        $queryRaw: vi.fn().mockResolvedValue([{ balance: new Prisma.Decimal(balance) }]),
        receiptSequence: { update: vi.fn().mockResolvedValue({ lastNumber: 43 }) },
        booking: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'booking-1', ...data })) },
      };
    }

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
  });

  describe('bookingErrorToResponse', () => {
    it('macht aus dem Saldo-Fehler eine 409 ohne das interne Praefix', () => {
      const result = bookingErrorToResponse(new Error('BALANCE:Kassenbestand darf nicht negativ werden. Aktueller Bestand: 50 EUR'));

      expect(result).toEqual({
        status: 409,
        error: 'Kassenbestand darf nicht negativ werden. Aktueller Bestand: 50 EUR',
      });
    });

    it('nennt bei verletztem Fremdschluessel die Kostenstelle oder das Konto', () => {
      const costCenter = { code: 'P2003', meta: { field_name: 'bookings_cost_center_id_fkey (index)' } };
      const account = { code: 'P2003', meta: { field_name: 'bookings_counter_account_id_fkey (index)' } };

      expect(bookingErrorToResponse(costCenter)).toEqual({ status: 400, error: COST_CENTER_GONE });
      expect(bookingErrorToResponse(account)).toEqual({ status: 400, error: ACCOUNT_GONE });
    });

    // Vorher lief dieser Fall als "Interner Serverfehler" auf.
    it('macht aus einer parallelen Buchung eine 409 mit Aufforderung zum Wiederholen', () => {
      expect(bookingErrorToResponse({ code: 'P2034' })).toEqual({ status: 409, error: WRITE_CONFLICT });
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
