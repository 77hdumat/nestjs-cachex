import { Inject, Injectable, Logger } from '@nestjs/common';

import type { CacheModuleConfig, CompressionConfig } from '../core';
import { CACHE_MODULE_CONFIG, CacheProvider, DEFAULT_CONFIG } from '../core';

import { InMemoryCache } from './memory-cache';
import { RedisCache } from './redis-cache';

@Injectable()
export class MultiCache implements CacheProvider {
  private readonly logger = new Logger(MultiCache.name);

  private readonly l1MaxTtl: number;
  private readonly l2DefaultTtl: number;
  private readonly l1WriteBackTtl: number;

  constructor(
    @Inject(CACHE_MODULE_CONFIG) config: CacheModuleConfig,
    private readonly l1Cache: InMemoryCache,
    private readonly l2Cache: RedisCache,
  ) {
    this.l1MaxTtl = config.multi?.l1MaxTtl ?? DEFAULT_CONFIG.multi.l1MaxTtl;
    this.l2DefaultTtl = config.multi?.l2DefaultTtl ?? DEFAULT_CONFIG.multi.l2DefaultTtl;
    this.l1WriteBackTtl = config.multi?.writeBackTtl ?? DEFAULT_CONFIG.multi.writeBackTtl;
  }

  async ping(): Promise<string> {
    const [l1Result, l2Result] = await Promise.allSettled([
      this.l1Cache.ping(),
      this.l2Cache.ping(),
    ]);

    const l1Status = l1Result.status === 'fulfilled' ? l1Result.value : 'ERROR';
    const l2Status = l2Result.status === 'fulfilled' ? l2Result.value : 'ERROR';

    return `L1: ${l1Status}, L2: ${l2Status}`;
  }

  async tryLock(key: string, expire = 60): Promise<boolean> {
    return this.l2Cache.tryLock(key, expire);
  }

  async unlock(lockKey: string): Promise<boolean> {
    return this.l2Cache.unlock(lockKey);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const l1Value = await this.l1Cache.get<T>(key);
      if (l1Value !== null) {
        return l1Value;
      }
    } catch (error) {
      this.logger.warn('L1 cache read failed', error);
    }

    try {
      const l2Value = await this.l2Cache.get<T>(key);
      if (l2Value !== null) {
        // write-back to L1
        await this.l1Cache.put(key, l2Value, this.l1WriteBackTtl).catch(() => {});
        return l2Value;
      }
    } catch (error) {
      this.logger.warn('L2 cache read failed', error);
    }

    return null;
  }

  async put(
    key: string,
    value: unknown,
    ttl?: number,
    compressionOverride?: CompressionConfig,
  ): Promise<void> {
    const l1Ttl = Math.min(ttl || this.l1MaxTtl, this.l1MaxTtl);
    const l2Ttl = ttl || this.l2DefaultTtl;

    const [l1Result, l2Result] = await Promise.allSettled([
      this.l1Cache.put(key, value, l1Ttl, compressionOverride),
      this.l2Cache.put(key, value, l2Ttl, compressionOverride),
    ]);

    if (l2Result.status === 'rejected') {
      // roll back L1 on L2 failure to prevent cross-server inconsistency
      await this.l1Cache.evict(key).catch(() => {});
      this.logger.warn(`Multi-cache L2 write failed, rolled back L1 (key: ${key})`);
    } else if (l1Result.status === 'rejected') {
      this.logger.warn(`Multi-cache L1 write failed (key: ${key})`);
    }
  }

  async clear(): Promise<void> {
    await Promise.allSettled([this.l1Cache.clear(), this.l2Cache.clear()]);
  }

  async evict(key: string): Promise<void> {
    await Promise.allSettled([this.l1Cache.evict(key), this.l2Cache.evict(key)]);
  }

  async clearKeysByPattern(pattern: string): Promise<void> {
    await Promise.allSettled([
      this.l1Cache.clearKeysByPattern(pattern),
      this.l2Cache.clearKeysByPattern(pattern),
    ]);
  }

  async waitForResult(key: string, timeoutMs: number): Promise<void> {
    if (!this.l2Cache.waitForResult) {
      return Promise.reject(new Error('L2 cache does not support waitForResult'));
    }
    return this.l2Cache.waitForResult(key, timeoutMs);
  }

  async notifyResult(key: string): Promise<void> {
    await this.l2Cache.notifyResult?.(key);
  }
}
