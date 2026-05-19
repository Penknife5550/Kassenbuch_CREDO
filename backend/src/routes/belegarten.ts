import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp, getParam } from '../utils/request';

export const belegartenRouter = Router();
belegartenRouter.use(authenticate);

// Liste der aktiven Belegarten — USER sieht die eigene Schule, ADMIN frei wählbar via ?schoolId=
belegartenRouter.get('/', async (req: Request, res: Response) => {
  try {
    const schoolId = req.user!.role === 'ADMIN'
      ? (req.query.schoolId as string | undefined)
      : req.user!.schoolId;

    if (!schoolId) {
      res.json([]);
      return;
    }

    const list = await prisma.belegart.findMany({
      where: { schoolId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    res.json(list);
  } catch (err) {
    console.error('GET /belegarten error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Admin: alle Belegarten einer Schule (auch inaktive)
belegartenRouter.get('/admin/:schoolId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const list = await prisma.belegart.findMany({
      where: { schoolId: getParam(req, 'schoolId') },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    res.json(list);
  } catch (err) {
    console.error('GET /belegarten/admin/:schoolId error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const CODE_REGEX = /^[A-Z][A-Z0-9_]{0,31}$/;
const belegartCreateSchema = z.object({
  code: z.string().regex(CODE_REGEX, 'Code muss UPPER_SNAKE sein (max 32 Zeichen)'),
  label: z.string().min(1).max(80),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});
const belegartUpdateSchema = belegartCreateSchema.partial();

belegartenRouter.post('/admin/:schoolId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schoolId = getParam(req, 'schoolId');
    const parsed = belegartCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      res.status(404).json({ error: 'Schule nicht gefunden' });
      return;
    }

    const created = await prisma.belegart.create({
      data: { schoolId, ...parsed.data },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'CREATE_BELEGART',
        entityType: 'belegart',
        entityId: created.id,
        newValue: created,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(created);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      res.status(409).json({ error: 'Belegart-Code ist für diese Schule bereits vergeben.' });
      return;
    }
    console.error('POST /belegarten/admin/:schoolId error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

belegartenRouter.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    const parsed = belegartUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.belegart.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Belegart nicht gefunden' });
      return;
    }

    const updated = await prisma.belegart.update({
      where: { id },
      data: parsed.data,
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_BELEGART',
        entityType: 'belegart',
        entityId: id,
        oldValue: existing,
        newValue: updated,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(updated);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      res.status(409).json({ error: 'Belegart-Code ist für diese Schule bereits vergeben.' });
      return;
    }
    console.error('PUT /belegarten/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

belegartenRouter.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    const existing = await prisma.belegart.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Belegart nicht gefunden' });
      return;
    }

    const receiptCount = await prisma.bookingReceipt.count({ where: { belegartId: id } });
    if (receiptCount > 0) {
      res.status(409).json({
        error: `Belegart kann nicht gelöscht werden – sie ist ${receiptCount}-mal in Belegen referenziert. Bitte stattdessen deaktivieren.`,
      });
      return;
    }

    // Default-Verweis aus Schule entfernen, falls vorhanden
    await prisma.school.updateMany({
      where: { belegartDefaultId: id },
      data: { belegartDefaultId: null },
    });

    await prisma.belegart.delete({ where: { id } });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'DELETE_BELEGART',
        entityType: 'belegart',
        entityId: id,
        oldValue: existing,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /belegarten/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
