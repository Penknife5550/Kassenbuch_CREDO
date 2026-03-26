import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as iconv from 'iconv-lite';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { generateDatevExport } from '../services/datevExportService';
import { getClientIp } from '../utils/request';

export const datevExportRouter = Router();
datevExportRouter.use(authenticate, requireAdmin);

datevExportRouter.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await prisma.datevExportConfig.findFirst();
    res.json(config);
  } catch (err) {
    console.error('GET /datev-export/config error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const configSchema = z.object({
  beraterNummer: z.string().min(1).max(10),
  mandantenNummer: z.string().min(1).max(10),
  wirtschaftsjahrBeginn: z.string().regex(/^\d{8}$/, 'Format: YYYYMMDD'),
  sachkontenLaenge: z.number().int().min(4).max(8),
});

datevExportRouter.post('/config', async (req: Request, res: Response) => {
  try {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Konfiguration', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.datevExportConfig.findFirst();
    let config;
    if (existing) {
      config = await prisma.datevExportConfig.update({
        where: { id: existing.id },
        data: parsed.data,
      });
    } else {
      config = await prisma.datevExportConfig.create({ data: parsed.data });
    }

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_DATEV_CONFIG',
        entityType: 'datevConfig',
        entityId: config.id,
        newValue: parsed.data,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(config);
  } catch (err) {
    console.error('POST /datev-export/config error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const exportSchema = z.object({
  schoolId: z.string().uuid(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

datevExportRouter.post('/generate', async (req: Request, res: Response) => {
  try {
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Export-Parameter', details: parsed.error.flatten() });
      return;
    }

    const config = await prisma.datevExportConfig.findFirst();
    if (!config) {
      res.status(400).json({ error: 'DATEV-Konfiguration fehlt. Bitte zuerst Berater- und Mandantennummer hinterlegen.' });
      return;
    }

    const dateFrom = new Date(parsed.data.dateFrom);
    const dateTo = new Date(parsed.data.dateTo);

    const csv = await generateDatevExport(parsed.data.schoolId, dateFrom, dateTo, {
      beraterNummer: config.beraterNummer,
      mandantenNummer: config.mandantenNummer,
      wirtschaftsjahrBeginn: config.wirtschaftsjahrBeginn,
      sachkontenLaenge: config.sachkontenLaenge,
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'DATEV_EXPORT',
        entityType: 'datevExport',
        newValue: { schoolId: parsed.data.schoolId, dateFrom: parsed.data.dateFrom, dateTo: parsed.data.dateTo },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    // DATEV erwartet Windows-1252 (ANSI) Encoding für korrekte Umlaute
    const csvBuffer = iconv.encode(csv, 'win1252');
    res.setHeader('Content-Type', 'text/csv; charset=Windows-1252');
    res.setHeader('Content-Disposition', `attachment; filename="EXTF_Buchungsstapel_${parsed.data.dateFrom}_${parsed.data.dateTo}.csv"`);
    res.send(csvBuffer);
  } catch (err) {
    console.error('POST /datev-export/generate error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
