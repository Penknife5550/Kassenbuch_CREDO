import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, requireAdmin, getSchoolScope, AuthPayload } from './auth';

// Mock the config module
vi.mock('../config', () => ({
  config: {
    jwtSecret: 'test-secret-key',
    jwtExpiresIn: 28800,
    port: 3000,
    nodeEnv: 'test',
  },
}));

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response & { statusCode: number; body: unknown } {
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(data: unknown) {
      this.body = data;
      return this as Response;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
}

describe('auth middleware', () => {
  describe('authenticate', () => {
    it('should reject request without Authorization header', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Nicht authentifiziert' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request with non-Bearer auth header', () => {
      const req = createMockRequest({
        headers: { authorization: 'Basic dXNlcjpwYXNz' } as Record<string, string>,
      });
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Nicht authentifiziert' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request with invalid token', () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid-token' } as Record<string, string>,
      });
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Token ungültig oder abgelaufen' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request with expired token', () => {
      const payload: AuthPayload = {
        userId: 'user-1',
        username: 'admin',
        role: 'ADMIN',
        schoolId: null,
      };
      // Create a token that expired 1 hour ago
      const token = jwt.sign(payload, 'test-secret-key', { expiresIn: -3600 });

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` } as Record<string, string>,
      });
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Token ungültig oder abgelaufen' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept valid token and set req.user', () => {
      const payload: AuthPayload = {
        userId: 'user-1',
        username: 'admin',
        role: 'ADMIN',
        schoolId: null,
      };
      const token = jwt.sign(payload, 'test-secret-key', { expiresIn: 3600 });

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` } as Record<string, string>,
      });
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.user).toBeDefined();
      expect(req.user!.userId).toBe('user-1');
      expect(req.user!.username).toBe('admin');
      expect(req.user!.role).toBe('ADMIN');
      expect(req.user!.schoolId).toBeNull();
    });

    it('should accept valid token for USER role with schoolId', () => {
      const payload: AuthPayload = {
        userId: 'user-2',
        username: 'lehrer',
        role: 'USER',
        schoolId: 'school-abc',
      };
      const token = jwt.sign(payload, 'test-secret-key', { expiresIn: 3600 });

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` } as Record<string, string>,
      });
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.user!.role).toBe('USER');
      expect(req.user!.schoolId).toBe('school-abc');
    });

    it('should reject token signed with wrong secret', () => {
      const payload: AuthPayload = {
        userId: 'user-1',
        username: 'admin',
        role: 'ADMIN',
        schoolId: null,
      };
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: 3600 });

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` } as Record<string, string>,
      });
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Token ungültig oder abgelaufen' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject Bearer header with empty token', () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer ' } as Record<string, string>,
      });
      const res = createMockResponse();
      const next = vi.fn();

      authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Token ungültig oder abgelaufen' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireAdmin', () => {
    it('should allow ADMIN role to proceed', () => {
      const req = createMockRequest();
      req.user = {
        userId: 'user-1',
        username: 'admin',
        role: 'ADMIN',
        schoolId: null,
      };
      const res = createMockResponse();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('should reject USER role with 403', () => {
      const req = createMockRequest();
      req.user = {
        userId: 'user-2',
        username: 'lehrer',
        role: 'USER',
        schoolId: 'school-1',
      };
      const res = createMockResponse();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Nur für Administratoren' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request without user object', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Nur für Administratoren' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('getSchoolScope', () => {
    it('should return schoolId from query for ADMIN user', () => {
      const req = createMockRequest({
        query: { schoolId: 'school-from-query' },
      });
      req.user = {
        userId: 'admin-1',
        username: 'admin',
        role: 'ADMIN',
        schoolId: null,
      };

      const result = getSchoolScope(req);
      expect(result).toBe('school-from-query');
    });

    it('should return null for ADMIN user without query schoolId', () => {
      const req = createMockRequest({ query: {} });
      req.user = {
        userId: 'admin-1',
        username: 'admin',
        role: 'ADMIN',
        schoolId: null,
      };

      const result = getSchoolScope(req);
      expect(result).toBeNull();
    });

    it('should return user schoolId for USER role (ignore query)', () => {
      const req = createMockRequest({
        query: { schoolId: 'some-other-school' },
      });
      req.user = {
        userId: 'user-1',
        username: 'lehrer',
        role: 'USER',
        schoolId: 'user-assigned-school',
      };

      const result = getSchoolScope(req);
      expect(result).toBe('user-assigned-school');
    });

    it('should return null for USER without schoolId', () => {
      const req = createMockRequest();
      req.user = {
        userId: 'user-1',
        username: 'lehrer',
        role: 'USER',
        schoolId: null,
      };

      const result = getSchoolScope(req);
      expect(result).toBeNull();
    });

    it('should return null when user is undefined', () => {
      const req = createMockRequest();

      const result = getSchoolScope(req);
      expect(result).toBeNull();
    });
  });
});
