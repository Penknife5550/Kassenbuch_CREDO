import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { authenticate, getSchoolScope } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import {
  TxClient, isDayFinalized, resolveBookingDate, createBookingInTx, retryOnWriteConflict,
  bookingErrorToResponse, ACCOUNT_GONE, COST_CENTER_GONE,
} from '../services/bookingService';
import { checkCostCentersUsable } from '../services/costCenterService';
import { EIGENBELEG_BELEGART } from '../services/belegartService';
import {
  EIGENBELEG_LIMITS, EigenbelegPosition, buildPositions, centsToDecimal,
} from '../services/eigenbelegService';
import { renderEigenbelegPdf } from '../services/eigenbelegPdf';
import { RECEIPT_ISSUER_MISSING, getReceiptIssuer } from '../services/receiptIssuerService';
import { storeReceipt, deleteReceiptFile } from '../services/uploadService';
import { getClientIp } from '../utils/request';

export const eigenbelegeRouter = Router();
eigenbelegeRouter.use(authenticate);

const positionSchema = z.object({
  label: z.string().trim().min(1).max(EIGENBELEG_LIMITS.maxLabelLength),
  unitPrice: z.number().positive().max(EIGENBELEG_LIMITS.maxUnitPrice),
  quantity: z.number().int().min(1).max(EIGENBELEG_LIMITS.maxQuantity),
});

const eigenbelegSchema = z.object({
  debitCredit: z.enum(['S', 'H']),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().uuid(),
  counterAccountId: z.string().uuid(),
  costCenterId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  counterparty: z.string().trim().min(1).max(EIGENBELEG_LIMITS.maxCounterpartyLength),
  reason: z.string().trim().min(3).max(EIGENBELEG_LIMITS.maxReasonLength),
  payeeSigns: z.boolean().default(false),
  positions: z.array(positionSchema).min(1).max(EIGENBELEG_LIMITS.maxPositions),
});

const PDF_FILE = { mime: 'application/pdf', ext: 'pdf' };

interface Prepared {
  schoolId: string;
  input: z.infer<typeof eigenbelegSchema>;
  bookingDate: Date;
  positions: EigenbelegPosition[];
  totalCents: number;
  /** Nur bei Ausgaben gibt es einen Empfaenger, der den Erhalt quittieren kann. */
  payeeSigns: boolean;
  school: { name: string; code: string };
  issuer: { name: string; address: string };
}

/**
 * Prueft die Anfrage und laedt, was Entwurf und Buchung gleichermassen brauchen.
 * Antwortet im Fehlerfall selbst und liefert dann null.
 */
async function prepare(req: Request, res: Response): Promise<Prepared | null> {
  const schoolId = getSchoolScope(req);
  if (!schoolId) {
    res.status(400).json({ error: 'Schule muss angegeben werden' });
    return null;
  }

  const parsed = eigenbelegSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ungültige Angaben zum Eigenbeleg', details: parsed.error.flatten() });
    return null;
  }

  const built = buildPositions(parsed.data.positions);
  if (!built.ok) {
    res.status(400).json({ error: built.error });
    return null;
  }

  const resolvedDate = resolveBookingDate(parsed.data.bookingDate);
  if (!resolvedDate.ok) {
    res.status(400).json({ error: resolvedDate.error });
    return null;
  }

  const [school, issuer] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, code: true } }),
    getReceiptIssuer(prisma),
  ]);
  if (!school) {
    res.status(404).json({ error: 'Schule nicht gefunden' });
    return null;
  }
  if (!issuer) {
    res.status(409).json({ error: RECEIPT_ISSUER_MISSING });
    return null;
  }

  return {
    schoolId,
    input: parsed.data,
    bookingDate: resolvedDate.date,
    positions: built.positions,
    totalCents: built.totalCents,
    payeeSigns: parsed.data.debitCredit === 'H' && parsed.data.payeeSigns,
    school,
    issuer,
  };
}

/** Angaben auf dem Beleg, die schon vor dem Buchen feststehen — im Entwurf und im Beleg dieselben. */
function pdfBase(p: Prepared) {
  return {
    issuer: p.issuer,
    schoolName: p.school.name,
    schoolCode: p.school.code,
    bookingDate: p.bookingDate,
    debitCredit: p.input.debitCredit,
    counterparty: p.input.counterparty,
    positions: p.positions,
    totalCents: p.totalCents,
    reason: p.input.reason,
    description: p.input.description,
    payeeSigns: p.payeeSigns,
  };
}

