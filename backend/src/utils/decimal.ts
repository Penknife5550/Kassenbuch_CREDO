import { Prisma } from '@prisma/client';

/**
 * Konvertiert Prisma.Decimal / number / string zuverlässig nach number.
 * Eine kanonische Stelle — vorher 3x dupliziert (qrService, dmsExportService,
 * dmsMappingService).
 */
export function decimalToNumber(amount: Prisma.Decimal | number | string): number {
  if (typeof amount === 'number') return amount;
  if (typeof amount === 'string') return Number(amount);
  if (amount && typeof (amount as Prisma.Decimal).toNumber === 'function') {
    return (amount as Prisma.Decimal).toNumber();
  }
  return Number(amount);
}
