import { Request } from 'express';

export function getClientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

export function getParam(req: Request, name: string): string {
  const val = req.params[name];
  if (Array.isArray(val)) return val[0];
  return val;
}
