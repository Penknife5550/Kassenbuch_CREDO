import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { resolveAccountRemoval } from '../services/accountService';
import { getClientIp, getParam } from '../utils/request';

export const accountsRouter = Router();
accountsRouter.use(authenticate);

accountsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const schoolId = req.query.schoolId as string | undefined;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;

    // Deaktivierte Konten sind in Buchungsmaske und Auswertungen unsichtbar.
    // Nur die Konten-Verwaltung fordert sie ueber includeInactive=true an.
    const includeInactive = req.user?.role === 'ADMIN' && req.query.includeInactive === 'true';
    if (!includeInactive) where.isActive = true;

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
  defaultCostCenterId: z.string().uuid().nullable().optional(),
});

async function validateDefaultCostCenter(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const cc = await prisma.costCenter.findUnique({ where: { id }, select: { isActive: true } });
  if (!cc) return 'Kostenstelle nicht gefunden';
  if (!cc.isActive) return 'Kostenstelle ist inaktiv';
  return null;
}

accountsRouter.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const ccError = await validateDefaultCostCenter(parsed.data.defaultCostCenterId);
    if (ccError) {
      res.status(400).json({ error: ccError });
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
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      res.status(409).json({ error: 'Es gibt bereits ein Konto mit dieser Nummer und diesem Typ. Möglicherweise ist es deaktiviert — blenden Sie deaktivierte Konten ein und aktivieren Sie es wieder.' });
      return;
    }
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

    // Buchungs-Referenzen und Schul-Zuweisung entscheiden, ob geloescht,
    // deaktiviert oder gar nichts getan wird.
    const bookingCount = await prisma.booking.count({
      where: {
        OR: [
          { accountId },
          { counterAccountId: accountId },
        ],
      },
    });

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

    const removal = resolveAccountRemoval({
      bookingCount,
      assignedSchoolName: schoolAssignment?.name,
      isActive: account.isActive,
    });

    if (removal.kind === 'blocked') {
      res.status(409).json({ error: removal.message });
      return;
    }

    if (removal.kind === 'noop') {
      res.json({ message: removal.message, deactivated: true });
      return;
    }

    if (removal.kind === 'deactivate') {
      await prisma.account.update({ where: { id: accountId }, data: { isActive: false } });
    } else {
      await prisma.account.delete({ where: { id: accountId } });
    }

    try {
      await logAudit({
        userId: req.user!.userId,
        action: removal.kind === 'deactivate' ? 'DEACTIVATE_ACCOUNT' : 'DELETE_ACCOUNT',
        entityType: 'account',
        entityId: accountId,
        oldValue: account,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json({ message: removal.message, deactivated: removal.kind === 'deactivate' });
  } catch (err) {
    console.error('DELETE /accounts/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Deaktiviertes Konto wieder aktivieren. Bewusst ein eigener Endpunkt statt
// isActive im PUT-Schema: so gibt es genau einen Weg, ein Konto stillzulegen
// (DELETE) und genau einen, es zurueckzuholen.
accountsRouter.post('/:id/reactivate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const accountId = getParam(req, 'id');
    const existing = await prisma.account.findUnique({ where: { id: accountId } });
    if (!existing) {
      res.status(404).json({ error: 'Konto nicht gefunden' });
      return;
    }

    const account = await prisma.account.update({
      where: { id: accountId },
      data: { isActive: true },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'REACTIVATE_ACCOUNT',
        entityType: 'account',
        entityId: accountId,
        oldValue: existing,
        newValue: account,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(account);
  } catch (err) {
    console.error('POST /accounts/:id/reactivate error:', err);
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

    if (parsed.data.defaultCostCenterId !== undefined) {
      const ccError = await validateDefaultCostCenter(parsed.data.defaultCostCenterId);
      if (ccError) {
        res.status(400).json({ error: ccError });
        return;
      }
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
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      res.status(409).json({ error: 'Es gibt bereits ein Konto mit dieser Nummer und diesem Typ. Möglicherweise ist es deaktiviert — blenden Sie deaktivierte Konten ein und aktivieren Sie es wieder.' });
      return;
    }
    console.error('PUT /accounts/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
