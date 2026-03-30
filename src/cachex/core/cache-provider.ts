import type { CompressionConfig } from './types';

export interface CacheProvider {
  /**
   * Checks connectivity by sending a ping to the cache server.
   * @returns 'PONG' or similar response string on success.
   */
  ping(): Promise<string>;

  /**
   * Attempts to acquire a distributed lock for the given key.
   * @param key Key to lock.
   * @param expire Lock expiry in seconds (optional).
   * @returns true if the lock was acquired, false otherwise.
   */
  tryLock(key: string, expire?: number): Promise<boolean>;

  /**
   * Releases the distributed lock for the given key.
   * @param lockKey Lock key to release.
   * @returns true if the lock was released, false otherwise.
   */
  unlock(lockKey: string): Promise<boolean>;

  /**
   * Returns the value mapped to the given key.
   * @param key Cache key.
   * @returns The cached value, or null if not found.
   */
  get<T>(key: any): Promise<T | null>;

  /**
   * Stores the given value under the given key.
   * @param key Cache key.
   * @param value Value to store.
   * @param ttl Expiry in seconds (optional).
   * @param compressionOverride Per-call compression settings (falls back to module-level config).
   */
  put(key: any, value: any, ttl?: number, compressionOverride?: CompressionConfig): Promise<void>;

  /**
   * Removes the entry for the given key, if present.
   * @param key Key to evict.
   */
  evict(key: any): Promise<void>;

  /**
   * Removes all entries from the cache.
   */
  clear(): Promise<void>;

  /**
   * Deletes all keys with the given prefix.
   * @param pattern Key prefix to match (e.g. "users::").
   */
  clearKeysByPattern(pattern: string): Promise<void>;

  /**
   * [Pub/Sub single-flight] Waits for a cache-ready notification on the given key.
   * Used by servers that lost the lock to subscribe instead of polling.
   * Falls back to polling automatically when not implemented.
   * @param key Cache key to wait for.
   * @param timeoutMs Maximum wait time in ms before rejecting.
   */
  waitForResult?(key: string, timeoutMs: number): Promise<void>;

  /**
   * [Pub/Sub single-flight] Publishes a cache-ready notification for the given key.
   * Called by the server that acquired the lock after writing the new value.
   * @param key Cache key that was refreshed.
   */
  notifyResult?(key: string): Promise<void>;
}
