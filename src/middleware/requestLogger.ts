/**
 * requestLogger.ts
 * ─────────────────
 * Request tracing and logging middleware for the Habeshare backend.
 *
 * Generates a unique requestId (trace ID) for every incoming request,
 * attaches it to the response headers so clients can reference it in
 * support tickets, and logs request metadata to Firestore `request_logs`.
 *
 * Usage (Express middleware):
 *   app.use(requestLoggerMiddleware);
 *
 * Usage (worker/service):
 *   const { requestId } = await logRequest({ method, endpoint, userId });
 */

import { collection, addDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

// ─── Trace ID Generation ─────────────────────────────────────────────────────

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * generateTraceId — creates a compact, URL-safe unique ID.
 * Format: req_<timestamp_base36>_<8 random chars>
 * Example: req_lrw4k1m2_x7f3a9b2
 */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Array.from({ length: 8 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join('');
  return `req_${timestamp}_${random}`;
}

// ─── Request Log Record ───────────────────────────────────────────────────────

export interface RequestLogRecord {
  requestId: string;
  method: string;
  endpoint: string;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  timestamp: string;
  source: 'api' | 'worker' | 'admin' | 'webhook';
}

const REQUEST_LOGS_COL = 'request_logs';

/**
 * logRequest — write a request trace record to Firestore.
 * Always non-fatal: if Firestore is unavailable, returns the requestId anyway.
 */
export async function logRequest(
  params: Omit<RequestLogRecord, 'requestId' | 'timestamp'> & { requestId?: string },
): Promise<{ requestId: string }> {
  const requestId = params.requestId ?? generateTraceId();
  const record: RequestLogRecord = {
    requestId,
    method: params.method,
    endpoint: params.endpoint,
    userId: params.userId ?? null,
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
    timestamp: new Date().toISOString(),
    source: params.source,
  };

  try {
    await addDoc(collection(db, REQUEST_LOGS_COL), record);
  } catch {
    // Non-fatal — trace ID is still returned even if Firestore write fails
  }

  return { requestId };
}

// ─── Express Middleware ───────────────────────────────────────────────────────

/**
 * requestLoggerMiddleware — Express-compatible request logger.
 * Attaches x-request-id to response headers and logs to Firestore.
 *
 * Mount before route handlers:
 *   app.use(requestLoggerMiddleware);
 */
export function requestLoggerMiddleware(
  req: {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
  },
  res: {
    setHeader: (key: string, value: string) => void;
    on: (event: string, fn: () => void) => void;
    statusCode?: number;
  },
  next: () => void,
): void {
  const requestId = generateTraceId();
  res.setHeader('x-request-id', requestId);

  const userId = (req.headers['x-user-id'] as string) ?? null;
  const userAgent = (req.headers['user-agent'] as string) ?? null;

  const endpoint = req.path;
  const source: RequestLogRecord['source'] =
    endpoint.startsWith('/api/admin')   ? 'admin' :
    endpoint.startsWith('/api/webhook') ? 'webhook' :
    'api';

  logRequest({
    requestId,
    method: req.method,
    endpoint,
    userId,
    ip: req.ip ?? null,
    userAgent,
    source,
  }).catch(() => {});

  next();
}
