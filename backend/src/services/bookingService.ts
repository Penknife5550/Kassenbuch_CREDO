import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prismaClient';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

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

export async function isDayFinalized(schoolId: string, date: Date): Promise<boolean> {
  const closing = await prisma.dailyClosing.findUnique({
    where: {
      schoolId_closingDate: {
        schoolId,
        closingDate: date,
      },
    },
  });
  return !!closing;
}
