/**
 * middleware/validate.ts
 * ──────────────────────
 * Lightweight request body validator.
 * Throws 400 with a clear message if required fields are missing or invalid.
 */

import { Request, Response, NextFunction } from 'express';

export function requireFields(
  ...fields: string[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing = fields.filter((f) => req.body[f] === undefined || req.body[f] === '');
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }
    next();
  };
}

export function requireEnum(
  field: string,
  allowed: readonly string[],
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[field];
    if (!allowed.includes(value)) {
      res.status(400).json({
        error: `Invalid value for '${field}'. Allowed: ${allowed.join(', ')}`,
      });
      return;
    }
    next();
  };
}
