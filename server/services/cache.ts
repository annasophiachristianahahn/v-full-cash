interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private cleanup() {
    const now = Date.now();
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry && entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      expiresAt: now + ttlSeconds * 1000,
      createdAt: now
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getAge(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return Math.floor((Date.now() - entry.createdAt) / 1000);
  }

  getTTL(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const ttl = Math.floor((entry.expiresAt - Date.now()) / 1000);
    return Math.max(0, ttl);
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

export const cacheService = new CacheService();

export const CACHE_KEYS = {
  TRENDING_1H: 'trending:1h',
  TRENDING_24H: 'trending:24h',
  COINGECKO_COINS_LIST: 'coingecko:coins_list',
  TOKEN_DATA: (symbol: string) => `token:${symbol.toUpperCase()}`,
};

export const CACHE_TTL = {
  TRENDING: 120,
  COINGECKO_COINS_LIST: 3600,
  TOKEN_DATA: 300,
};
