import { ErrorCode, StagewiseError } from './error-handling';

/**
 * Generic cache implementation with TTL support
 */
export class Cache<T> {
  private cache = new Map<string, { value: T; expiry: number }>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly defaultTTL: number = 5 * 60 * 1000, // 5 minutes
    private readonly maxSize: number = 100,
  ) {}

  set(key: string, value: T, ttl?: number): void {
    const expiry = Date.now() + (ttl || this.defaultTTL);

    // Clear existing timer if any
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Implement LRU eviction if at capacity
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      const oldestKey = this.findOldestKey();
      if (oldestKey) {
        this.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, expiry });

    // Set auto-cleanup timer
    const timer = setTimeout(() => {
      this.delete(key);
    }, ttl || this.defaultTTL);

    this.timers.set(key, timer);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiry) {
      this.delete(key);
      return undefined;
    }

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.cache.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.cache.clear();
    this.timers.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private findOldestKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestExpiry = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < oldestExpiry) {
        oldestExpiry = entry.expiry;
        oldestKey = key;
      }
    }

    return oldestKey;
  }
}

/**
 * Rate limiter implementation
 */
export class RateLimiter {
  private requests = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number = 10,
    private readonly windowMs: number = 60000, // 1 minute
  ) {}

  async checkLimit(key: string): Promise<boolean> {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];

    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(
      (timestamp) => now - timestamp < this.windowMs,
    );

    if (validTimestamps.length >= this.maxRequests) {
      return false;
    }

    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    return true;
  }

  async waitForSlot(key: string): Promise<void> {
    while (!(await this.checkLimit(key))) {
      // Calculate wait time until the oldest request expires
      const timestamps = this.requests.get(key) || [];
      if (timestamps.length > 0) {
        const oldestTimestamp = Math.min(...timestamps);
        const waitTime = this.windowMs - (Date.now() - oldestTimestamp) + 100; // Add small buffer
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, waitTime)),
        );
      } else {
        // Shouldn't happen, but just in case
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  reset(key?: string): void {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }

  getRemainingRequests(key: string): number {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    const validTimestamps = timestamps.filter(
      (timestamp) => now - timestamp < this.windowMs,
    );
    return Math.max(0, this.maxRequests - validTimestamps.length);
  }
}

/**
 * Request deduplication
 */
export class RequestDeduplicator<T> {
  private pendingRequests = new Map<string, Promise<T>>();

  async deduplicate(key: string, fn: () => Promise<T>): Promise<T> {
    // Check if there's already a pending request
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending;
    }

    // Create new request
    const promise = fn().finally(() => {
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.pendingRequests.size;
  }
}

/**
 * Memory usage monitor
 */
export class MemoryMonitor {
  private checkInterval: NodeJS.Timer | null = null;
  private callbacks: Array<(usage: NodeJS.MemoryUsage) => void> = [];

  start(intervalMs = 30000): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(() => {
      const usage = process.memoryUsage();
      this.callbacks.forEach((cb) => cb(usage));

      // Check if memory usage is high
      const heapUsedMB = usage.heapUsed / 1024 / 1024;
      const heapTotalMB = usage.heapTotal / 1024 / 1024;
      const percentage = (heapUsedMB / heapTotalMB) * 100;

      if (percentage > 90) {
        console.warn(
          `High memory usage: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${percentage.toFixed(1)}%)`,
        );
        // Trigger garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  onMemoryUsage(callback: (usage: NodeJS.MemoryUsage) => void): void {
    this.callbacks.push(callback);
  }

  getCurrentUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }
}

/**
 * Performance metrics collector
 */
export class PerformanceMetrics {
  private metrics = new Map<string, number[]>();
  private maxSamples = 100;

  recordMetric(name: string, value: number): void {
    const samples = this.metrics.get(name) || [];
    samples.push(value);

    // Keep only recent samples
    if (samples.length > this.maxSamples) {
      samples.shift();
    }

    this.metrics.set(name, samples);
  }

  getAverage(name: string): number | null {
    const samples = this.metrics.get(name);
    if (!samples || samples.length === 0) {
      return null;
    }

    const sum = samples.reduce((a, b) => a + b, 0);
    return sum / samples.length;
  }

  getPercentile(name: string, percentile: number): number | null {
    const samples = this.metrics.get(name);
    if (!samples || samples.length === 0) {
      return null;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  clear(name?: string): void {
    if (name) {
      this.metrics.delete(name);
    } else {
      this.metrics.clear();
    }
  }
}

/**
 * Utility function to measure async operation performance
 */
export async function measurePerformance<T>(
  name: string,
  fn: () => Promise<T>,
  metrics?: PerformanceMetrics,
): Promise<T> {
  const start = performance.now();

  try {
    const result = await fn();
    const duration = performance.now() - start;

    if (metrics) {
      metrics.recordMetric(name, duration);
    }

    console.debug(`[Performance] ${name} took ${duration.toFixed(2)}ms`);

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.error(
      `[Performance] ${name} failed after ${duration.toFixed(2)}ms`,
    );
    throw error;
  }
}

/**
 * Resource cleanup manager
 */
export class ResourceManager {
  private cleanupTasks: Array<() => void | Promise<void>> = [];

  addCleanupTask(task: () => void | Promise<void>): void {
    this.cleanupTasks.push(task);
  }

  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    for (const task of this.cleanupTasks) {
      try {
        await task();
      } catch (error) {
        errors.push(error as Error);
      }
    }

    this.cleanupTasks = [];

    if (errors.length > 0) {
      throw new StagewiseError(
        ErrorCode.UNKNOWN_ERROR,
        `Resource cleanup failed with ${errors.length} errors`,
        { errors },
        false,
      );
    }
  }
}

// Global instances
export const responseCache = new Cache<any>(5 * 60 * 1000); // 5 minutes
export const mcpRateLimiter = new RateLimiter(30, 60000); // 30 requests per minute
export const requestDeduplicator = new RequestDeduplicator();
export const memoryMonitor = new MemoryMonitor();
export const performanceMetrics = new PerformanceMetrics();
export const resourceManager = new ResourceManager();
