import { EventEmitter } from 'events';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Mutex } from 'async-mutex';
import { LRUCache } from 'lru-cache';

import type { CacheModuleConfig, CompressionConfig } from '../core';
import { CACHE_MODULE_CONFIG, CacheProvider, DEFAULT_CONFIG } from '../core';
import { compressIfNeeded, decompressIfNeeded } from '../util/compression';

@Injectable()
export class InMemoryCache implements CacheProvider {
  private readonly logger = new Logger(InMemoryCache.name);

  private readonly memory: LRUCache<string, string>;

  private readonly activeLocks = new Map<string, number>();

  private readonly mutex = new Mutex();

  private readonly eventEmitter = new EventEmitter();

  private readonly compressionConfig: CompressionConfig;

  constructor(@Inject(CACHE_MODULE_CONFIG) private readonly config: CacheModuleConfig) {
    this.memory = new LRUCache({
      max: this.config?.memory?.max ?? DEFAULT_CONFIG.memory.max,
      ttl: this.config?.memory?.ttl ?? DEFAULT_CONFIG.memory.ttl,
      ttlResolution: 1,
    });
    this.compressionConfig = this.config?.compression ?? {};
  }

  ping(): Promise<string> {
    return Promise.resolve('PONG');
  }

  async tryLock(key: string, expire = 60): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const now = Date.now();

    try {
      return await this.mutex.runExclusive(() => {
        if (this.activeLocks.has(lockKey)) {
          const currentExpiry = this.activeLocks.get(lockKey);
          if (currentExpiry && currentExpiry < now) {
            this.activeLocks.delete(lockKey);
          }
        }

        if (this.activeLocks.has(lockKey)) {
          return false;
        }

        this.activeLocks.set(lockKey, now + expire * 1000);
        return true;
      });
    } catch {
      return false;
    }
  }

  async unlock(key: string): Promise<boolean> {
    const lockKey = `lock:${key}`;

    try {
      return await this.mutex.runExclusive(() => {
        if (this.activeLocks.has(lockKey)) {
          this.activeLocks.delete(lockKey);
          return true;
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const value = this.memory.get(key);

    if (!value) {
      return null;
    }

    try {
      return await decompressIfNeeded<T>(value);
    } catch {
      return value as unknown as T;
    }
  }

  async put(
    key: string,
    value: any,
    ttl?: number,
    compressionOverride?: CompressionConfig,
  ): Promise<void> {
    try {
      const config = compressionOverride ?? this.compressionConfig;
      const { data } = await compressIfNeeded(value, config);

      if (ttl) {
        this.memory.set(key, data, {
          ttl: ttl * 1000,
        });
      } else {
        this.memory.set(key, data);
      }
    } catch (e) {
      this.logger.warn(`Failed to write cache entry`, e);
    }
  }

  clear(): Promise<void> {
    try {
      this.memory.clear();
      this.activeLocks.clear();
    } catch (e) {
      this.logger.warn(`Failed to clear cache`, e);
    }
    return Promise.resolve();
  }

  evict(key: string): Promise<void> {
    try {
      this.memory.delete(key);
    } catch (e) {
      this.logger.warn(`Failed to evict cache entry`, e);
    }
    return Promise.resolve();
  }

  async waitForResult(key: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Pub/Sub timeout (key: ${key}, ${timeoutMs}ms)`));
      }, timeoutMs);

      this.eventEmitter.once(`pending:${key}`, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  notifyResult(key: string): Promise<void> {
    this.eventEmitter.emit(`pending:${key}`);
    return Promise.resolve();
  }

  clearKeysByPattern(pattern: string): Promise<void> {
    try {
      const keysToDelete: string[] = [];

      for (const key of this.memory.keys()) {
        if (key.startsWith(pattern)) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach((key) => this.memory.delete(key));
    } catch (e) {
      this.logger.warn(`Failed to delete cache entries by pattern`, e);
    }
    return Promise.resolve();
  }
}
