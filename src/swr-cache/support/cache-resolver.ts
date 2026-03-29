import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { CacheProvider } from '../core/cache-provider';
import type { CacheModuleConfig } from '../core/types';
import { CACHE_MODULE_CONFIG, CacheManager } from '../core/types';
import { InMemoryCache } from '../provider/memory-cache';
import { MultiCache } from '../provider/multi-cache';
import { RedisCache } from '../provider/redis-cache';

/**
 * 캐시 전략을 관리하는 캐시 리졸버입니다.
 * 단일 레벨(Redis 또는 Memory) 및 멀티 레벨 캐싱을 지원합니다.
 *
 * @example
 * - REDIS: 단일 레벨 Redis 캐시
 * - MEMORY: 단일 레벨 인메모리 캐시
 * - MULTI: L1 (메모리) + L2 (Redis)의 2단계 캐시
 */
@Injectable()
export class CacheResolver implements OnModuleInit {
  private readonly logger = new Logger(CacheResolver.name);

  private readonly cacheProviders = new Map<CacheManager, CacheProvider>();

  private readonly defaultCacheManager: CacheManager;

  constructor(
    @Inject(CACHE_MODULE_CONFIG) config: CacheModuleConfig,
    @Optional() private readonly redisCache?: RedisCache,
    @Optional() private readonly inMemoryCache?: InMemoryCache,
    @Optional() private readonly multiCache?: MultiCache,
  ) {
    this.defaultCacheManager = config?.defaults?.cacheManager ?? CacheManager.REDIS;
  }

  onModuleInit() {
    if (this.redisCache) {
      this.cacheProviders.set(CacheManager.REDIS, this.redisCache);
    }

    if (this.inMemoryCache) {
      this.cacheProviders.set(CacheManager.MEMORY, this.inMemoryCache);
    }

    // 다중 레벨 캐시 프로바이더 초기화
    if (this.multiCache) {
      this.cacheProviders.set(CacheManager.MULTI, this.multiCache);
    }

    if (this.cacheProviders.size === 0) {
      this.logger.warn('구성된 캐시 프로바이더가 없습니다.');
    }
  }

  /**
   * 캐시 프로바이더를 조회합니다.
   *
   * @param cacheManager 사용할 캐시 매니저 (REDIS, MEMORY, MULTI)
   * @returns CacheProvider
   */
  get(cacheManager?: CacheManager): CacheProvider {
    const manager = cacheManager ?? this.defaultCacheManager;
    const provider = this.cacheProviders.get(manager);

    if (!provider) {
      throw new Error(`캐시 프로바이더를 찾을 수 없습니다: ${manager}`);
    }

    return provider;
  }
}
