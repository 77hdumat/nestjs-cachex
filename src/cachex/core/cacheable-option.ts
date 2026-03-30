import type { CacheableNameResolver, CacheKeyResolver, CacheManager } from './types';

export interface CacheableOption {
  /**
   * Logical freshness TTL in seconds (SWR fresh threshold).
   * Can be omitted if defaults.ttl is set at the module level.
   * @example ttl: 60  // fresh for 60 seconds
   */
  ttl?: number;

  /**
   * Additional stale window in seconds after logical expiry.
   * Stale data is served while the cache is refreshed in the background.
   * Falls back to module-level defaultStaleMultiplier × ttl when unset.
   * Physical Redis TTL = ttl + staleTtl.
   * @example staleTtl: 300  // serve stale data for up to 300 s while revalidating
   */
  staleTtl?: number;

  /**
   * Enables or disables SWR for this decorator (overrides module-level swr.enabled).
   * @example swr: false  // use simple cache (no stale-while-revalidate)
   */
  swr?: boolean;

  /**
   * Per-decorator compression settings (overrides module-level compression config).
   * - false: disable compression.
   * - { threshold, level }: custom settings.
   * - unset: inherit module-level config.
   * @example compression: false               // skip compression for small payloads
   * @example compression: { threshold: 1024 } // compress only when > 1 KB
   */
  compression?: boolean | { threshold?: number; level?: number };

  /**
   * Cache manager to use.
   * @default CacheManager.REDIS (or global defaults.cacheManager)
   */
  cacheManager?: CacheManager;

  /**
   * Cache namespace / group name for grouping related entries.
   * When set without key, the cache key is auto-generated from the method name and parameter hash.
   *
   * @example
   * name: 'users'                              // stored as users::ClassName:methodName:hash
   * name: (userId: number) => `user-${userId}` // stored as user-123::ClassName:methodName:hash
   */
  name?: CacheableNameResolver;

  /**
   * Cache key resolver.
   * - String: fixed key.
   * - Function: dynamic key derived from method arguments.
   * - Unset: auto-generated from method name and parameter hash.
   * When set, the final key is 'name::key'.
   *
   * @example
   * key: 'fixed-key'
   * key: (userId: number) => `user-${userId}`
   */
  key?: CacheKeyResolver;

  /**
   * Pre-invocation condition. Cache is read/written only when this returns true.
   * @example condition: (userId: number) => userId > 0
   */
  condition?: (...args: any[]) => boolean;

  /**
   * Post-invocation exclusion. When this returns true, the result is NOT cached.
   * @example unless: (result: User) => result == null
   */
  unless?: (result: any, ...args: any[]) => boolean;
}
