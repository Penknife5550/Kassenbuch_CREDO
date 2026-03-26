import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { formatDatevDate, formatAmount, escapeField, formatTimestamp } from './datevExportService';

describe('datevExportService', () => {
  describe('formatDatevDate', () => {
    it('should format a date as DDMM with zero-padding', () => {
      // January 5 -> "0501"
      const date = new Date(2024, 0, 5); // Month is 0-indexed
      expect(formatDatevDate(date)).toBe('0501');
    });

    it('should format single-digit day with leading zero', () => {
      const date = new Date(2024, 2, 3); // March 3
      expect(formatDatevDate(date)).toBe('0303');
    });

    it('should format single-digit month with leading zero', () => {
      const date = new Date(2024, 0, 15); // January 15
      expect(formatDatevDate(date)).toBe('1501');
    });

    it('should format double-digit day and month correctly', () => {
      const date = new Date(2024, 11, 25); // December 25
      expect(formatDatevDate(date)).toBe('2512');
    });

    it('should handle month boundary: January = 01', () => {
      const date = new Date(2024, 0, 1);
      expect(formatDatevDate(date)).toBe('0101');
    });

    it('should handle month boundary: December = 12', () => {
      const date = new Date(2024, 11, 31);
      expect(formatDatevDate(date)).toBe('3112');
    });

    it('should handle February 29 (leap year)', () => {
      const date = new Date(2024, 1, 29); // February 29, 2024 is leap year
      expect(formatDatevDate(date)).toBe('2902');
    });

    it('should handle September (month 09, common edge case)', () => {
      const date = new Date(2024, 8, 9); // September 9
      expect(formatDatevDate(date)).toBe('0909');
    });
  });

  describe('formatAmount', () => {
    it('should format integer amount with comma separator', () => {
      const amount = new Prisma.Decimal(100);
      expect(formatAmount(amount)).toBe('100,00');
    });

    it('should format decimal amount with comma separator', () => {
      const amount = new Prisma.Decimal(99.99);
      expect(formatAmount(amount)).toBe('99,99');
    });

    it('should format amount with one decimal place to two', () => {
      const amount = new Prisma.Decimal(50.5);
      expect(formatAmount(amount)).toBe('50,50');
    });

    it('should format zero amount', () => {
      const amount = new Prisma.Decimal(0);
      expect(formatAmount(amount)).toBe('0,00');
    });

    it('should format small amount', () => {
      const amount = new Prisma.Decimal(0.01);
      expect(formatAmount(amount)).toBe('0,01');
    });

    it('should format large amount', () => {
      const amount = new Prisma.Decimal(999999.99);
      expect(formatAmount(amount)).toBe('999999,99');
    });

    it('should round to two decimal places', () => {
      const amount = new Prisma.Decimal('1.999');
      expect(formatAmount(amount)).toBe('2,00');
    });

    it('should format amount with three decimal places by rounding', () => {
      const amount = new Prisma.Decimal('1.234');
      expect(formatAmount(amount)).toBe('1,23');
    });
  });

  describe('escapeField', () => {
    it('should wrap simple string in double quotes', () => {
      expect(escapeField('Hello')).toBe('"Hello"');
    });

    it('should escape double quotes by doubling them', () => {
      expect(escapeField('He said "hello"')).toBe('"He said ""hello"""');
    });

    it('should wrap string containing semicolons', () => {
      // Semicolons are the DATEV delimiter, so they must be escaped
      expect(escapeField('foo;bar')).toBe('"foo;bar"');
    });

    it('should escape both quotes and semicolons', () => {
      expect(escapeField('a"b;c')).toBe('"a""b;c"');
    });

    it('should handle empty string', () => {
      expect(escapeField('')).toBe('""');
    });

    it('should wrap regular text without special chars in double quotes', () => {
      expect(escapeField('Buchung Schulmaterial')).toBe('"Buchung Schulmaterial"');
    });

    it('should handle string with only a double quote', () => {
      expect(escapeField('"')).toBe('""""');
    });

    it('should handle string with only a semicolon', () => {
      expect(escapeField(';')).toBe('";"');
    });
  });

  describe('formatTimestamp', () => {
    it('should return a string of length 17 (YYYYMMDDHHmmssSSS)', () => {
      const result = formatTimestamp();
      expect(result).toMatch(/^\d{17}$/);
    });

    it('should start with the current year', () => {
      const result = formatTimestamp();
      const currentYear = new Date().getFullYear().toString();
      expect(result.substring(0, 4)).toBe(currentYear);
    });
  });
});
