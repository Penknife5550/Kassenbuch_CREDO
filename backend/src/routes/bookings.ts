import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { authenticate, getSchoolScope } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getNextReceiptNumber, calculateCashBalance, calculateCashBalanceTx, isDayFinalized } from '../services/bookingService';
import { generateKassenbuchPdf } from '../services/pdfService';
import { getClientIp, getParam } from '../utils/request';

export const bookingsRouter = Router();
bookingsRouter.use(authenticate);

bookingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);

    const where: Prisma.BookingWhereInput = { schoolId };
    if (dateFrom || dateTo) {
      where.bookingDate = {};
      if (dateFrom) (where.bookingDate as Record<string, Date>).gte = new Date(dateFrom);
      if (dateTo) (where.bookingDate as Record<string, Date>).lte = new Date(dateTo);
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          account: { select: { id: true, accountNumber: true, name: true } },
          counterAccount: { select: { id: true, accountNumber: true, name: true } },
          costCenter: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, displayName: true } },
          stornoOf: { select: { id: true, receiptNumber: true } },
        },
        orderBy: [{ receiptNumber: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    const balance = await calculateCashBalance(schoolId);

    res.json({
      bookings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      currentBalance: balance.toString(),
    });
  } catch (err) {
    console.error('GET /bookings error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

bookingsRouter.get('/balance', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }
    const balance = await calculateCashBalance(schoolId);
    res.json({ balance: balance.toString() });
  } catch (err) {
    console.error('GET /bookings/balance error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

bookingsRouter.get('/pdf', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    let dateFrom: Date;
    let dateTo: Date;

    const month = req.query.month as string | undefined;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mon] = month.split('-').map(Number);
      dateFrom = new Date(year, mon - 1, 1);
      dateTo = new Date(year, mon, 0); // last day of month
    } else {
      const df = req.query.dateFrom as string | undefined;
      const dt = req.query.dateTo as string | undefined;
      if (!df || !dt) {
        res.status(400).json({ error: 'dateFrom/dateTo oder month Parameter erforderlich' });
        return;
      }
      dateFrom = new Date(df);
      dateTo = new Date(dt);
    }

    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      res.status(400).json({ error: 'Ungültiges Datumsformat' });
      return;
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      res.status(404).json({ error: 'Schule nicht gefunden' });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: {
        schoolId,
        bookingDate: { gte: dateFrom, lte: dateTo },
      },
      include: {
        account: { select: { accountNumber: true, name: true } },
        counterAccount: { select: { accountNumber: true, name: true } },
        costCenter: { select: { code: true, name: true } },
      },
      orderBy: { receiptNumber: 'asc' },
    });

    // Calculate opening balance (all bookings before dateFrom)
    const openingBalance = await calculateCashBalance(schoolId, new Date(dateFrom.getTime() - 86400000));

    const pdf = generateKassenbuchPdf({
      bookings: bookings.map((b) => ({
        receiptNumber: b.receiptNumber,
        bookingDate: b.bookingDate,
        description: b.description,
        account: b.account,
        counterAccount: b.counterAccount,
        costCenter: b.costCenter,
        amount: b.amount.toString(),
        debitCredit: b.debitCredit,
        isStorno: b.isStorno,
      })),
      schoolName: school.name,
      schoolCode: school.code,
      dateFrom,
      dateTo,
      openingBalance: openingBalance.toString(),
    });

    const filename = `Kassenbuch_${school.code}_${dateFrom.toISOString().slice(0, 10)}_${dateTo.toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdf.pipe(res);
  } catch (err) {
    console.error('GET /bookings/pdf error:', err);
    res.status(500).json({ error: 'PDF-Generierung fehlgeschlagen' });
  }
});

// GET /bookings/has-bookings - must be before /:id routes
bookingsRouter.get('/has-bookings', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }
    const count = await prisma.booking.count({ where: { schoolId } });
    res.json({ hasBookings: count > 0 });
  } catch (err) {
    console.error('GET /bookings/has-bookings error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const createBookingSchema = z.object({
  amount: z.number().positive(),
  debitCredit: z.enum(['S', 'H']),
  accountId: z.string().uuid(),
  counterAccountId: z.string().uuid(),
  costCenterId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  taxKey: z.string().max(5).optional(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

bookingsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Buchungsdaten', details: parsed.error.flatten() });
      return;
    }

    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Determine booking date - use provided date or default to today
    let bookingDate: Date;
    if (parsed.data.bookingDate) {
      bookingDate = new Date(parsed.data.bookingDate);
      bookingDate.setHours(0, 0, 0, 0);
      if (isNaN(bookingDate.getTime())) {
        res.status(400).json({ error: 'Ungültiges Buchungsdatum' });
        return;
      }
      if (bookingDate > today) {
        res.status(400).json({ error: 'Buchungsdatum darf nicht in der Zukunft liegen.' });
        return;
      }
    } else {
      bookingDate = today;
    }

    const finalized = await isDayFinalized(schoolId, bookingDate);
    if (finalized) {
      res.status(409).json({ error: 'Tagesabschluss für dieses Datum bereits durchgeführt. Keine Buchungen möglich.' });
      return;
    }

    // Atomic transaction: balance check + receipt number + booking creation
    const booking = await prisma.$transaction(async (tx) => {
      // Balance check inside transaction for consistency
      if (parsed.data.debitCredit === 'H') {
        const currentBalance = await calculateCashBalanceTx(tx, schoolId);
        const newBalance = currentBalance.sub(new Prisma.Decimal(parsed.data.amount));
        if (newBalance.isNegative()) {
          throw new Error(`BALANCE:Kassenbestand darf nicht negativ werden. Aktueller Bestand: ${currentBalance.toString()} EUR`);
        }
      }

      const receiptNumber = await getNextReceiptNumber(tx, schoolId);

      return tx.booking.create({
        data: {
          schoolId,
          receiptNumber,
          bookingDate,
          amount: new Prisma.Decimal(parsed.data.amount),
          debitCredit: parsed.data.debitCredit,
          accountId: parsed.data.accountId,
          counterAccountId: parsed.data.counterAccountId,
          costCenterId: parsed.data.costCenterId,
          description: parsed.data.description,
          taxKey: parsed.data.taxKey,
          createdById: req.user!.userId,
        },
        include: {
          account: { select: { accountNumber: true, name: true } },
          counterAccount: { select: { accountNumber: true, name: true } },
          costCenter: { select: { code: true, name: true } },
          createdBy: { select: { displayName: true } },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Audit log outside transaction (non-critical, best-effort)
    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'CREATE_BOOKING',
        entityType: 'booking',
        entityId: booking.id,
        newValue: {
          receiptNumber: booking.receiptNumber,
          amount: parsed.data.amount,
          debitCredit: parsed.data.debitCredit,
          description: parsed.data.description,
        },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(booking);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('BALANCE:')) {
      res.status(409).json({ error: err.message.slice(8) });
      return;
    }
    console.error('POST /bookings error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── Splittbuchungen ─────────────────────────────────────────────────────────
const splitLineSchema = z.object({
  amount: z.number().positive(),
  counterAccountId: z.string().uuid(),
  costCenterId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  taxKey: z.string().max(5).optional(),
});

const splitBookingSchema = z.object({
  totalAmount: z.number().positive(),
  debitCredit: z.enum(['S', 'H']),
  accountId: z.string().uuid(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(splitLineSchema).min(2, 'Mindestens 2 Split-Zeilen erforderlich'),
});

bookingsRouter.post('/split', async (req: Request, res: Response) => {
  try {
    const parsed = splitBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Splittbuchungsdaten', details: parsed.error.flatten() });
      return;
    }

    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    // Validate that split lines sum to totalAmount
    const linesSum = parsed.data.lines.reduce((s, l) => s + l.amount, 0);
    const diff = Math.abs(linesSum - parsed.data.totalAmount);
    if (diff > 0.005) {
      res.status(400).json({
        error: `Summe der Split-Zeilen (${linesSum.toFixed(2)}) stimmt nicht mit Gesamtbetrag (${parsed.data.totalAmount.toFixed(2)}) überein.`,
      });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let bookingDate: Date;
    if (parsed.data.bookingDate) {
      bookingDate = new Date(parsed.data.bookingDate);
      bookingDate.setHours(0, 0, 0, 0);
      if (isNaN(bookingDate.getTime())) {
        res.status(400).json({ error: 'Ungültiges Buchungsdatum' });
        return;
      }
      if (bookingDate > today) {
        res.status(400).json({ error: 'Buchungsdatum darf nicht in der Zukunft liegen.' });
        return;
      }
    } else {
      bookingDate = today;
    }

    const finalized = await isDayFinalized(schoolId, bookingDate);
    if (finalized) {
      res.status(409).json({ error: 'Tagesabschluss für dieses Datum bereits durchgeführt. Keine Buchungen möglich.' });
      return;
    }

    const splitGroupId = crypto.randomUUID();

    const bookings = await prisma.$transaction(async (tx) => {
      // Balance check for Ausgabe (H)
      if (parsed.data.debitCredit === 'H') {
        const currentBalance = await calculateCashBalanceTx(tx, schoolId);
        const newBalance = currentBalance.sub(new Prisma.Decimal(parsed.data.totalAmount));
        if (newBalance.isNegative()) {
          throw new Error(`BALANCE:Kassenbestand darf nicht negativ werden. Aktueller Bestand: ${currentBalance.toString()} EUR`);
        }
      }

      // One receipt number for the entire split group
      const receiptNumber = await getNextReceiptNumber(tx, schoolId);

      const created = [];
      for (const line of parsed.data.lines) {
        const booking = await tx.booking.create({
          data: {
            schoolId,
            receiptNumber,
            bookingDate,
            amount: new Prisma.Decimal(line.amount),
            debitCredit: parsed.data.debitCredit,
            accountId: parsed.data.accountId,
            counterAccountId: line.counterAccountId,
            costCenterId: line.costCenterId,
            description: line.description,
            taxKey: line.taxKey,
            splitGroupId,
            createdById: req.user!.userId,
          },
          include: {
            account: { select: { accountNumber: true, name: true } },
            counterAccount: { select: { accountNumber: true, name: true } },
            costCenter: { select: { code: true, name: true } },
            createdBy: { select: { displayName: true } },
          },
        });
        created.push(booking);
      }
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'CREATE_SPLIT_BOOKING',
        entityType: 'booking',
        entityId: splitGroupId,
        newValue: {
          receiptNumber: bookings[0].receiptNumber,
          totalAmount: parsed.data.totalAmount,
          debitCredit: parsed.data.debitCredit,
          linesCount: bookings.length,
        },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.status(201).json(bookings);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('BALANCE:')) {
      res.status(409).json({ error: err.message.slice(8) });
      return;
    }
    console.error('POST /bookings/split error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

bookingsRouter.post('/:id/storno', async (req: Request, res: Response) => {
  try {
    const schoolId = getSchoolScope(req);
    if (!schoolId) {
      res.status(400).json({ error: 'Schule muss angegeben werden' });
      return;
    }

    const original = await prisma.booking.findUnique({
      where: { id: getParam(req, 'id') },
      include: { stornoBookings: true },
    });

    if (!original) {
      res.status(404).json({ error: 'Buchung nicht gefunden' });
      return;
    }

    if (original.schoolId !== schoolId) {
      res.status(403).json({ error: 'Kein Zugriff auf diese Buchung' });
      return;
    }

    if (original.isStorno) {
      res.status(409).json({ error: 'Eine Stornobuchung kann nicht erneut storniert werden' });
      return;
    }

    if (original.stornoBookings.length > 0) {
      res.status(409).json({ error: 'Diese Buchung wurde bereits storniert' });
      return;
    }

    if (original.isFinalized) {
      res.status(409).json({ error: 'Festgeschriebene Buchungen können nicht storniert werden' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const finalized = await isDayFinalized(schoolId, today);
    if (finalized) {
      res.status(409).json({ error: 'Tagesabschluss bereits durchgeführt' });
      return;
    }

    // Determine all bookings to storno (single or split group)
    let originalsToStorno = [original];
    if (original.splitGroupId) {
      originalsToStorno = await prisma.booking.findMany({
        where: { splitGroupId: original.splitGroupId },
        include: { stornoBookings: true },
      });
      // Check if any booking in the group is already stornoed or finalized
      for (const ob of originalsToStorno) {
        if (ob.stornoBookings.length > 0) {
          res.status(409).json({ error: 'Diese Splittbuchung wurde bereits storniert' });
          return;
        }
        if (ob.isFinalized) {
          res.status(409).json({ error: 'Festgeschriebene Buchungen können nicht storniert werden' });
          return;
        }
      }
    }

    // Calculate total amount for balance check
    const totalAmount = originalsToStorno.reduce(
      (sum, b) => sum.add(b.amount),
      new Prisma.Decimal(0),
    );
    const reverseDebitCredit = original.debitCredit === 'S' ? 'H' as const : 'S' as const;

    // Atomic transaction: balance check + receipt number + storno creation
    const stornoBookings = await prisma.$transaction(async (tx) => {
      if (reverseDebitCredit === 'H') {
        const currentBalance = await calculateCashBalanceTx(tx, schoolId);
        const newBalance = currentBalance.sub(totalAmount);
        if (newBalance.isNegative()) {
          throw new Error(`BALANCE:Storno würde zu negativem Kassenbestand führen. Aktueller Bestand: ${currentBalance.toString()} EUR`);
        }
      }

      const receiptNumber = await getNextReceiptNumber(tx, schoolId);
      const stornoSplitGroupId = originalsToStorno.length > 1 ? crypto.randomUUID() : undefined;

      const created = [];
      for (const ob of originalsToStorno) {
        const storno = await tx.booking.create({
          data: {
            schoolId,
            receiptNumber,
            bookingDate: today,
            amount: ob.amount,
            debitCredit: reverseDebitCredit,
            accountId: ob.accountId,
            counterAccountId: ob.counterAccountId,
            costCenterId: ob.costCenterId,
            description: `STORNO: ${ob.description}`,
            taxKey: ob.taxKey,
            isStorno: true,
            stornoOfId: ob.id,
            stornoById: req.user!.userId,
            splitGroupId: stornoSplitGroupId,
            createdById: req.user!.userId,
          },
          include: {
            account: { select: { accountNumber: true, name: true } },
            counterAccount: { select: { accountNumber: true, name: true } },
            createdBy: { select: { displayName: true } },
          },
        });
        created.push(storno);
      }
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: originalsToStorno.length > 1 ? 'STORNO_SPLIT_BOOKING' : 'STORNO_BOOKING',
        entityType: 'booking',
        entityId: stornoBookings[0].id,
        oldValue: { originalBookingId: original.id, originalReceiptNumber: original.receiptNumber, linesCount: originalsToStorno.length },
        newValue: { stornoReceiptNumber: stornoBookings[0].receiptNumber },
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    // Return single storno for simple bookings, array for splits
    res.status(201).json(originalsToStorno.length > 1 ? stornoBookings : stornoBookings[0]);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('BALANCE:')) {
      res.status(409).json({ error: err.message.slice(8) });
      return;
    }
    console.error('POST /bookings/:id/storno error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
