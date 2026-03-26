import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../prismaClient';
import { config } from '../config';
import { authenticate, AuthPayload } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { getClientIp } from '../utils/request';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
      return;
    }

    const { username, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      return;
    }

    const payload: AuthPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      schoolId: user.schoolId,
    };

    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    });

    try {
      await logAudit({
        userId: user.id,
        action: 'LOGIN',
        entityType: 'user',
        entityId: user.id,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        schoolId: user.schoolId,
      },
    });
  } catch (err) {
    console.error('POST /auth/login error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { school: true },
    });

    if (!user) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      schoolId: user.schoolId,
      school: user.school ? {
        id: user.school.id,
        name: user.school.name,
        code: user.school.code,
        kasseAccountId: user.school.kasseAccountId,
        anfangsbestandAccountId: user.school.anfangsbestandAccountId,
        kassendifferenzAccountId: user.school.kassendifferenzAccountId,
      } : null,
    });
  } catch (err) {
    console.error('GET /auth/me error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post('/change-password', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich (min. 8 Zeichen)' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
      return;
    }

    const hash = await bcrypt.hash(parsed.data.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });

    try {
      await logAudit({
        userId: user.id,
        action: 'CHANGE_PASSWORD',
        entityType: 'user',
        entityId: user.id,
        ipAddress: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.json({ message: 'Passwort geändert' });
  } catch (err) {
    console.error('POST /auth/change-password error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});
