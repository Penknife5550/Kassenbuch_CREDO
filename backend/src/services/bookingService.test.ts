import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