/**
 * Buchung, PDF und Verknuepfung in EINER Transaktion: scheitert ein Schritt,
 * entsteht nichts — weder eine Buchung ohne Beleg noch ein Beleg ohne Buchung.
 *
 * Das PDF wird erst gerendert, wenn die Belegnummer feststeht. Die Datei liegt
 * ausserhalb der Datenbank; ihr Pfad wandert deshalb sofort in `storedPaths`,
 * damit der Aufrufer sie nach einem Rollback wieder entfernen kann.
 */
async function createEigenbelegInTx(tx: TxClient, p: Prepared, userId: string, storedPaths: string[]) {
  const booking = await createBookingInTx(tx, {
    schoolId: p.schoolId,
    bookingDate: p.bookingDate,
    amount: centsToDecimal(p.totalCents),
    debitCredit: p.input.debitCredit,
    accountId: p.input.accountId,
    counterAccountId: p.input.counterAccountId,
    costCenterId: p.input.costCenterId,
    description: p.input.description,
    createdById: userId,
  });

  // Die Belegart kann beim Mandanten geloescht oder deaktiviert sein. Der Beleg
  // braucht sie trotzdem, sonst ginge er mit leerer Dokumentart in den DMS-Export.
  const belegart = await tx.belegart.upsert({
    where: { schoolId_code: { schoolId: p.schoolId, code: EIGENBELEG_BELEGART.code } },
    update: {},
    create: { schoolId: p.schoolId, ...EIGENBELEG_BELEGART },
  });

  const pdf = await renderEigenbelegPdf({
    ...pdfBase(p),
    receiptNumber: booking.receiptNumber,
    account: booking.account,
    counterAccount: booking.counterAccount,
    costCenter: booking.costCenter,
    createdByName: booking.createdBy.displayName,
    createdAt: booking.createdAt,
  });

  const stored = await storeReceipt(p.schoolId, p.bookingDate, pdf.buffer, PDF_FILE);
  storedPaths.push(stored.storagePath);

  const receipt = await tx.bookingReceipt.create({
    data: {
      bookingId: booking.id,
      belegartId: belegart.id,
      originalName: `Eigenbeleg_${p.school.code}_${booking.receiptNumber}.pdf`,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      storagePath: stored.storagePath,
      sha256: stored.sha256,
      pageCount: pdf.pageCount,
      uploadedById: userId,
    },
  });

  await tx.eigenbeleg.create({
    data: {
      bookingId: booking.id,
      receiptId: receipt.id,
      counterparty: p.input.counterparty,
      reason: p.input.reason,
      positions: p.positions,
      payeeSigns: p.payeeSigns,
    },
  });

  return { booking, receipt };
}

/**
 * Entfernt Dateien, zu denen es nach einem Rollback keinen Beleg gibt. Liefert
 * true, wenn eine Datei doch zu einem gespeicherten Beleg gehoert: reisst die
 * Verbindung genau beim Commit ab, meldet Prisma einen Fehler, obwohl gebucht
 * ist. Diese Datei darf dann nicht verschwinden — deshalb erst nachsehen.
 */
async function removeOrphanFiles(storedPaths: string[]): Promise<boolean> {
  let committed = false;
  for (const storagePath of storedPaths.splice(0)) {
    if (await prisma.bookingReceipt.count({ where: { storagePath } }) > 0) committed = true;
    else await deleteReceiptFile(storagePath);
  }
  return committed;
}

