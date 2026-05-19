import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp, getParam } from '../utils/request';
import {
  BookingForMapping,
  buildPayloadLine,
  DmsBuilderError,
  invalidateMappingCache,
} from '../services/dmsMappingService';

export const dmsMappingRouter = Router();
dmsMappingRouter.use(authenticate);

// ─── Validierung ────────────────────────────────────────────────────────────
const DMS_KEY_REGEX = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const rowSchema = z.object({
  source: z.enum(['BOOKING_FIELD', 'CONSTANT']),
  bookingField: z.enum([
    'BOOKING_DATE', 'RECEIPT_NUMBER', 'AMOUNT', 'DEBIT_CREDIT',
    'ACCOUNT_NUMBER', 'ACCOUNT_NAME', 'COUNTER_ACCOUNT_NUMBER', 'COUNTER_ACCOUNT_NAME',
    'COST_CENTER_CODE', 'COST_CENTER_NAME', 'DESCRIPTION', 'TAX_KEY',
    'BELEGART_CODE', 'BELEGART_LABEL', 'SCHOOL_NAME', 'SCHOOL_CODE',
    'DMS_MANDANTEN_NR', 'DATEV_MANDANTEN_NR', 'CREATED_BY', 'FILE_INDEX',
  ]).nullable().optional(),
  constantValue: z.string().max(200).nullable().optional(),
  dmsKey: z.string().regex(DMS_KEY_REGEX, 'DMS-Schlüssel: nur Buchstaben/Ziffern/_ , max 40 Zeichen'),
  format: z.enum([
    'RAW', 'DATE_DDMMYYYY', 'DATE_ISO', 'DATE_YYYYMMDD',
    'NUMBER_DE', 'NUMBER_DE_CURRENCY', 'NUMBER_DOT', 'UPPER', 'LOWER',
  ]).nullable().optional(),
  maxLength: z.number().int().min(1).max(140).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
  includeOnSeparator: z.boolean(),
}).refine(
  (r) => (r.source === 'BOOKING_FIELD' && r.bookingField) || (r.source === 'CONSTANT' && r.constantValue !== null && r.constantValue !== undefined),
  { message: 'BOOKING_FIELD braucht bookingField, CONSTANT braucht constantValue' },
);

const bulkSchema = z.object({
  rows: z.array(rowSchema).max(40),
});

