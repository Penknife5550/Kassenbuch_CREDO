import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { authenticate, getSchoolScope } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { calculateCashBalance, getNextReceiptNumber } from '../services/bookingService';
import { generateEigenbelegPdf } from '../services/pdfService';
import { getClientIp } from '../utils/request';

export const dailyClosingRouter = Router();
dailyClosingRouter.use(authenticate);

dailyClosingRouter.get('/', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    const closings = await prisma.dailyClosing.findMany({
      where: { schoolId },
      include: {
        closedBy: { select: { displayName: true } },
        correctionBooking: {
          select: {
            receiptNumber: true,
            amount: true,
            debitCredit: true,
            description: true,
          },
        },
      },
      orderBy: { closingDate: 'desc' },
      take: 30,
    });

    res.json(closings);
  } catch (err) {
    console.error('GET /daily-closing error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

dailyClosingRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.dailyClosing.findUnique({
      where: { schoolId_closingDate: { schoolId, closingDate: today } },
    });

    const expectedBalance = await calculateCashBalance(schoolId);

    const todayBookings = await prisma.booking.count({
      where: { schoolId, bookingDate: today },
    });

    res.json({
      date: today.toISOString().split('T')[0],
      isClosed: !!existing,
      expectedBalance: expectedBalance.toString(),
      todayBookingsCount: todayBookings,
    });
  } catch (err) {
    console.error('GET /daily-closing/status error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// GET /daily-closing/eigenbeleg/:id – must be before /:id if needed
dailyClosingRouter.get('/eigenbeleg/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    const closing = await prisma.dailyClosing.findFirst({
      where: { id: req.params.id as string },
      include: {
        school: { select: { name: true, code: true } },
        closedBy: { select: { displayName: true } },
        correctionBooking: {
          include: {
            account: { select: { accountNumber: true, name: true } },
            counterAccount: { select: { accountNumber: true, name: true } },
          },
        },
      },
    });

    if (!closing || closing.schoolId !== schoolId) {
      res.status(404).json({ error: 'Tagesabschluss nicht gefunden' });
      return;
    }

    const pdf = generateEigenbelegPdf({
      schoolName: closing.school.name,
      schoolCode: closing.school.code,
      closingDate: closing.closingDate,
      expectedBalance: closing.expectedBalance.toString(),
      actualBalance: closing.actualBalance.toString(),
      difference: closing.difference.toString(),
      comment: closing.comment ?? undefined,
      denominationCounts: closing.denominationCounts as Record<string, number> | undefined,
      correctionBooking: closing.correctionBooking
        ? {
            receiptNumber: closing.correctionBooking.receiptNumber,
            amount: closing.correctionBooking.amount.toString(),
            debitCredit: closing.correctionBooking.debitCredit,
            description: closing.correctionBooking.description,
            account: closing.correctionBooking.account,
            counterAccount: closing.correctionBooking.counterAccount,
          }
        : undefined,
      closedByName: closing.closedBy.displayName,
    });

    const dateStr = closing.closingDate.toISOString().slice(0, 10);
    const filename = `Eigenbeleg_${closing.school.code}_${dateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdf.pipe(res);
  } catch (err) {
    console.error('GET /daily-closing/eigenbeleg error:', err);
    res.status(500).json({ error: 'PDF-Generierung fehlgeschlagen' });
  }
});

const denominationCountsSchema = z.object({
  n500: z.number().int().min(0).default(0),
  n200: z.number().int().min(0).default(0),
  n100: z.number().int().min(0).default(0),
  n50:  z.number().int().min(0).default(0),
  n20:  z.number().int().min(0).default(0),
  n10:  z.number().int().min(0).default(0),
  n5:   z.number().int().min(0).default(0),
  c200: z.number().int().min(0).default(0),
  c100: z.number().int().min(0).default(0),
  c50:  z.number().int().min(0).default(0),
  c20:  z.number().int().min(0).default(0),
  c10:  z.number().int().min(0).default(0),
  c5:   z.number().int().min(0).default(0),
  c2:   z.number().int().min(0).default(0),
  c1:   z.number().int().min(0).default(0),
});

const closeSchema = z.object({
  actualBalance: z.number().min(0),
  comment: z.string().min(10).optional(),
  denominationCounts: denominationCountsSchema.optional(),
  createCorrectionBooking: z.boolean().default(false),
  kasseAccountId: z.string().uuid().optional(),
  kassendifferenzAccountId: z.string().uuid().optional(),
});

dailyClosingRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Daten', details: parsed.error.flatten() });
      return;
    }

    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.dailyClosing.findUnique({
      where: { schoolId_closingDate: { schoolId, closingDate: today } },
    });
    if (existing) {
      res.status(409).json({ error: 'Tagesabschluss für heute bereits durchgeführt' });
      return;
    }

    const expectedBalance = await calculateCashBalance(schoolId);
    const actualBalance = new Prisma.Decimal(parsed.data.actualBalance);
    const difference = actualBalance.sub(expectedBalance);

    // Comment is required when there is a difference
    if (!difference.isZero() && !parsed.data.comment) {
      res.status(400).json({ error: 'Bei Kassendifferenz ist ein Kommentar (mind. 10 Zeichen) erforderlich.' });
      return;
    }

    // Account IDs required for correction booking
    if (!difference.isZero() && parsed.data.createCorrectionBooking) {
      if (!parsed.data.kasseAccountId || !parsed.data.kassendifferenzAccountId) {
        res.status(400).json({ error: 'Konto-IDs für Korrekturbuchung erforderlich.' });
        return;
      }
    }

    const closing = await prisma.$transaction(async (tx) => {
      let correctionBookingId: string | undefined;

      // Create correction booking if there is a difference
      if (!difference.isZero() && parsed.data.createCorrectionBooking) {
        const isOverage = difference.greaterThan(0);
        // Überschuss (more cash): H (Ausgabe) - excess leaves the cash account conceptually
        // Fehlbetrag (less cash): S (Einnahme) - correction brings balance up to actual
        // Actually: we want to bring Sollbestand to match Istbestand
        // If Ist > Soll: we have MORE money → book S/Einnahme to increase Soll
        // If Ist < Soll: we have LESS money → book H/Ausgabe to decrease Soll
        const correctionDebitCredit = isOverage ? 'S' as const : 'H' as const;
        const correctionAmount = difference.abs();
        const correctionDesc = isOverage
          ? `Kassendifferenz - Überschuss: ${parsed.data.comment}`
          : `Kassendifferenz - Fehlbetrag: ${parsed.data.comment}`;

        const receiptNumber = await getNextReceiptNumber(tx, schoolId);
        const correctionBooking = await tx.booking.create({
          data: {
            schoolId,
            receiptNumber,
            bookingDate: today,
            amount: correctionAmount,
            debitCredit: correctionDebitCredit,
            accountId: parsed.data.kasseAccountId!,
            counterAccountId: parsed.data.kassendifferenzAccountId!,
            description: correctionDesc,
            createdById: req.user!.userId,
            isFinalized: true,
          },
        });
        correctionBookingId = correctionBooking.id;
      }

      // Finalize ALL unfinalised bookings up to and including today
      await tx.booking.updateMany({
        where: { schoolId, bookingDate: { lte: today }, isFinalized: false },
        data: { isFinalized: true },
      });

      return tx.dailyClosing.create({
        data: {
          schoolId,
          closingDate: today,
          expectedBalance,
          actualBalance,
          difference,
          closedById: req.user!.userId,
          comment: parsed.data.comment,
          correctionBookingId,
          denominationCounts: parsed.data.denominationCounts
            ? (parsed.data.denominationCounts as object)
            : undefined,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'DAILY_CLOSING',
        entityType: 'dailyClosing',
        entityId: closing.id,
        newValue: {
          date: today.toISOString().split('T')[0],
          expectedBalance: expectedBalance.toString(),
          actualBalance: actualBalance.toString(),
          difference: difference.toString(),
          hasCorrectionBooking: !!closing.correctionBookingId,
        },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(closing);
  } catch (err) {
    console.error('POST /daily-closing error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
