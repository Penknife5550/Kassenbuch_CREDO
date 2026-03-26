import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../prismaClient', () => ({
  prisma: {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  },
}));

import { prisma } from '../prismaClient';
import { logAudit } from './auditService';

const mockCreate = vi.mocked(prisma.auditLog.create);

describe('auditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logAudit', () => {
    it('should create an audit log entry with all fields', async () => {
      await logAudit({
        userId: 'user-1',
        action: 'CREATE_BOOKING',
        entityType: 'booking',
        entityId: 'booking-123',
        oldValue: { amount: 100 },
        newValue: { amount: 200 },
        ipAddress: '192.168.1.1',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: 'CREATE_BOOKING',
          entityType: 'booking',
          entityId: 'booking-123',
          oldValue: JSON.stringify({ amount: 100 }),
          newValue: JSON.stringify({ amount: 200 }),
          ipAddress: '192.168.1.1',
        },
      });
    });

    it('should store null for oldValue when not provided', async () => {
      await logAudit({
        userId: 'user-1',
        action: 'LOGIN',
        entityType: 'user',
        entityId: 'user-1',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: 'LOGIN',
          entityType: 'user',
          entityId: 'user-1',
          oldValue: null,
          newValue: null,
          ipAddress: undefined,
        },
      });
    });

    it('should stringify complex objects in oldValue and newValue', async () => {
      const complexValue = {
        nested: { data: [1, 2, 3] },
        description: 'test',
      };

      await logAudit({
        userId: 'user-1',
        action: 'UPDATE_SCHOOL',
        entityType: 'school',
        entityId: 'school-1',
        oldValue: complexValue,
        newValue: complexValue,
      });

      const call = mockCreate.mock.calls[0][0];
      expect(call.data.oldValue).toBe(JSON.stringify(complexValue));
      expect(call.data.newValue).toBe(JSON.stringify(complexValue));
    });

    it('should handle missing optional fields gracefully', async () => {
      await logAudit({
        userId: 'user-1',
        action: 'SOME_ACTION',
        entityType: 'entity',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: 'SOME_ACTION',
          entityType: 'entity',
          entityId: undefined,
          oldValue: null,
          newValue: null,
          ipAddress: undefined,
        },
      });
    });
  });
});
