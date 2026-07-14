import type { Request, Response, NextFunction } from "express";

// Parse a positive integer from an env var with a safe fallback. If the value
// is missing, blank, NaN, or non-positive, we use the default. This matters
// because a malformed env value would otherwise NaN-compare-false and silently
// disable rate limiting entirely.
function readPositiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PER_MIN = readPositiveInt(process.env.RATE_LIMIT_PER_MIN, 60);
const PER_DAY = readPositiveInt(process.env.RATE_LIMIT_PER_DAY, 1000);

// Sliding window: timestamps of recent requests per IP.
// Each value is kept pruned to the last 60s on every access, so `perMinute.size`
// accurately reflects IPs with activity in the current window.
const perMinute = new Map<string, number[]>();

// Daily quota per IP.
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
  const recent = (perMinute.get(ip) ?? []).filter((t) => now - t < 60_000);

  if (recent.length >= PER_MIN) {
    // recent[0] is the oldest timestamp still in the window; the window clears
    // 60s after it. Guard against an empty array defensively even though the
    // PER_MIN check above guarantees non-empty under a valid PER_MIN.
    const oldest = recent[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
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

  // Record this request. Write back the pruned array so perMinute.size never
  // overcounts stale IPs between background sweeps.
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

// Periodic cleanup of stale entries (belt-and-suspenders alongside the
// per-request pruning) every 5 minutes.
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
