import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { resolveCostCenterRemoval, isSeedDefaultCostCenter } from '../services/costCenterService';
import { getClientIp, getParam } from '../utils/request';

export const costCentersRouter = Router();
costCentersRouter.use(authenticate);

costCentersRouter.get('/', async (req: Request, res: Response) => {
  try {
    // Deaktivierte Kostenstellen sind in Buchungsmaske und Auswertungen
    // unsichtbar. Nur die Kostenstellen-Verwaltung fordert sie ueber
    // includeInactive=true an.
    const includeInactive = req.user?.role === 'ADMIN' && req.query.includeInactive === 'true';

    const costCenters = await prisma.costCenter.findMany({
      where: includeInactive ? {} : { isActive: true },
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

const DUPLICATE_CODE_MESSAGE =
  'Es gibt bereits eine Kostenstelle mit diesem Kürzel. Möglicherweise ist sie deaktiviert — blenden Sie deaktivierte Kostenstellen ein und aktivieren Sie sie wieder.';

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
    // Eine deaktivierte Kostenstelle belegt ihr Kuerzel weiter (code ist unique).
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      res.status(409).json({ error: DUPLICATE_CODE_MESSAGE });
      return;
    }
    console.error('POST /cost-centers error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

costCentersRouter.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const costCenterId = getParam(req, 'id');
    const costCenter = await prisma.costCenter.findUnique({ where: { id: costCenterId } });
    if (!costCenter) {
      res.status(404).json({ error: 'Kostenstelle nicht gefunden' });
      return;
    }

    // Buchungs-Referenzen und Konto-Zuweisung entscheiden, ob geloescht,
    // deaktiviert oder gar nichts getan wird.
    const bookingCount = await prisma.booking.count({ where: { costCenterId } });

    // Bewusst ohne isActive-Filter: auch ein deaktiviertes Konto blockiert,
    // sonst bliebe es mit einer Standard-Kostenstelle zurueck, die es nicht
    // mehr gibt — und liesse sich anschliessend nicht mehr speichern.
    const blockingAccounts = await prisma.account.findMany({
      where: { defaultCostCenterId: costCenterId },
      select: { accountNumber: true, name: true, isActive: true },
      orderBy: { accountNumber: 'asc' },
    });

    const removal = resolveCostCenterRemoval({
      bookingCount,
      defaultForAccounts: blockingAccounts.map((a) => ({
        label: `${a.accountNumber} – ${a.name}`,
        isActive: a.isActive,
      })),
      isActive: costCenter.isActive,
      isSeedDefault: isSeedDefaultCostCenter(costCenter.code),
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
      await prisma.costCenter.update({ where: { id: costCenterId }, data: { isActive: false } });
    } else {
      await prisma.costCenter.delete({ where: { id: costCenterId } });
    }

    try {
      await logAudit({
        userId: req.user!.userId,
        action: removal.kind === 'deactivate' ? 'DEACTIVATE_COST_CENTER' : 'DELETE_COST_CENTER',
        entityType: 'costCenter',
        entityId: costCenterId,
        oldValue: costCenter,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json({ message: removal.message, deactivated: removal.kind === 'deactivate' });
  } catch (err) {
    // Zwischen Pruefung und Loeschen ist eine Referenz entstanden: eine neue
    // Buchung oder eine frisch gesetzte Standard-Kostenstelle an einem Konto.
    // Beide Fremdschluessel stehen seit 20260904120000_cost_center_fk_restrict
    // auf RESTRICT und lassen das Loeschen scheitern, statt die Referenz still
    // zu kappen. Die Meldung nennt beide Ursachen, weil der Fehler sie nicht
    // zuverlaessig unterscheidet.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2003') {
      res.status(409).json({
        error: 'Die Kostenstelle wird inzwischen verwendet — es wurde darauf gebucht oder sie wurde einem Konto als Standard zugewiesen. Bitte laden Sie die Seite neu und versuchen Sie es erneut.',
      });
      return;
    }
    console.error('DELETE /cost-centers/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Deaktivierte Kostenstelle wieder aktivieren. Bewusst ein eigener Endpunkt
// statt isActive im PUT-Schema: so gibt es genau einen Weg, eine Kostenstelle
// stillzulegen (DELETE) und genau einen, sie zurueckzuholen. Ein isActive-Feld
// im PUT-Schema wuerde sie beim normalen Bearbeiten still reaktivieren.
costCentersRouter.post('/:id/reactivate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const costCenterId = getParam(req, 'id');
    const existing = await prisma.costCenter.findUnique({ where: { id: costCenterId } });
    if (!existing) {
      res.status(404).json({ error: 'Kostenstelle nicht gefunden' });
      return;
    }

    const costCenter = await prisma.costCenter.update({
      where: { id: costCenterId },
      data: { isActive: true },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'REACTIVATE_COST_CENTER',
        entityType: 'costCenter',
        entityId: costCenterId,
        oldValue: existing,
        newValue: costCenter,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(costCenter);
  } catch (err) {
    console.error('POST /cost-centers/:id/reactivate error:', err);
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
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      res.status(409).json({ error: DUPLICATE_CODE_MESSAGE });
      return;
    }
    console.error('PUT /cost-centers/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