// ─── Eigenbeleg buchen ──────────────────────────────────────────────────────
eigenbelegeRouter.post('/', async (req: Request, res: Response) => {
  const storedPaths: string[] = [];
  try {
    const p = await prepare(req, res);
    if (!p) return;

    const costCenterCheck = await checkCostCentersUsable(prisma, [p.input.costCenterId]);
    if (!costCenterCheck.ok) {
      res.status(400).json({ error: COST_CENTER_GONE });
      return;
    }

    const finalized = await isDayFinalized(p.schoolId, p.bookingDate);
    if (finalized) {
      res.status(409).json({ error: 'Tagesabschluss für dieses Datum bereits durchgeführt. Keine Buchungen möglich.' });
      return;
    }

    const userId = req.user!.userId;
    // Jeder abgebrochene Versuch hat schon eine Datei geschrieben — sie muss
    // weg, bevor der naechste Versuch seine eigene anlegt.
    const result = await retryOnWriteConflict(
      () => prisma.$transaction(
        (tx) => createEigenbelegInTx(tx, p, userId, storedPaths),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
      () => removeOrphanFiles(storedPaths),
    );
    // Ab hier gehoert die Datei zu einem gespeicherten Beleg und darf nicht
    // mehr als verwaist entfernt werden.
    storedPaths.length = 0;

    try {
      await logAudit({
        userId,
        action: 'CREATE_EIGENBELEG',
        entityType: 'booking',
        entityId: result.booking.id,
        newValue: {
          receiptNumber: result.booking.receiptNumber,
          amount: result.booking.amount.toString(),
          debitCredit: p.input.debitCredit,
          description: p.input.description,
          receiptId: result.receipt.id,
          sha256: result.receipt.sha256,
        },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json({
      booking: result.booking,
      receipt: {
        id: result.receipt.id,
        belegartId: result.receipt.belegartId,
        originalName: result.receipt.originalName,
        mimeType: result.receipt.mimeType,
        sizeBytes: result.receipt.sizeBytes,
        sha256: result.receipt.sha256,
        uploadedAt: result.receipt.uploadedAt,
      },
      payeeSigns: p.payeeSigns,
    });
  } catch (err) {
    // Sicher nichts gebucht ist nur, wenn keine Datei mehr zu einem Beleg
    // gehoert. Laesst sich das nicht pruefen, bleibt der Stand offen.
    const nothingBooked = await removeOrphanFiles(storedPaths)
      .then((committed) => !committed)
      .catch((cleanupErr) => {
        console.error('POST /eigenbelege: Aufräumen verwaister Dateien fehlgeschlagen:', cleanupErr);
        return false;
      });

    const known = bookingErrorToResponse(err);
    if (known) {
      res.status(known.status).json({ error: known.error });
      return;
    }
    console.error('POST /eigenbelege error:', err);
    res.status(500).json({
      error: nothingBooked
        ? 'Der Eigenbeleg konnte nicht erzeugt werden. Es wurde nichts gebucht.'
        : 'Der Eigenbeleg konnte nicht bestätigt werden. Bitte die Seite neu laden und im Kassenbuch nachsehen, bevor Sie noch einmal buchen.',
    });
  }
});

// ─── Entwurf ansehen (nichts wird gespeichert) ──────────────────────────────
eigenbelegeRouter.post('/preview', async (req: Request, res: Response) => {
  try {
    const p = await prepare(req, res);
    if (!p) return;

    const accountSelect = { accountNumber: true, name: true };
    const [account, counterAccount, costCenter, user] = await Promise.all([
      prisma.account.findUnique({ where: { id: p.input.accountId }, select: accountSelect }),
      prisma.account.findUnique({ where: { id: p.input.counterAccountId }, select: accountSelect }),
      p.input.costCenterId
        ? prisma.costCenter.findUnique({ where: { id: p.input.costCenterId }, select: { code: true, name: true } })
        : null,
      prisma.user.findUnique({ where: { id: req.user!.userId }, select: { displayName: true } }),
    ]);
    if (!account || !counterAccount) {
      res.status(400).json({ error: ACCOUNT_GONE });
      return;
    }

    const pdf = await renderEigenbelegPdf({
      ...pdfBase(p),
      receiptNumber: null,
      account,
      counterAccount,
      costCenter,
      createdByName: user?.displayName ?? req.user!.username,
      createdAt: new Date(),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.buffer.length);
    res.setHeader('Content-Disposition', 'inline; filename="Eigenbeleg_Entwurf.pdf"');
    res.send(pdf.buffer);
  } catch (err) {
    console.error('POST /eigenbelege/preview error:', err);
    res.status(500).json({ error: 'Die Vorschau konnte nicht erzeugt werden.' });
  }
});
