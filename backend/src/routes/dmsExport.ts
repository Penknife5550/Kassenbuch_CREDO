import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp } from '../utils/request';
import {
  buildDmsExportPdf,
  estimatePreview,
  ExportBooking,
  ExportFilter,
} from '../services/dmsExportService';
import { DmsBuilderError } from '../services/dmsMappingService';

export const dmsExportRouter = Router();
dmsExportRouter.use(authenticate, requireAdmin);

// ─── Query-Schema (gleich für Export + Preview) ────────────────────────────
const querySchema = z.object({
  schoolId: z.union([z.string(), z.array(z.string())]).optional(),
  belegartId: z.union([z.string(), z.array(z.string())]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom muss YYYY-MM-DD sein'),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo muss YYYY-MM-DD sein'),
  includeWithoutReceipts: z.union([z.literal('true'), z.literal('false')]).optional(),
});

interface ParsedQuery {
  schoolIds: string[];
  belegartIds: string[];
  dateFrom: Date;
  dateTo: Date;
  includeWithoutReceipts: boolean;
}

function parseQuery(req: Request): { ok: true; query: ParsedQuery } | { ok: false; status: number; error: string } {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'Ungültige Export-Parameter: ' + parsed.error.message };
  }
  const toArr = (v?: string | string[]): string[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const schoolIds = toArr(parsed.data.schoolId);
  const belegartIds = toArr(parsed.data.belegartId);
  // ISO-Date wird als UTC-Midnight geparst — konsistent zu
  // datevExport.ts und bookings.ts. bookingDate ist @db.Date (UTC).
  const dateFrom = new Date(parsed.data.dateFrom);
  const dateTo = new Date(parsed.data.dateTo);
  if (dateFrom > dateTo) {
    return { ok: false, status: 400, error: 'dateFrom liegt nach dateTo.' };
  }
  return {
    ok: true,
    query: {
      schoolIds,
      belegartIds,
      dateFrom,
      dateTo,
      includeWithoutReceipts: parsed.data.includeWithoutReceipts === 'true',
    },
  };
}

