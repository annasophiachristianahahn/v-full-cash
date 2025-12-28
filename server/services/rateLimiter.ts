interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private queues: Map<string, Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();
  private processing: Map<string, boolean> = new Map();

  configure(name: string, config: RateLimitConfig): void {
    this.configs.set(name, config);
    this.buckets.set(name, {
      tokens: config.maxRequests,
      lastRefill: Date.now()
    });
    this.queues.set(name, []);
    this.processing.set(name, false);
  }

  private refillBucket(name: string): void {
    const config = this.configs.get(name);
    const bucket = this.buckets.get(name);
    if (!config || !bucket) return;

    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / config.windowMs * config.maxRequests);
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(config.maxRequests, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  private async processQueue(name: string): Promise<void> {
    if (this.processing.get(name)) return;
    this.processing.set(name, true);

    const config = this.configs.get(name);
    const bucket = this.buckets.get(name);
    const queue = this.queues.get(name);
    
    if (!config || !bucket || !queue) {
      this.processing.set(name, false);
      return;
    }

    while (queue.length > 0) {
      this.refillBucket(name);
      
      if (bucket.tokens > 0) {
        bucket.tokens--;
        const item = queue.shift();
        if (item) {
          item.resolve();
        }
      } else {
        const waitTime = Math.ceil(config.windowMs / config.maxRequests);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.processing.set(name, false);
  }

  async acquire(name: string): Promise<void> {
    const config = this.configs.get(name);
    const bucket = this.buckets.get(name);
    const queue = this.queues.get(name);

    if (!config || !bucket || !queue) {
      throw new Error(`Rate limiter "${name}" not configured`);
    }

    this.refillBucket(name);

    if (bucket.tokens > 0 && queue.length === 0) {
      bucket.tokens--;
      return;
    }

    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      this.processQueue(name);
    });
  }

  async withRateLimit<T>(name: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(name);
    return fn();
  }

  getStatus(name: string): { tokens: number; queueLength: number } | null {
    const bucket = this.buckets.get(name);
    const queue = this.queues.get(name);
    
    if (!bucket || !queue) return null;
    
    this.refillBucket(name);
    return {
      tokens: bucket.tokens,
      queueLength: queue.length
    };
  }

  clearQueue(name: string): void {
    const queue = this.queues.get(name);
    if (queue) {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) {
          item.reject(new Error('Queue cleared'));
        }
      }
    }
  }
}

export const rateLimiter = new RateLimiter();

rateLimiter.configure('openrouter', {
  maxRequests: 70,
  windowMs: 60000
});

rateLimiter.configure('dexscreener', {
  maxRequests: 60,
  windowMs: 60000
});

rateLimiter.configure('coingecko', {
  maxRequests: 20,
  windowMs: 60000
});

rateLimiter.configure('twitterapi', {
  maxRequests: 100,
  windowMs: 60000
});
