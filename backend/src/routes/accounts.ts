import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp, getParam } from '../utils/request';

export const accountsRouter = Router();
accountsRouter.use(authenticate);

accountsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const schoolId = req.query.schoolId as string | undefined;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;

    let accounts = await prisma.account.findMany({
      where,
      orderBy: { accountNumber: 'asc' },
    });

    // For non-admin users or when schoolId is provided: filter KASSE accounts
    // to only show the one assigned to the school
    const filterSchoolId = req.user?.role === 'ADMIN' ? schoolId : req.user?.schoolId;
    if (filterSchoolId) {
      const school = await prisma.school.findUnique({
        where: { id: filterSchoolId },
        select: { kasseAccountId: true },
      });
      if (school?.kasseAccountId) {
        accounts = accounts.filter(
          (a) => a.type !== 'KASSE' || a.id === school.kasseAccountId
        );
      }
    }

    res.json(accounts);
  } catch (err) {
    console.error('GET /accounts error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const accountSchema = z.object({
  accountNumber: z.string().min(1).max(10),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['KASSE', 'TRANSIT', 'GEGENKONTO']),
});

accountsRouter.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const account = await prisma.account.create({ data: parsed.data });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'CREATE_ACCOUNT',
        entityType: 'account',
        entityId: account.id,
        newValue: parsed.data,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(account);
  } catch (err) {
    console.error('POST /accounts error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

accountsRouter.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const accountId = getParam(req, 'id');
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      res.status(404).json({ error: 'Konto nicht gefunden' });
      return;
    }

    // Prüfen ob Buchungen auf das Konto referenzieren
    const bookingCount = await prisma.booking.count({
      where: {
        OR: [
          { accountId },
          { counterAccountId: accountId },
        ],
      },
    });
    if (bookingCount > 0) {
      res.status(409).json({ error: `Konto kann nicht gelöscht werden — ${bookingCount} Buchung(en) referenzieren dieses Konto.` });
      return;
    }

    // Prüfen ob als Kassen-/Anfangsbestands-/Kassendifferenzkonto zugewiesen
    const schoolAssignment = await prisma.school.findFirst({
      where: {
        OR: [
          { kasseAccountId: accountId },
          { anfangsbestandAccountId: accountId },
          { kassendifferenzAccountId: accountId },
        ],
      },
      select: { name: true },
    });
    if (schoolAssignment) {
      res.status(409).json({ error: `Konto kann nicht gelöscht werden — zugewiesen an Schule "${schoolAssignment.name}".` });
      return;
    }

    await prisma.account.delete({ where: { id: accountId } });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'DELETE_ACCOUNT',
        entityType: 'account',
        entityId: accountId,
        oldValue: account,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json({ message: 'Konto gelöscht' });
  } catch (err) {
    console.error('DELETE /accounts/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

accountsRouter.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = accountSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.account.findUnique({ where: { id: getParam(req, 'id') } });
    if (!existing) {
      res.status(404).json({ error: 'Konto nicht gefunden' });
      return;
    }

    const account = await prisma.account.update({
      where: { id: getParam(req, 'id') },
      data: parsed.data,
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_ACCOUNT',
        entityType: 'account',
        entityId: account.id,
        oldValue: existing,
        newValue: account,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(account);
  } catch (err) {
    console.error('PUT /accounts/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
