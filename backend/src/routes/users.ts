import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp, getParam } from '../utils/request';

export const usersRouter = Router();
usersRouter.use(authenticate, requireAdmin);

usersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, username: true, displayName: true, role: true,
        schoolId: true, isActive: true, createdAt: true,
        school: { select: { id: true, name: true, code: true } },
      },
      orderBy: { displayName: 'asc' },
    });
    res.json(users);
  } catch (err) {
    console.error('GET /users error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  displayName: z.string().min(1),
  role: z.enum(['ADMIN', 'USER']),
  schoolId: z.string().uuid().nullable(),
});

usersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const { password, ...data } = parsed.data;

    if (data.role === 'USER' && !data.schoolId) {
      res.status(400).json({ error: 'Benutzer mit Rolle USER müssen einer Schule zugeordnet sein' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { username: data.username } });
    if (existing) {
      res.status(409).json({ error: 'Benutzername bereits vergeben' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { ...data, passwordHash },
      select: {
        id: true, username: true, displayName: true, role: true,
        schoolId: true, isActive: true, createdAt: true,
      },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'CREATE_USER',
        entityType: 'user',
        entityId: user.id,
        newValue: { username: data.username, role: data.role, schoolId: data.schoolId },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(user);
  } catch (err) {
    console.error('POST /users error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
  schoolId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

usersRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id: getParam(req, 'id') } });
    if (!existing) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    const { password, ...data } = parsed.data;
    const updateData: Record<string, unknown> = { ...data };
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({
      where: { id: getParam(req, 'id') },
      data: updateData,
      select: {
        id: true, username: true, displayName: true, role: true,
        schoolId: true, isActive: true, createdAt: true,
      },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_USER',
        entityType: 'user',
        entityId: user.id,
        oldValue: { role: existing.role, schoolId: existing.schoolId, isActive: existing.isActive },
        newValue: data,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(user);
  } catch (err) {
    console.error('PUT /users/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