// ─── GET ────────────────────────────────────────────────────────────────────
dmsMappingRouter.get('/:schoolId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schoolId = getParam(req, 'schoolId');
    const list = await prisma.dmsFieldMapping.findMany({
      where: { schoolId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(list);
  } catch (err) {
    console.error('GET /dms-mapping/:schoolId error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── PUT (Bulk-Replace) ─────────────────────────────────────────────────────
dmsMappingRouter.put('/:schoolId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schoolId = getParam(req, 'schoolId');
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    // Eindeutigkeit der dmsKeys im Payload prüfen
    const keys = parsed.data.rows.map(r => r.dmsKey);
    const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupKeys.length > 0) {
      res.status(400).json({ error: `DMS-Schlüssel doppelt: ${[...new Set(dupKeys)].join(', ')}` });
      return;
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) {
      res.status(404).json({ error: 'Schule nicht gefunden' });
      return;
    }

    const old = await prisma.dmsFieldMapping.findMany({ where: { schoolId } });

    await prisma.$transaction([
      prisma.dmsFieldMapping.deleteMany({ where: { schoolId } }),
      prisma.dmsFieldMapping.createMany({
        data: parsed.data.rows.map(r => ({
          schoolId,
          source: r.source,
          bookingField: r.source === 'BOOKING_FIELD' ? r.bookingField! : null,
          constantValue: r.source === 'CONSTANT' ? (r.constantValue ?? '') : null,
          dmsKey: r.dmsKey,
          format: r.format ?? null,
          maxLength: r.maxLength ?? null,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          includeOnSeparator: r.includeOnSeparator,
        })),
      }),
    ]);

    invalidateMappingCache(schoolId);

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_DMS_MAPPING',
        entityType: 'dms_field_mapping',
        entityId: schoolId,
        oldValue: old,
        newValue: parsed.data.rows,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    const fresh = await prisma.dmsFieldMapping.findMany({
      where: { schoolId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(fresh);
  } catch (err) {
    console.error('PUT /dms-mapping/:schoolId error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── POST /preview ──────────────────────────────────────────────────────────
// Live-Vorschau der erzeugten Unstructured-Data-Zeile.
// Optional kann der Body bereits ein neues Mapping enthalten (für Editor "Live-Vorschau"),
// sonst wird das aktuell gespeicherte Mapping verwendet.
const previewSchema = z.object({
  rows: z.array(rowSchema).optional(),
}).optional();

dmsMappingRouter.post('/:schoolId/preview', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schoolId = getParam(req, 'schoolId');
    const parsed = previewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten' });
      return;
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, code: true, dmsMandantenNummer: true },
    });
    if (!school) {
      res.status(404).json({ error: 'Schule nicht gefunden' });
      return;
    }

    // Neueste Buchung der Schule (für realistische Werte). Sonst Dummy.
    const realBooking = await prisma.booking.findFirst({
      where: { schoolId },
      orderBy: { bookingDate: 'desc' },
      include: {
        account: { select: { accountNumber: true, name: true } },
        counterAccount: { select: { accountNumber: true, name: true } },
        costCenter: { select: { code: true, name: true } },
        createdBy: { select: { displayName: true } },
      },
    });

    const booking: BookingForMapping = realBooking
      ? {
          id: realBooking.id,
          schoolId: realBooking.schoolId,
          receiptNumber: realBooking.receiptNumber,
          bookingDate: realBooking.bookingDate,
          amount: realBooking.amount,
          debitCredit: realBooking.debitCredit,
          description: realBooking.description,
          taxKey: realBooking.taxKey,
          account: realBooking.account,
          counterAccount: realBooking.counterAccount,
          costCenter: realBooking.costCenter,
          school: { name: school.name, code: school.code, dmsMandantenNummer: school.dmsMandantenNummer },
          createdBy: realBooking.createdBy,
          belegartCode: 'QUITTUNG',
          belegartLabel: 'Quittung',
        }
      : {
          id: 'preview-dummy',
          schoolId,
          receiptNumber: 1,
          bookingDate: new Date(),
          amount: new Prisma.Decimal('42.80'),
          debitCredit: 'H',
          description: 'Beispielbuchung',
          taxKey: null,
          account: { accountNumber: '1200', name: 'Kasse' },
          counterAccount: { accountNumber: '4930', name: 'Bürobedarf' },
          costCenter: { code: '10', name: 'Verwaltung' },
          school: { name: school.name, code: school.code, dmsMandantenNummer: school.dmsMandantenNummer ?? '0' },
          createdBy: { displayName: 'Beispiel-User' },
          belegartCode: 'QUITTUNG',
          belegartLabel: 'Quittung',
        };

    const datev = await prisma.datevExportConfig.findFirst({ select: { mandantenNummer: true } });

    // Mapping aus Body oder aus DB
    let mapping;
    if (parsed.data?.rows) {
      mapping = parsed.data.rows.map((r, i) => ({
        id: `tmp-${i}`,
        schoolId,
        source: r.source,
        bookingField: r.source === 'BOOKING_FIELD' ? r.bookingField! : null,
        constantValue: r.source === 'CONSTANT' ? (r.constantValue ?? '') : null,
        dmsKey: r.dmsKey,
        format: r.format ?? null,
        maxLength: r.maxLength ?? null,
        sortOrder: r.sortOrder,
        isActive: r.isActive,
        includeOnSeparator: r.includeOnSeparator,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    } else {
      mapping = await prisma.dmsFieldMapping.findMany({
        where: { schoolId },
        orderBy: { sortOrder: 'asc' },
      });
    }

    try {
      const built = buildPayloadLine(booking, mapping, 1, 1, datev?.mandantenNummer ?? null);
      const length = Array.from(built.unstructured).length;
      res.json({
        unstructured: built.unstructured,
        length,
        maxLength: 140,
        warningAt: 120,
        fields: built.fields,
      });
    } catch (e) {
      if (e instanceof DmsBuilderError) {
        res.status(400).json({
          error: e.message,
          length: e.currentLength,
          maxLength: 140,
          warningAt: 120,
        });
        return;
      }
      throw e;
    }
  } catch (err) {
    console.error('POST /dms-mapping/:schoolId/preview error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
