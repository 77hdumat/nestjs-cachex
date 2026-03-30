export { CacheXModule } from './cachex.module';

export { CacheEvict, Cacheable } from './cache.decorators';

// Types
export type {
  CacheModuleConfig,
  CacheModuleAsyncConfig,
  SwrConfig,
  CompressionConfig,
  MultiCacheConfig,
  MemoryCacheConfig,
  DefaultsConfig,
  RedisLike,
} from './core';

export { CacheManager, DEFAULT_CONFIG } from './core';

export type { CacheableOption } from './core';
export type { CacheEvictOption } from './core';
