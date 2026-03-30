import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import type { CacheModuleConfig, CompressionConfig, SwrConfig } from '../core';
import {
  CACHE_MODULE_CONFIG,
  CacheableContext,
  CacheableOption,
  CacheEnvelope,
  CacheEvictContext,
  CacheProvider,
  DEFAULT_CONFIG,
} from '../core';
import { sleep } from '../util';

interface ResolvedSwrConfig {
  enabled: boolean;
  defaultStaleMultiplier: number;
}

@Injectable()
export class CacheOperations implements OnModuleDestroy {
  private readonly logger = new Logger(CacheOperations.name);

  private readonly globalSwrConfig: SwrConfig;
  private readonly globalDefaultTtl: number | undefined;
  private readonly globalCompressionConfig: CompressionConfig;

  /** Tracks keys with a scheduled background refresh to prevent duplicate revalidations. */
  private readonly refreshingKeys = new Set<string>();

  /** In-process single-flight: collapses concurrent requests for the same key into one Promise. */
  private readonly inflightMap = new Map<string, Promise<unknown>>();

  /** Pending debounce timers for @CacheEvict. Map key: NUL-joined cache keys. */
  private readonly evictDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly pubSubTimeoutMs: number;

  constructor(@Inject(CACHE_MODULE_CONFIG) config: CacheModuleConfig) {
    this.globalSwrConfig = config?.swr ?? {};
    this.globalDefaultTtl = config?.defaults?.ttl;
    this.globalCompressionConfig = config?.compression ?? {};
    this.pubSubTimeoutMs = config?.swr?.pubSubTimeoutMs ?? DEFAULT_CONFIG.swr.pubSubTimeoutMs;
  }

  async getWithSwr(context: CacheableContext, option: CacheableOption): Promise<unknown> {
    const { key, cacheProvider } = context;
    const swrConfig = this.resolveSwrConfig(option);

    if (!swrConfig.enabled) {
      return this.getWithSimpleCache(context, option);
    }

    let envelope: CacheEnvelope | null = null;

    try {
      const cached = await cacheProvider.get<unknown>(key);
      envelope = CacheEnvelope.fromObject(cached);
    } catch (error) {
      this.logger.debug(`Cache read failed (key: ${key}), will revalidate`, error);
    }

    if (!envelope) {
      return this.handleCacheMissWithLock(context, option, swrConfig);
    }

    if (envelope.isStale()) {
      this.scheduleBackgroundRefresh(context, option, swrConfig);
    }

    return envelope.data;
  }

