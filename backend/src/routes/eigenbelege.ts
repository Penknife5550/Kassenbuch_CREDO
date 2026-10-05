import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { authenticate, getSchoolScope } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import {
  TxClient, resolveBookingDate, createBookingInTx, retryOnWriteConflict,
  bookingErrorToResponse, ACCOUNT_GONE,
} from '../services/bookingService';
import { EIGENBELEG_BELEGART } from '../services/belegartService';
import {
  EIGENBELEG_LIMITS, EigenbelegPosition, buildPositions, centsToDecimal,
} from '../services/eigenbelegService';
import { renderEigenbelegPdf } from '../services/eigenbelegPdf';
import { hasPrintableText } from '../services/pdfText';
import { RECEIPT_ISSUER_MISSING, getReceiptIssuer } from '../services/receiptIssuerService';
import { storeReceipt, deleteReceiptFile } from '../services/uploadService';
import { getClientIp } from '../utils/request';

export const eigenbelegeRouter = Router();
eigenbelegeRouter.use(authenticate);

// Was nach dem Aufbereiten fuer das PDF leer waere (nur unsichtbare Zeichen),
// gilt nicht als ausgefuellt — sonst stuende eine leere Zeile im Beleg.
const printable = (min = 1) => (text: string) => hasPrintableText(text, min);
const NOT_PRINTABLE = 'Bitte einen lesbaren Text eintragen.';

/**
 * Meldung fuer ein Feld, das nur unsichtbare Zeichen enthaelt — mit dem
 * Feldnamen aus der Maske. Die Maske selbst erkennt solche Eingaben nicht;
 * ohne Feldnamen wuesste niemand, wo der Fehler steckt.
 */
function unreadableMessage(path: (string | number)[], debitCredit: unknown): string {
  const [field, index] = path;
  if (field === 'positions' && typeof index === 'number') {
    return `Position ${index + 1}: Bitte eine lesbare Bezeichnung eintragen.`;
  }
  const name = field === 'counterparty' ? (debitCredit === 'H' ? 'Ausgezahlt an' : 'Eingenommen von')
    : field === 'reason' ? 'Erläuterung' : 'Buchungstext';
  return `Bitte bei „${name}“ einen lesbaren Text eintragen.`;
}

const positionSchema = z.object({
  label: z.string().trim().min(1).max(EIGENBELEG_LIMITS.maxLabelLength).refine(printable(), NOT_PRINTABLE),
  unitPrice: z.number().positive().max(EIGENBELEG_LIMITS.maxUnitPrice),
  quantity: z.number().int().min(1).max(EIGENBELEG_LIMITS.maxQuantity),
});

