import "server-only";

type Window = { start: number; count: number };
const windows = new Map<string, Window>();

/**
 * Fixed-window limiter kept in memory. Enough for one Render instance: it stops
 * a flood from burning our PayPal API quota (each webhook costs a verify call).
 * Returns true when the request may go ahead.
 */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  w.count++;
  return w.count <= limit;
}
