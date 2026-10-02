import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { RECEIPT_ISSUER_ID, getReceiptIssuer } from '../services/receiptIssuerService';
import { getClientIp } from '../utils/request';

export const receiptIssuerRouter = Router();
receiptIssuerRouter.use(authenticate);

// Lesen darf jeder angemeldete Benutzer: das Eigenbeleg-Formular zeigt damit
// vorab, ob der Aussteller fehlt.
receiptIssuerRouter.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await getReceiptIssuer(prisma));
  } catch (err) {
    console.error('GET /receipt-issuer error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const issuerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(200),
});

receiptIssuerRouter.put('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = issuerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bitte Name und Anschrift des Ausstellers angeben.', details: parsed.error.flatten() });
      return;
    }

    const existing = await getReceiptIssuer(prisma);
    const issuer = await prisma.receiptIssuer.upsert({
      where: { id: RECEIPT_ISSUER_ID },
      update: parsed.data,
      create: { id: RECEIPT_ISSUER_ID, ...parsed.data },
      select: { name: true, address: true },
    });

    try {
      await logAudit({
        userId: req.user!.userId,
        action: 'UPDATE_RECEIPT_ISSUER',
        entityType: 'receiptIssuer',
        entityId: RECEIPT_ISSUER_ID,
        oldValue: existing ?? undefined,
        newValue: issuer,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json(issuer);
  } catch (err) {
    console.error('PUT /receipt-issuer error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
