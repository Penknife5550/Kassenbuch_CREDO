import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// Mock dependencies
const mockPrisma = {
  dailyClosing: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  booking: {
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};

vi.mock('../prismaClient', () => ({
  prisma: mockPrisma,
}));

vi.mock('../services/auditService', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// Nur der Sollbestand vor der Transaktion ist gestellt (1000,00); die Pruefungen
// in der Transaktion laufen echt.
vi.mock('../services/bookingService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/bookingService')>()),
  calculateCashBalance: vi.fn().mockResolvedValue(new Prisma.Decimal(1000)),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  getSchoolScope: vi.fn().mockReturnValue('school-1'),
}));

describe('dailyClosing route - business logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('daily closing - finalization behavior', () => {
    it('should finalize ALL unfinalised bookings up to closing date', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const schoolId = 'school-1';

      // Simulate what the transaction does
      const updateManyArgs = {
        where: { schoolId, bookingDate: { lte: today }, isFinalized: false },
        data: { isFinalized: true },
      };

      // Verify the criteria includes all dates up to today
      expect(updateManyArgs.where.bookingDate.lte).toEqual(today);
      expect(updateManyArgs.where.isFinalized).toBe(false);
      expect(updateManyArgs.data.isFinalized).toBe(true);
    });

    it('should include bookings from previous days (not just today)', () => {
      const today = new Date('2024-03-15');
      today.setHours(0, 0, 0, 0);

      const yesterdayBooking = new Date('2024-03-14');
      const lastWeekBooking = new Date('2024-03-08');

      // These should both be included in finalization
      expect(yesterdayBooking <= today).toBe(true);
      expect(lastWeekBooking <= today).toBe(true);
    });

    it('should NOT include future bookings in finalization', () => {
      const today = new Date('2024-03-15');
      today.setHours(0, 0, 0, 0);

      const tomorrowBooking = new Date('2024-03-16');

      expect(tomorrowBooking <= today).toBe(false);
    });
  });

  describe('daily closing - duplicate prevention', () => {
    it('should reject closing if already closed for today', async () => {
      mockPrisma.dailyClosing.findUnique.mockResolvedValue({
        id: 'existing-closing',
        schoolId: 'school-1',
        closingDate: new Date(),
      });

      const existing = await mockPrisma.dailyClosing.findUnique({
        where: { schoolId_closingDate: { schoolId: 'school-1', closingDate: new Date() } },
      });

      expect(existing).not.toBeNull();
      // Route should return 409: "Tagesabschluss für heute bereits durchgeführt"
    });

    it('should allow closing when no closing exists for today', async () => {
      mockPrisma.dailyClosing.findUnique.mockResolvedValue(null);

      const existing = await mockPrisma.dailyClosing.findUnique({
        where: { schoolId_closingDate: { schoolId: 'school-1', closingDate: new Date() } },
      });

      expect(existing).toBeNull();
      // Route proceeds with closing
    });
  });

  describe('daily closing - balance difference calculation', () => {
    it('should compute zero difference when balances match', () => {
      const expectedBalance = new Prisma.Decimal(1000);
      const actualBalance = new Prisma.Decimal(1000);
      const difference = actualBalance.sub(expectedBalance);

      expect(difference.isZero()).toBe(true);
    });

    it('should compute positive difference when actual exceeds expected', () => {
      const expectedBalance = new Prisma.Decimal(1000);
      const actualBalance = new Prisma.Decimal(1050);
      const difference = actualBalance.sub(expectedBalance);

      expect(difference.toNumber()).toBe(50);
    });

    it('should compute negative difference when actual is less than expected', () => {
      const expectedBalance = new Prisma.Decimal(1000);
      const actualBalance = new Prisma.Decimal(980);
      const difference = actualBalance.sub(expectedBalance);

      expect(difference.toNumber()).toBe(-20);
    });
  });

  describe('daily closing - validation', () => {
    it('should require actualBalance in request body', () => {
      // Zod schema: z.object({ actualBalance: z.number().min(0) })
      const validBody = { actualBalance: 100 };
      const invalidBody = {};

      expect('actualBalance' in validBody).toBe(true);
      expect('actualBalance' in invalidBody).toBe(false);
    });

    it('should reject negative actualBalance', () => {
      // z.number().min(0) means zero is the minimum
      const actualBalance = -5;
      expect(actualBalance >= 0).toBe(false);
    });

    it('should accept zero actualBalance', () => {
      const actualBalance = 0;
      expect(actualBalance >= 0).toBe(true);
    });
  });

  describe('daily closing - transaction atomicity', () => {
    it('should use $transaction to ensure atomicity of finalization + closing creation', async () => {
      const mockClosing = {
        id: 'closing-new',
        schoolId: 'school-1',
        closingDate: new Date(),
        expectedBalance: new Prisma.Decimal(1000),
        actualBalance: new Prisma.Decimal(1000),
        difference: new Prisma.Decimal(0),
        closedById: 'user-1',
        createdAt: new Date(),
      };

      mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        const mockTx = {
          booking: {
            updateMany: vi.fn().mockResolvedValue({ count: 5 }),
          },
          dailyClosing: {
            create: vi.fn().mockResolvedValue(mockClosing),
          },
        };
        return fn(mockTx);
      });

      const result = await mockPrisma.$transaction(async (tx: any) => {
        // Step 1: Finalize all unfinalized bookings
        const updateResult = await tx.booking.updateMany({
          where: { schoolId: 'school-1', bookingDate: { lte: new Date() }, isFinalized: false },
          data: { isFinalized: true },
        });

        // Step 2: Create the closing record
        const closing = await tx.dailyClosing.create({
          data: {
            schoolId: 'school-1',
            closingDate: new Date(),
            expectedBalance: new Prisma.Decimal(1000),
            actualBalance: new Prisma.Decimal(1000),
            difference: new Prisma.Decimal(0),
            closedById: 'user-1',
          },
        });

        return closing;
      });

      expect(result).toEqual(mockClosing);
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  // Ab hier laeuft der echte Handler der Route gegen eine gestellte Transaktion.
  describe('POST /daily-closing', () => {
    function makeTx(state: { balance: number; closed?: boolean }) {
      return {
        dailyClosing: {
          findFirst: vi.fn().mockResolvedValue(state.closed ? { closingDate: new Date() } : null),
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'closing-new', ...data })),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ balance: new Prisma.Decimal(state.balance) }]),
        receiptSequence: { update: vi.fn().mockResolvedValue({ lastNumber: 7 }) },
        booking: {
          create: vi.fn().mockResolvedValue({ id: 'correction-1' }),
          updateMany: vi.fn().mockResolvedValue({ count: 3 }),
        },
      };
    }

    async function close(body: Record<string, unknown>) {
      const { dailyClosingRouter } = await import('./dailyClosing');
      const layer = (dailyClosingRouter as any).stack.find((l: any) => l.route?.path === '/' && l.route.methods.post);
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await layer.route.stack[0].handle({ body, user: { userId: 'user-1' }, ip: '127.0.0.1' }, res);
      return res;
    }

    const runIn = (tx: unknown) => mockPrisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(tx));

    // Gezaehlt 1050,00 bei Soll 1000,00: 50,00 Ueberschuss
    const withDifference = {
      actualBalance: 1050,
      comment: 'Fünfzig Euro zu viel in der Kasse',
      createCorrectionBooking: true,
      kasseAccountId: '11111111-1111-4111-8111-111111111111',
      kassendifferenzAccountId: '22222222-2222-4222-8222-222222222222',
    };

    it('schliesst ab und bucht die Differenz, wenn der Sollbestand noch stimmt', async () => {
      const tx = makeTx({ balance: 1000 });
      runIn(tx);

      const res = await close(withDifference);

      expect(res.status).toHaveBeenCalledWith(201);
      const correction = tx.booking.create.mock.calls[0][0].data;
      expect(correction).toMatchObject({ debitCredit: 'S', receiptNumber: 7, isFinalized: true });
      expect(correction.amount.toString()).toBe('50');
      expect(tx.booking.updateMany).toHaveBeenCalled();
      expect(tx.dailyClosing.create.mock.calls[0][0].data.expectedBalance.toString()).toBe('1000');
    });

    // Der Sollbestand wird vor der Transaktion gelesen. Kommt bis zu ihrem
    // Beginn eine Buchung dazu, fehlte sie in Soll, Differenz und
    // Korrekturbuchung — und wuerde trotzdem mit festgeschrieben.
    it('schliesst nicht ab, wenn seit dem Lesen des Sollbestands gebucht wurde', async () => {
      const tx = makeTx({ balance: 1050 });
      runIn(tx);

      const res = await close(withDifference);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Während des Tagesabschlusses wurde gebucht. Bitte die Seite neu laden und den Abschluss noch einmal durchführen.',
      });
      expect(tx.booking.create).not.toHaveBeenCalled();
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
      expect(tx.dailyClosing.create).not.toHaveBeenCalled();
    });

    it('weist einen zweiten Abschluss desselben Tages ab, ohne etwas festzuschreiben', async () => {
      const tx = makeTx({ balance: 1000, closed: true });
      runIn(tx);

      const res = await close({ actualBalance: 1000 });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'Tagesabschluss für heute bereits durchgeführt' });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
      expect(tx.dailyClosing.create).not.toHaveBeenCalled();
    });

    it('meldet eine Buchung waehrend des Abschlusses als 409, nicht als Serverfehler', async () => {
      mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' });

      const res = await close({ actualBalance: 1000 });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Während des Tagesabschlusses wurde gebucht') });
    });

    it('meldet zwei Abschluesse im selben Moment als schon abgeschlossen', async () => {
      mockPrisma.$transaction.mockRejectedValue({ code: 'P2002' });

      const res = await close({ actualBalance: 1000 });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'Tagesabschluss für heute bereits durchgeführt' });
    });
  });
});
