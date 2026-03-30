import type { CacheEvictNameResolver, CacheKeyResolver, CacheManager } from './types';

export interface CacheEvictOption {
  /**
   * Cache manager to use.
   * @default CacheManager.REDIS
   */
  cacheManager?: CacheManager;

  /**
   * Cache namespace / group name.
   * - allEntries: true — all keys under this namespace are deleted.
   * - allEntries: false, no key — deletes the specific key derived from the method name and parameters.
   * - String: fixed namespace.
   * - Array: multiple namespaces.
   * - Function: dynamic namespace derived from method arguments.
   *
   * When name is set without key, the cache key is auto-generated from the method name and parameter hash.
   *
   * @example
   * name: 'users'                            // deletes users::ClassName:methodName:hash
   * name: ['users', 'profiles']
   * name: (userId: number) => `user-${userId}`
   */
  name?: CacheEvictNameResolver;

  /**
   * Cache key to evict.
   * Ignored when allEntries is true.
   * When set, the final key becomes 'name::key'.
   *
   * @example
   * key: 'fixed-key'
   * key: (userId: number) => `user-${userId}`
   */
  key?: CacheKeyResolver;

  /**
   * Eviction condition evaluated before method execution.
   * Eviction only occurs when this returns true.
   * @example condition: (userId: number) => userId > 0
   */
  condition?: (...args: any[]) => boolean;

  /**
   * Whether to delete all entries under the namespace.
   * true: deletes all keys matching the name pattern (key is ignored).
   * false: deletes only the specific key.
   * @default false
   */
  allEntries?: boolean;

  /**
   * Whether to evict before the method executes.
   * true: evicts before execution (even if the method throws).
   * false: evicts after successful execution only.
   * @default false
   */
  beforeInvocation?: boolean;

  /**
   * Debounce delay in milliseconds.
   * Multiple evict calls targeting the same key(s) within this window
   * are collapsed into a single eviction executed at the end of the window.
   *
   * Note: when used with `beforeInvocation: true`, the method runs immediately
   * but the actual eviction is still deferred by `debounceMs`.
   *
   * @default undefined (disabled — eviction is immediate)
   * @example debounceMs: 3000  // coalesce bursts within 3 seconds
   */
  debounceMs?: number;
}
