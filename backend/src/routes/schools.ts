import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp, getParam } from '../utils/request';

export const schoolsRouter = Router();
schoolsRouter.use(authenticate);

schoolsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const accountSelect = { select: { id: true, accountNumber: true, name: true } };
    const includeAccounts = {
      kasseAccount: accountSelect,
      anfangsbestandAccount: accountSelect,
      kassendifferenzAccount: accountSelect,
    };

    if (req.user!.role === 'ADMIN') {
      const schools = await prisma.school.findMany({
        include: includeAccounts,
        orderBy: { name: 'asc' },
      });
      res.json(schools);
    } else {
      if (!req.user!.schoolId) {
        res.json([]);
        return;
      }
      const school = await prisma.school.findUnique({
        where: { id: req.user!.schoolId },
        include: includeAccounts,
      });
      res.json(school ? [school] : []);
    }
  } catch (err) {
    console.error('GET /schools error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

schoolsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const school = await prisma.school.findUnique({ where: { id: getParam(req, 'id') } });
    if (!school) {
      res.status(404).json({ error: 'Schule nicht gefunden' });
      return;
    }
    if (req.user!.role !== 'ADMIN' && req.user!.schoolId !== school.id) {
      res.status(403).json({ error: 'Kein Zugriff auf diese Schule' });
      return;
    }
    res.json(school);
  } catch (err) {
    console.error('GET /schools/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const schoolSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(20),
  address: z.string().optional(),
  kasseAccountId: z.string().uuid().nullable().optional(),
  anfangsbestandAccountId: z.string().uuid().nullable().optional(),
  kassendifferenzAccountId: z.string().uuid().nullable().optional(),
});

schoolsRouter.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = schoolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const school = await prisma.school.create({ data: parsed.data });

    await prisma.receiptSequence.create({
      data: { schoolId: school.id, lastNumber: 0 },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'CREATE_SCHOOL',
        entityType: 'school',
        entityId: school.id,
        newValue: parsed.data,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(school);
  } catch (err) {
    console.error('POST /schools error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

schoolsRouter.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = schoolSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.school.findUnique({ where: { id: getParam(req, 'id') } });
    if (!existing) {
      res.status(404).json({ error: 'Schule nicht gefunden' });
      return;
    }

    const school = await prisma.school.update({
      where: { id: getParam(req, 'id') },
      data: parsed.data,
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_SCHOOL',
        entityType: 'school',
        entityId: school.id,
        oldValue: existing,
        newValue: school,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(school);
  } catch (err) {
    console.error('PUT /schools/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
