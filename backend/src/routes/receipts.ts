import { createReadStream, promises as fs } from 'fs';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp, getParam } from '../utils/request';
import {
  receiptUpload,
  detectFileType,
  storeReceipt,
  absolutePathFor,
} from '../services/uploadService';

export const receiptsRouter = Router();
receiptsRouter.use(authenticate);

// ─── Helfer: Buchung laden + Scope prüfen ───────────────────────────────────
async function loadBookingWithScope(req: Request, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      schoolId: true,
      bookingDate: true,
      isFinalized: true,
    },
  });
  if (!booking) return { booking: null, forbidden: false };
  if (req.user!.role !== 'ADMIN' && req.user!.schoolId !== booking.schoolId) {
    return { booking: null, forbidden: true };
  }
  return { booking, forbidden: false };
}

async function loadReceiptWithScope(req: Request, receiptId: string) {
  const receipt = await prisma.bookingReceipt.findUnique({
    where: { id: receiptId },
    include: {
      booking: { select: { schoolId: true, isFinalized: true } },
      belegart: { select: { id: true, code: true, label: true } },
    },
  });
  if (!receipt) return { receipt: null, forbidden: false };
  if (req.user!.role !== 'ADMIN' && req.user!.schoolId !== receipt.booking.schoolId) {
    return { receipt: null, forbidden: true };
  }
  return { receipt, forbidden: false };
}

