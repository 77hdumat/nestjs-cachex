import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { CacheProvider } from '../core/cache-provider';
import type { CacheModuleConfig } from '../core/types';
import { CACHE_MODULE_CONFIG, CacheManager } from '../core/types';
import { InMemoryCache } from '../provider/memory-cache';
import { MultiCache } from '../provider/multi-cache';
import { RedisCache } from '../provider/redis-cache';

/**
 * Resolves the appropriate CacheProvider by CacheManager type.
 * Supports REDIS (single-level), MEMORY (single-level), and MULTI (L1 memory + L2 Redis).
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

    if (this.multiCache) {
      this.cacheProviders.set(CacheManager.MULTI, this.multiCache);
    }

    if (this.cacheProviders.size === 0) {
      this.logger.warn('No cache providers configured.');
    }
  }

  get(cacheManager?: CacheManager): CacheProvider {
    const manager = cacheManager ?? this.defaultCacheManager;
    const provider = this.cacheProviders.get(manager);

    if (!provider) {
      throw new Error(`No cache provider found for manager: ${manager}`);
    }

    return provider;
  }
}
