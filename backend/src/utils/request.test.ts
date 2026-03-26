import { describe, it, expect } from 'vitest';
import { Request } from 'express';
import { getClientIp, getParam } from './request';

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: undefined,
    params: {},
    ...overrides,
  } as unknown as Request;
}

describe('request utils', () => {
  describe('getClientIp', () => {
    it('should return string IP address', () => {
      const req = createMockRequest({ ip: '192.168.1.1' });
      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('should return undefined when no IP', () => {
      const req = createMockRequest({ ip: undefined });
      expect(getClientIp(req)).toBeUndefined();
    });

    it('should return first element if IP is array', () => {
      const req = createMockRequest({ ip: ['10.0.0.1', '192.168.1.1'] as unknown as string });
      expect(getClientIp(req)).toBe('10.0.0.1');
    });
  });

  describe('getParam', () => {
    it('should return parameter value as string', () => {
      const req = createMockRequest({
        params: { id: 'abc-123' } as Record<string, string>,
      });
      expect(getParam(req, 'id')).toBe('abc-123');
    });

    it('should return first element if parameter is array', () => {
      const req = createMockRequest({
        params: { id: ['first', 'second'] } as unknown as Record<string, string>,
      });
      expect(getParam(req, 'id')).toBe('first');
    });

    it('should return undefined for missing parameter', () => {
      const req = createMockRequest({ params: {} as Record<string, string> });
      expect(getParam(req, 'nonExistent')).toBeUndefined();
    });
  });
});
