import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prismaClient';

export interface AuthPayload {
  userId: string;
  username: string;
  role: 'ADMIN' | 'USER';
  schoolId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nicht authentifiziert' });
    return;
  }

  let payload: AuthPayload;
  try {
    const token = header.slice(7);
    payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
    }) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
    return;
  }

  // Wer deaktiviert wird, verliert seine Anmeldung sofort — nicht erst, wenn
  // das Token nach bis zu acht Stunden ablaeuft. Das betrifft etwa die
  // Sammelkonten, sobald es persoenliche Konten gibt.
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { isActive: true } });
    if (!user?.isActive) {
      res.status(401).json({ error: 'Benutzerkonto ist deaktiviert' });
      return;
    }
  } catch (err) {
    console.error('authenticate: Benutzer konnte nicht geprüft werden:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
    return;
  }

  req.user = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Nur für Administratoren' });
    return;
  }
  next();
}

export function getSchoolScope(req: Request): string | null {
  if (req.user?.role === 'ADMIN') {
    return req.query.schoolId as string || null;
  }
  return req.user?.schoolId || null;
}