// ─── Liste der Belege einer Buchung ─────────────────────────────────────────
receiptsRouter.get('/booking/:bookingId', async (req: Request, res: Response) => {
  try {
    const bookingId = getParam(req, 'bookingId');
    const { booking, forbidden } = await loadBookingWithScope(req, bookingId);
    if (forbidden) { res.status(403).json({ error: 'Kein Zugriff' }); return; }
    if (!booking) { res.status(404).json({ error: 'Buchung nicht gefunden' }); return; }

    const list = await prisma.bookingReceipt.findMany({
      where: { bookingId, deletedAt: null },
      include: { belegart: { select: { id: true, code: true, label: true } } },
      orderBy: { uploadedAt: 'asc' },
    });

    res.json(list.map(r => ({
      id: r.id,
      bookingId: r.bookingId,
      originalName: r.originalName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      uploadedAt: r.uploadedAt,
      belegart: r.belegart,
    })));
  } catch (err) {
    console.error('GET /receipts/booking/:bookingId error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── Anzahl Belege je Buchungs-ID (bulk, fürs Dashboard) ────────────────────
const countsSchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1).max(500),
});

receiptsRouter.post('/counts', async (req: Request, res: Response) => {
  try {
    const parsed = countsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten' });
      return;
    }

    // Multi-Tenant-Scope: nur Buchungen der eigenen Schule (USER)
    const where: { id: { in: string[] }; schoolId?: string } = {
      id: { in: parsed.data.bookingIds },
    };
    if (req.user!.role !== 'ADMIN') {
      where.schoolId = req.user!.schoolId ?? '__none__';
    }

    const bookings = await prisma.booking.findMany({
      where,
      select: { id: true },
    });
    const allowedIds = new Set(bookings.map(b => b.id));

    const grouped = await prisma.bookingReceipt.groupBy({
      by: ['bookingId'],
      where: {
        bookingId: { in: [...allowedIds] },
        deletedAt: null,
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const id of allowedIds) counts[id] = 0;
    for (const g of grouped) counts[g.bookingId] = g._count._all;
    res.json(counts);
  } catch (err) {
    console.error('POST /receipts/counts error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── Upload (multipart, 1–N Dateien) ────────────────────────────────────────
receiptsRouter.post(
  '/booking/:bookingId',
  receiptUpload.array('files'),
  async (req: Request, res: Response) => {
    try {
      const bookingId = getParam(req, 'bookingId');
      const { booking, forbidden } = await loadBookingWithScope(req, bookingId);
      if (forbidden) { res.status(403).json({ error: 'Kein Zugriff' }); return; }
      if (!booking) { res.status(404).json({ error: 'Buchung nicht gefunden' }); return; }

      if (booking.isFinalized && req.user!.role !== 'ADMIN') {
        res.status(409).json({
          error: 'Buchung ist bereits durch Tagesabschluss festgeschrieben.',
        });
        return;
      }

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Keine Datei hochgeladen' });
        return;
      }

      const belegartId = typeof req.body?.belegartId === 'string' && req.body.belegartId.length > 0
        ? req.body.belegartId
        : null;

      // Belegart, falls angegeben, muss zur gleichen Schule gehören
      if (belegartId) {
        const ba = await prisma.belegart.findUnique({ where: { id: belegartId } });
        if (!ba || ba.schoolId !== booking.schoolId) {
          res.status(400).json({ error: 'Belegart passt nicht zur Schule der Buchung.' });
          return;
        }
      }

      const created = [];
      for (const file of files) {
        const detected = detectFileType(file.buffer);
        if (!detected) {
          res.status(415).json({
            error: `Dateityp nicht erlaubt (${file.originalname}). Nur PDF, JPEG, PNG.`,
          });
          return;
        }

        const stored = await storeReceipt(
          booking.schoolId,
          booking.bookingDate,
          file.buffer,
          detected,
        );

        const record = await prisma.bookingReceipt.create({
          data: {
            bookingId: booking.id,
            belegartId,
            originalName: file.originalname,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            storagePath: stored.storagePath,
            sha256: stored.sha256,
            uploadedById: req.user!.userId,
          },
        });

        try {
          await logAudit({
            userId: req.user!.userId,
            action: 'UPLOAD_RECEIPT',
            entityType: 'booking_receipt',
            entityId: record.id,
            newValue: {
              bookingId: booking.id,
              originalName: record.originalName,
              sizeBytes: record.sizeBytes,
              sha256: record.sha256,
            },
            ipAddress: getClientIp(req),
          });
        } catch (auditErr) {
          console.error('Audit log failed:', auditErr);
        }

        created.push({
          id: record.id,
          bookingId: record.bookingId,
          originalName: record.originalName,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          sha256: record.sha256,
          uploadedAt: record.uploadedAt,
        });
      }

      res.status(201).json(created);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'Datei zu groß' });
          return;
        }
        if (code === 'LIMIT_FILE_COUNT') {
          res.status(413).json({ error: 'Zu viele Dateien auf einmal' });
          return;
        }
      }
      console.error('POST /receipts/booking/:bookingId error:', err);
      res.status(500).json({ error: 'Interner Serverfehler' });
    }
  },
);

// ─── Download (attachment) und Preview (inline) ─────────────────────────────
async function streamReceipt(req: Request, res: Response, mode: 'attachment' | 'inline') {
  try {
    const id = getParam(req, 'id');
    const { receipt, forbidden } = await loadReceiptWithScope(req, id);
    if (forbidden) { res.status(403).json({ error: 'Kein Zugriff' }); return; }
    if (!receipt || receipt.deletedAt) {
      res.status(404).json({ error: 'Beleg nicht gefunden' });
      return;
    }

    const absPath = absolutePathFor(receipt.storagePath);
    try {
      await fs.access(absPath);
    } catch {
      res.status(410).json({ error: 'Beleg-Datei auf Server nicht mehr vorhanden' });
      return;
    }

    res.setHeader('Content-Type', receipt.mimeType);
    res.setHeader('Content-Length', receipt.sizeBytes);
    const safeName = receipt.originalName.replace(/[^\w.\-]+/g, '_');
    res.setHeader(
      'Content-Disposition',
      `${mode}; filename="${safeName}"`,
    );
    createReadStream(absPath).pipe(res);
  } catch (err) {
    console.error('streamReceipt error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
}

receiptsRouter.get('/:id/download', (req, res) => streamReceipt(req, res, 'attachment'));
receiptsRouter.get('/:id/preview',  (req, res) => streamReceipt(req, res, 'inline'));

// ─── Soft-Delete ────────────────────────────────────────────────────────────
receiptsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    const { receipt, forbidden } = await loadReceiptWithScope(req, id);
    if (forbidden) { res.status(403).json({ error: 'Kein Zugriff' }); return; }
    if (!receipt || receipt.deletedAt) {
      res.status(404).json({ error: 'Beleg nicht gefunden' });
      return;
    }

    if (req.user!.role !== 'ADMIN' && receipt.booking.isFinalized) {
      res.status(409).json({
        error: 'Buchung ist durch Tagesabschluss festgeschrieben — Löschen nur durch Admin möglich.',
      });
      return;
    }

    const updated = await prisma.bookingReceipt.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'DELETE_RECEIPT',
        entityType: 'booking_receipt',
        entityId: id,
        oldValue: {
          bookingId: receipt.bookingId,
          originalName: receipt.originalName,
          sha256: receipt.sha256,
        },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(204).end();
    void updated;
  } catch (err) {
    console.error('DELETE /receipts/:id error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
