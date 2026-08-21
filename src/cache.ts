interface CacheEntry {
  data: unknown;
  expiresAt: number;
  bytes: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
}

export class TtlCache {
  private store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private currentBytes = 0;
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    sweepIntervalMs = 60_000,
    private readonly maxEntries = readPositiveInt(process.env.CACHE_MAX_ENTRIES, 250),
    private readonly maxBytes = readPositiveInt(process.env.CACHE_MAX_BYTES, 64 * 1024 * 1024),
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweepTimer.unref();
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      // Lazy expiry on read: counts as a miss. Sweep-driven removals are the
      // only thing that bumps `evictions`, so the stat stays meaningful.
      this.deleteEntry(key, entry);
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Refresh insertion order so Map doubles as a small LRU index.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs: number): void {
    const bytes = estimateBytes(data);
    if (bytes > this.maxBytes) return;

    const existing = this.store.get(key);
    if (existing) this.deleteEntry(key, existing);

    while (this.store.size >= this.maxEntries || this.currentBytes + bytes > this.maxBytes) {
      const oldest = this.store.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldest) break;
      this.deleteEntry(oldest[0], oldest[1]);
      this.evictions++;
    }

    this.store.set(key, { data, expiresAt: Date.now() + ttlMs, bytes });
    this.currentBytes += bytes;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      evictions: this.evictions,
      bytes: this.currentBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }

  clear(): void {
    this.store.clear();
    this.currentBytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.deleteEntry(key, entry);
        this.evictions++;
      }
    }
  }

  private deleteEntry(key: string, entry: CacheEntry): void {
    if (this.store.delete(key)) this.currentBytes -= entry.bytes;
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function estimateBytes(data: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    return 0;
  }
}