// ─── Preview-Endpoint ──────────────────────────────────────────────────────
dmsExportRouter.get('/preview', async (req: Request, res: Response) => {
  try {
    const p = parseQuery(req);
    if (!p.ok) { res.status(p.status).json({ error: p.error }); return; }
    const { query } = p;

    const bookingWhere: Prisma.BookingWhereInput = {
      bookingDate: { gte: query.dateFrom, lte: query.dateTo },
    };
    if (query.schoolIds.length > 0) bookingWhere.schoolId = { in: query.schoolIds };

    const bookings = await prisma.booking.findMany({
      where: bookingWhere,
      select: {
        id: true,
        receipts: {
          where: {
            deletedAt: null,
            ...(query.belegartIds.length > 0 ? { belegartId: { in: query.belegartIds } } : {}),
          },
          select: { sizeBytes: true, pageCount: true, mimeType: true },
        },
      },
    });

    const preview = estimatePreview({
      bookings: bookings.map(b => ({
        receiptsCount: b.receipts.length,
        receiptsSizeBytes: b.receipts.reduce((s, r) => s + r.sizeBytes, 0),
        receiptsPdfPages: b.receipts.reduce(
          (s, r) => s + (r.mimeType === 'application/pdf' ? (r.pageCount ?? 1) : 1),
          0,
        ),
      })),
      includeWithoutReceipts: query.includeWithoutReceipts,
    });

    res.json(preview);
  } catch (err) {
    console.error('GET /dms-export/preview error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── Export-Endpoint (PDF) ─────────────────────────────────────────────────
dmsExportRouter.get('/', async (req: Request, res: Response) => {
  try {
    const p = parseQuery(req);
    if (!p.ok) { res.status(p.status).json({ error: p.error }); return; }
    const { query } = p;

    // Buchungen + Belege laden (Sortierung: schoolId, bookingDate, receiptNumber)
    const bookingWhere: Prisma.BookingWhereInput = {
      bookingDate: { gte: query.dateFrom, lte: query.dateTo },
    };
    if (query.schoolIds.length > 0) bookingWhere.schoolId = { in: query.schoolIds };

    const rawBookings = await prisma.booking.findMany({
      where: bookingWhere,
      orderBy: [
        { schoolId: 'asc' },
        { bookingDate: 'asc' },
        { receiptNumber: 'asc' },
      ],
      include: {
        account: { select: { accountNumber: true, name: true } },
        counterAccount: { select: { accountNumber: true, name: true } },
        costCenter: { select: { code: true, name: true } },
        school: { select: { id: true, name: true, code: true, dmsMandantenNummer: true } },
        createdBy: { select: { displayName: true } },
        receipts: {
          where: {
            deletedAt: null,
            ...(query.belegartIds.length > 0 ? { belegartId: { in: query.belegartIds } } : {}),
          },
          include: {
            belegart: { select: { code: true, label: true } },
            uploadedBy: { select: { displayName: true } },
          },
          orderBy: { uploadedAt: 'asc' },
        },
      },
    });

    if (rawBookings.length === 0) {
      res.status(404).json({ error: 'Keine Buchungen im gewählten Zeitraum.' });
      return;
    }

    // Map nach ExportBooking-Shape; belegartCode wird pro Beleg gesetzt
    const bookings: ExportBooking[] = rawBookings.map(b => ({
      id: b.id,
      schoolId: b.schoolId,
      receiptNumber: b.receiptNumber,
      bookingDate: b.bookingDate,
      amount: b.amount,
      debitCredit: b.debitCredit as 'S' | 'H',
      description: b.description,
      taxKey: b.taxKey,
      account: b.account,
      counterAccount: b.counterAccount,
      costCenter: b.costCenter,
      school: b.school,
      createdBy: b.createdBy,
      // pro Buchung kann es mehrere Belege mit unterschiedlichen Belegarten geben
      // → wir setzen den Code on-the-fly im Service-Loop. Für Buchungen ohne
      //   Beleg bleibt es null.
      belegartCode: b.receipts[0]?.belegart?.code ?? null,
      belegartLabel: b.receipts[0]?.belegart?.label ?? null,
      receipts: b.receipts.map(r => ({
        id: r.id,
        originalName: r.originalName,
        mimeType: r.mimeType,
        storagePath: r.storagePath,
        sha256: r.sha256,
        uploadedAt: r.uploadedAt,
        uploadedByName: r.uploadedBy.displayName,
        belegart: r.belegart ? { code: r.belegart.code, label: r.belegart.label } : null,
      })),
    }));

    // schoolsById für Cover-Anzeige
    const schoolsById: Record<string, { name: string; code: string }> = {};
    for (const b of rawBookings) {
      schoolsById[b.schoolId] = { name: b.school.name, code: b.school.code };
    }

    // DATEV-Mandantennummer (falls Mapping einer DATEV-Konfig nutzt)
    const datevCfg = await prisma.datevExportConfig.findFirst();

    const filter: ExportFilter = {
      schoolIds: query.schoolIds,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      belegartIds: query.belegartIds,
      includeWithoutReceipts: query.includeWithoutReceipts,
    };

    // Echten DisplayName aus der DB laden — JWT enthält nur username
    const userRow = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { displayName: true, username: true },
    });
    const generatedByName = userRow?.displayName ?? userRow?.username ?? 'Admin';

    const generatedAt = new Date();
    const result = await buildDmsExportPdf({
      bookings,
      filter,
      schoolsById,
      generatedAt,
      generatedByName,
      datevMandantenNr: datevCfg?.mandantenNummer ?? null,
    });

    // Audit-Log MUSS vor Response gelingen — GoBD: kein Export ohne
    // Audit-Trail. Bei DB-Ausfall lieber 503 als undokumentierter Export.
    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'DMS_EXPORT',
        entityType: 'dmsExport',
        newValue: {
          filter: {
            ...filter,
            dateFrom: filter.dateFrom.toISOString().slice(0, 10),
            dateTo: filter.dateTo.toISOString().slice(0, 10),
          },
          bookingsCount: result.stats.bookingsCount,
          receiptsCount: result.stats.receiptsCount,
          pages: result.stats.pages,
          pdfSha256: result.pdfSha256,
          bundleSha256: result.bundleSha256,
        },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('[dmsExport] Audit-Log fehlgeschlagen, Export wird abgebrochen:', auditErr);
      res.status(503).json({
        error: 'Audit-Trail aktuell nicht verfügbar. Export aus GoBD-Gründen abgebrochen. Bitte später erneut versuchen.',
      });
      return;
    }

    // Filename: dms-export_YYYY-MM-DD_YYYY-MM-DD.pdf
    const fnFrom = filter.dateFrom.toISOString().slice(0, 10);
    const fnTo = filter.dateTo.toISOString().slice(0, 10);
    const filename = `dms-export_${fnFrom}_${fnTo}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-DMS-Bundle-Sha256', result.bundleSha256);
    res.setHeader('X-DMS-Pdf-Sha256', result.pdfSha256);
    res.setHeader('Content-Length', result.buffer.length.toString());
    res.end(result.buffer);
  } catch (err) {
    if (err instanceof DmsBuilderError) {
      res.status(422).json({
        error: err.message,
        bookingId: err.bookingId,
        currentLength: err.currentLength,
      });
      return;
    }
    console.error('GET /dms-export error:', err);
    res.status(500).json({ error: 'Interner Serverfehler beim Erzeugen des DMS-Exports.' });
  }
});
