import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp, getParam } from '../utils/request';

export const costCentersRouter = Router();
costCentersRouter.use(authenticate);

costCentersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const costCenters = await prisma.costCenter.findMany({
      orderBy: { code: 'asc' },
    });
    res.json(costCenters);
  } catch (err) {
    console.error('GET /cost-centers error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const costCenterSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  description: z.string().optional(),
});

costCentersRouter.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = costCenterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const costCenter = await prisma.costCenter.create({ data: parsed.data });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'CREATE_COST_CENTER',
        entityType: 'costCenter',
        entityId: costCenter.id,
        newValue: parsed.data,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(costCenter);
  } catch (err) {
    console.error('POST /cost-centers error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

costCentersRouter.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = costCenterSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.costCenter.findUnique({ where: { id: getParam(req, 'id') } });
    if (!existing) {
      res.status(404).json({ error: 'Kostenstelle nicht gefunden' });
      return;
    }

    const costCenter = await prisma.costCenter.update({
      where: { id: getParam(req, 'id') },
      data: parsed.data,
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_COST_CENTER',
        entityType: 'costCenter',
        entityId: costCenter.id,
        oldValue: existing,
        newValue: costCenter,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(costCenter);
  } catch (err) {
    console.error('PUT /cost-centers/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
