import type { Request, Response, NextFunction } from "express";

const PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MIN || "60", 10);
const PER_DAY = parseInt(process.env.RATE_LIMIT_PER_DAY || "1000", 10);

// Sliding window: timestamps of recent requests per IP
const perMinute = new Map<string, number[]>();

// Daily quota per IP
const perDay = new Map<string, { count: number; resetAt: number }>();

function startOfNextDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();

  // ── Per-minute sliding window ──
  const timestamps = perMinute.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < 60_000);

  if (recent.length >= PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((recent[0]! + 60_000 - now) / 1000));
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Rate limit exceeded", retryAfter });
    return;
  }

  // ── Per-day quota ──
  let dayEntry = perDay.get(ip);
  if (!dayEntry || now >= dayEntry.resetAt) {
    dayEntry = { count: 0, resetAt: startOfNextDay(now) };
  }

  if (dayEntry.count >= PER_DAY) {
    const retryAfter = Math.max(1, Math.ceil((dayEntry.resetAt - now) / 1000));
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Daily quota exceeded", retryAfter });
    return;
  }

  // Record this request
  recent.push(now);
  perMinute.set(ip, recent);
  dayEntry.count++;
  perDay.set(ip, dayEntry);

  next();
}

export function rateLimitStats() {
  return {
    trackedIps: perMinute.size,
    dailyTrackedIps: perDay.size,
    limits: { perMinute: PER_MIN, perDay: PER_DAY },
  };
}

// Cleanup stale entries every 5 minutes
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of perMinute) {
    const recent = timestamps.filter((t) => now - t < 60_000);
    if (recent.length === 0) perMinute.delete(ip);
    else perMinute.set(ip, recent);
  }
  for (const [ip, entry] of perDay) {
    if (now >= entry.resetAt) perDay.delete(ip);
  }
}, 300_000);
cleanup.unref();