const eigenbelegSchema = z.object({
  debitCredit: z.enum(['S', 'H']),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().uuid(),
  counterAccountId: z.string().uuid(),
  costCenterId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500).refine(printable(), NOT_PRINTABLE),
  counterparty: z.string().trim().min(1).max(EIGENBELEG_LIMITS.maxCounterpartyLength).refine(printable(), NOT_PRINTABLE),
  reason: z.string().trim().min(3).max(EIGENBELEG_LIMITS.maxReasonLength).refine(printable(3), NOT_PRINTABLE),
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
    const unreadable = parsed.error.issues.find((issue) => issue.message === NOT_PRINTABLE);
    res.status(400).json({
      error: unreadable ? unreadableMessage(unreadable.path, req.body?.debitCredit) : 'Ungültige Angaben zum Eigenbeleg',
      details: parsed.error.flatten(),
    });
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
 * Die Belegdatei des laufenden Versuchs. Sie liegt ausserhalb der Datenbank
 * und muss nach einem Rollback wieder weg; je Versuch gibt es hoechstens eine.
 */
interface StoredFile {
  path: string | null;
}

/**
 * Buchung, PDF und Verknuepfung in EINER Transaktion: scheitert ein Schritt,
 * entsteht nichts — weder eine Buchung ohne Beleg noch ein Beleg ohne Buchung.
 *
 * Das PDF wird erst gerendert, wenn die Belegnummer feststeht. Der Pfad der
 * Datei wandert sofort in `stored`, damit der Aufrufer sie nach einem Rollback
 * wieder entfernen kann.
 */
async function createEigenbelegInTx(tx: TxClient, p: Prepared, userId: string, stored: StoredFile) {
  // Die Belegart kann beim Mandanten geloescht oder deaktiviert sein. Der Beleg
  // braucht sie trotzdem, sonst ginge er mit leerer Dokumentart in den DMS-Export.
  // Sie steht vor der Buchung: createBookingInTx sperrt den Belegnummern-Zaehler
  // des Mandanten, und der soll so kurz wie moeglich gesperrt bleiben.
  const belegart = await tx.belegart.upsert({
    where: { schoolId_code: { schoolId: p.schoolId, code: EIGENBELEG_BELEGART.code } },
    update: {},
    create: { schoolId: p.schoolId, ...EIGENBELEG_BELEGART },
  });

  // Prueft auch Kostenstelle und Tagesabschluss — bei jedem Versuch aufs Neue.
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

  const pdf = await renderEigenbelegPdf({
    ...pdfBase(p),
    receiptNumber: booking.receiptNumber,
    account: booking.account,
    counterAccount: booking.counterAccount,
    costCenter: booking.costCenter,
    createdByName: booking.createdBy.displayName,
    createdAt: booking.createdAt,
  });

  const file = await storeReceipt(p.schoolId, p.bookingDate, pdf.buffer, PDF_FILE);
  stored.path = file.storagePath;

  const receipt = await tx.bookingReceipt.create({
    data: {
      bookingId: booking.id,
      belegartId: belegart.id,
      originalName: `Eigenbeleg_${p.school.code}_${booking.receiptNumber}.pdf`,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      storagePath: file.storagePath,
      sha256: file.sha256,
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

/** Loescht die Datei eines Versuchs, dessen Transaktion sicher zurueckgerollt ist. */
async function dropStoredFile(stored: StoredFile): Promise<void> {
  if (!stored.path) return;
  await deleteReceiptFile(stored.path);
  stored.path = null;
}

/**
 * Raeumt nach einem Fehler mit offenem Ausgang auf und liefert true, wenn
 * sicher nichts gebucht ist. Reisst die Verbindung genau beim Commit ab, meldet
 * Prisma einen Fehler, obwohl gebucht ist — die Datei verschwindet deshalb
 * nur, wenn kein Beleg auf sie verweist.
 */
async function nothingWasBooked(stored: StoredFile): Promise<boolean> {
  if (!stored.path) return true;
  const receipts = await prisma.bookingReceipt.count({ where: { storagePath: stored.path } });
  if (receipts > 0) return false;
  await dropStoredFile(stored);
  return true;
}

// ─── Eigenbeleg buchen ──────────────────────────────────────────────────────
eigenbelegeRouter.post('/', async (req: Request, res: Response) => {
  const stored: StoredFile = { path: null };
  let booked = false;
  try {
    const p = await prepare(req, res);
    if (!p) return;

    const userId = req.user!.userId;
    // Ein Schreibkonflikt heisst: sicher zurueckgerollt. Die Datei des
    // abgebrochenen Versuchs kann ohne Nachsehen weg, bevor der naechste
    // Versuch seine eigene anlegt.
    const result = await retryOnWriteConflict(
      () => prisma.$transaction(
        (tx) => createEigenbelegInTx(tx, p, userId, stored),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
      () => dropStoredFile(stored),
    );
    // Ab hier gehoert die Datei zu einem gespeicherten Beleg.
    booked = true;
    stored.path = null;

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
    // Fachliche Absage oder Schreibkonflikt: die Transaktion ist sicher zurueckgerollt.
    const known = booked ? null : bookingErrorToResponse(err);
    if (known) {
      await dropStoredFile(stored);
      res.status(known.status).json({ error: known.error });
      return;
    }

    console.error('POST /eigenbelege error:', err);
    // Bei jedem anderen Fehler steht nicht fest, ob der Commit durchging.
    // Laesst sich das nicht nachsehen, bleibt der Stand offen.
    const nothingBooked = !booked && await nothingWasBooked(stored).catch((cleanupErr) => {
      console.error('POST /eigenbelege: Aufräumen der Belegdatei fehlgeschlagen:', cleanupErr);
      return false;
    });
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

    const accountSelect = { accountNumber: true, name: true, isActive: true };
    const [account, counterAccount, costCenter, user] = await Promise.all([
      prisma.account.findUnique({ where: { id: p.input.accountId }, select: accountSelect }),
      prisma.account.findUnique({ where: { id: p.input.counterAccountId }, select: accountSelect }),
      p.input.costCenterId
        ? prisma.costCenter.findUnique({ where: { id: p.input.costCenterId }, select: { code: true, name: true } })
        : null,
      prisma.user.findUnique({ where: { id: req.user!.userId }, select: { displayName: true } }),
    ]);
    // Dieselbe Regel wie beim Buchen: ein deaktiviertes Konto gibt es nicht mehr
    if (!account?.isActive || !counterAccount?.isActive) {
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
