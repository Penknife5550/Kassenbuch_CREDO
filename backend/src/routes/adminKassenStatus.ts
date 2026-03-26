import { Router, Request, Response } from 'express';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { calculateCashBalance } from '../services/bookingService';

export const adminKassenStatusRouter = Router();
adminKassenStatusRouter.use(authenticate, requireAdmin);

adminKassenStatusRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const schools = await prisma.school.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const results = await Promise.all(
      schools.map(async (school) => {
        const [balance, lastBooking, lastClosing] = await Promise.all([
          calculateCashBalance(school.id),
          prisma.booking.findFirst({
            where: { schoolId: school.id },
            orderBy: { createdAt: 'desc' },
            include: { createdBy: { select: { displayName: true } } },
          }),
          prisma.dailyClosing.findFirst({
            where: { schoolId: school.id },
            orderBy: { closingDate: 'desc' },
          }),
        ]);

        const isClosedToday = lastClosing
          ? new Date(lastClosing.closingDate).setHours(0, 0, 0, 0) === today.getTime()
          : false;

        return {
          schoolId: school.id,
          schoolName: school.name,
          schoolCode: school.code,
          currentBalance: balance.toString(),
          lastBooking: lastBooking
            ? {
                date: lastBooking.bookingDate,
                createdAt: lastBooking.createdAt,
                user: lastBooking.createdBy.displayName,
              }
            : null,
          lastDailyClosing: lastClosing
            ? { date: lastClosing.closingDate }
            : null,
          isClosedToday,
        };
      })
    );

    res.json(results);
  } catch (err) {
    console.error('GET /admin/kassenstatus error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
