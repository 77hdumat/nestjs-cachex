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
    // L1
    try {
      const l1Value = await this.l1Cache.get<T>(key);
      if (l1Value !== null) {
        return l1Value;
      }
    } catch (error) {
      this.logger.warn('L1 캐시 조회 실패', error);
    }

    // L2
    try {
      const l2Value = await this.l2Cache.get<T>(key);
      if (l2Value) {
        // L2 (Write-back)
        await this.l1Cache.put(key, l2Value, this.l1WriteBackTtl).catch(() => {});
        return l2Value;
      }
    } catch (error) {
      this.logger.warn('L2 캐시 조회 실패', error);
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
      // L2 실패 시 L1도 롤백하여 서버 간 불일치 방지
      await this.l1Cache.evict(key).catch(() => {});
      this.logger.warn(`멀티 캐시 L2 저장 실패, L1 롤백 (키: ${key})`);
    } else if (l1Result.status === 'rejected') {
      this.logger.warn(`멀티 캐시 L1 저장 실패 (키: ${key})`);
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
      return Promise.reject(new Error('L2 캐시가 waitForResult를 지원하지 않습니다'));
    }
    return this.l2Cache.waitForResult(key, timeoutMs);
  }

  async notifyResult(key: string): Promise<void> {
    await this.l2Cache.notifyResult?.(key);
  }
}