  async bulkEvict(context: CacheEvictContext): Promise<void> {
    const { keys, cacheProvider, allEntries = false, debounceMs } = context;

    const doEvict = async () => {
      try {
        if (allEntries) {
          await this.deleteByPatterns(cacheProvider, keys);
        } else {
          await this.deleteByKeys(cacheProvider, keys);
        }
      } catch (error) {
        this.logger.error('Cache eviction failed', error);
      }
    };

    if (!debounceMs || debounceMs <= 0) {
      return doEvict();
    }

    // NUL character cannot appear in Redis keys, so it is safe as a separator
    const timerId = keys.join('\0');
    const existing = this.evictDebounceTimers.get(timerId);
    if (existing) clearTimeout(existing);

    this.evictDebounceTimers.set(
      timerId,
      setTimeout(() => {
        this.evictDebounceTimers.delete(timerId);
        void doEvict();
      }, debounceMs),
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.evictDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.evictDebounceTimers.clear();
  }

  /**
   * Merges decorator-level and global SWR config.
   * Priority: @Cacheable({ swr }) > forRootAsync({ swr.enabled })
   */
  private resolveSwrConfig(option?: CacheableOption): ResolvedSwrConfig {
    const enabled: boolean =
      option?.swr !== undefined
        ? option.swr
        : (this.globalSwrConfig.enabled ?? DEFAULT_CONFIG.swr.enabled);

    const defaultStaleMultiplier: number =
      this.globalSwrConfig.defaultStaleMultiplier ?? DEFAULT_CONFIG.swr.defaultStaleMultiplier;

    return { enabled, defaultStaleMultiplier };
  }

  /** Resolves TTL with decorator-level taking priority over global defaults. */
  private resolveTtl(option: CacheableOption): number {
    const ttl = option.ttl ?? this.globalDefaultTtl;
    if (ttl === undefined) {
      throw new Error(
        'TTL is not configured. Set ttl on the decorator or configure defaults.ttl at the module level.',
      );
    }
    return ttl;
  }

  /** staleTtl = option.staleTtl ?? ttl * defaultStaleMultiplier */
  private resolveStaleTtl(option: CacheableOption, multiplier: number): number {
    const ttl = this.resolveTtl(option);
    return option.staleTtl ?? ttl * multiplier;
  }

  /**
   * Resolves compression config for a specific call.
   * Priority: @Cacheable({ compression }) > module-level compression
   */
  private resolveCompressionOverride(option: CacheableOption): CompressionConfig | undefined {
    if (option.compression === undefined) {
      return undefined;
    }
    if (option.compression === false) {
      return { enabled: false };
    }
    if (option.compression === true) {
      return { ...this.globalCompressionConfig, enabled: true };
    }
    return { ...this.globalCompressionConfig, ...option.compression, enabled: true };
  }

  /** Simple cache path used when SWR is disabled. */
  private async getWithSimpleCache(
    context: CacheableContext,
    option: CacheableOption,
  ): Promise<unknown> {
    const { key, cacheProvider, method, args } = context;
    const compressionOverride = this.resolveCompressionOverride(option);

    try {
      const cached = await cacheProvider.get<unknown>(key);
      if (cached !== null) {
        return cached;
      }
    } catch (error) {
      this.logger.debug(`Cache read failed (key: ${key})`, error);
    }

    const result = await method(...args);

    if (option.unless?.(result, ...args)) {
      return result;
    }

    const ttl = this.resolveTtl(option);
    try {
      await cacheProvider.put(key, result, ttl, compressionOverride);
    } catch (error) {
      this.logger.warn(`Failed to write cache entry (key: ${key})`, error);
    }

    return result;
  }

  /**
   * Deduplicates concurrent in-process cache misses for the same key into a single Promise,
   * then delegates to the distributed lock + Pub/Sub flow.
   */
  private handleCacheMissWithLock(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<unknown> {
    const { key } = context;

    const inflight = this.inflightMap.get(key);
    if (inflight) {
      return inflight;
    }

    const promise = this.fetchWithLockAndPubSub(context, option, swrConfig);
    this.inflightMap.set(key, promise);
    void promise.finally(() => this.inflightMap.delete(key));
    return promise;
  }

  /**
   * Acquires a distributed lock and refreshes the cache, or waits for another server to do it.
   *
   * Flow:
   * 1. tryLock success  → renewCache + notifyResult (PUBLISH to waiting servers)
   * 2. tryLock failure + waitForResult available → SUBSCRIBE and wait → read cache
   * 3. Pub/Sub timeout or unavailable → exponential-backoff polling
   * 4. Last resort → call the original method directly
   */
  private async fetchWithLockAndPubSub(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<unknown> {
    const { key, cacheProvider, method, args } = context;

    const lockAcquired = await cacheProvider.tryLock(key);

    if (lockAcquired) {
      try {
        // Double-check: another process may have populated the cache while we waited for the lock
        const cached = await this.getCacheEnvelope(key, cacheProvider);
        if (cached) {
          return cached.data;
        }

        const result = await this.renewCache(context, option, swrConfig);

        void cacheProvider.notifyResult?.(key);

        return result;
      } finally {
        await this.releaseLock(cacheProvider, key);
      }
    }

    // Lock not acquired — subscribe to the cache-ready event published by the lock holder
    if (cacheProvider.waitForResult) {
      try {
        await cacheProvider.waitForResult(key, this.pubSubTimeoutMs);
        const cached = await this.getCacheEnvelope(key, cacheProvider);
        if (cached) {
          return cached.data;
        }
      } catch {
        this.logger.debug(`Pub/Sub wait failed, falling back to polling (key: ${key})`);
      }
    }

    // Polling fallback with exponential backoff
    const { maxAttempts } = DEFAULT_CONFIG.swr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      await this.delayWithExponentialBackoff(attempt);
      // eslint-disable-next-line no-await-in-loop
      const cached = await this.getCacheEnvelope(key, cacheProvider);
      if (cached) {
        return cached.data;
      }
    }

    // Last resort: call the original method directly
    return method(...args);
  }

  /**
   * Schedules a background cache refresh for a stale entry.
   * Uses refreshingKeys to prevent duplicate refresh tasks for the same key.
   */
  private scheduleBackgroundRefresh(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): void {
    const { key } = context;

    if (this.refreshingKeys.has(key)) {
      return;
    }

    this.refreshingKeys.add(key);

    setImmediate(() => {
      this.backgroundRefresh(context, option, swrConfig)
        .catch((error) => {
          this.logger.error(`Background cache refresh failed (key: ${key})`, error);
        })
        .finally(() => {
          this.refreshingKeys.delete(key);
        });
    });
  }

  private async backgroundRefresh(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<void> {
    const { key, cacheProvider } = context;
    let lockAcquired = false;

    try {
      lockAcquired = await cacheProvider.tryLock(key);
      if (!lockAcquired) {
        return;
      }

      const cached = await this.getCacheEnvelope(key, cacheProvider);
      if (cached && cached.isFresh()) {
        return;
      }

      await this.renewCache(context, option, swrConfig);
    } finally {
      if (lockAcquired) {
        await this.releaseLock(cacheProvider, key);
      }
    }
  }

  /** Executes the original method and writes the result to the cache. */
  private async renewCache(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<unknown> {
    const { key, method, args, cacheProvider } = context;
    const ttl = this.resolveTtl(option);

    const result = await method(...args);

    if (option.unless?.(result, ...args)) {
      return result;
    }

    try {
      const envelope = CacheEnvelope.create(result, ttl);
      const staleTtl = this.resolveStaleTtl(option, swrConfig.defaultStaleMultiplier);
      const physicalTtl = this.resolvePhysicalTtl(ttl, staleTtl);
      const compressionOverride = this.resolveCompressionOverride(option);

      await cacheProvider.put(key, envelope.toObject(), physicalTtl, compressionOverride);
    } catch (error) {
      this.logger.warn(`Failed to write cache entry (key: ${key})`, error);
    }

    return result;
  }

  private async deleteByPatterns(cacheProvider: CacheProvider, patterns: string[]): Promise<void> {
    await Promise.all(patterns.map((pattern) => cacheProvider.clearKeysByPattern(pattern)));
  }

  private async deleteByKeys(cacheProvider: CacheProvider, keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => cacheProvider.evict(key)));
  }

  /**
   * physicalTtl = ttl + staleTtl + jitter
   * Jitter is applied only to the physical TTL to spread Redis key expiry across time.
   */
  private resolvePhysicalTtl(ttl: number, staleTtl: number): number {
    const physicalTtl = ttl + staleTtl;

    const JITTER_RATIO = 0.1;
    const MAX_JITTER_SECONDS = 20;
    const maxJitter = Math.min(physicalTtl * JITTER_RATIO, MAX_JITTER_SECONDS);
    const jitter = Math.random() * maxJitter;

    return Math.round(physicalTtl + jitter);
  }

  private async delayWithExponentialBackoff(attempt: number): Promise<void> {
    const { baseDelayMs, jitterMs, maxDelayMs } = DEFAULT_CONFIG.swr;

    const baseDelay = baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * jitterMs;
    const delay = Math.min(baseDelay + jitter, maxDelayMs);

    await sleep(delay);
  }

  private async getCacheEnvelope(
    key: string,
    cacheProvider: CacheProvider,
  ): Promise<CacheEnvelope | null> {
    try {
      const cached = await cacheProvider.get<unknown>(key);
      return CacheEnvelope.fromObject(cached);
    } catch {
      return null;
    }
  }

  private async releaseLock(cacheProvider: CacheProvider, lockKey: string): Promise<void> {
    try {
      await cacheProvider.unlock(lockKey);
    } catch (error) {
      this.logger.warn(`Failed to release lock (key: ${lockKey})`, error);
    }
  }
}
