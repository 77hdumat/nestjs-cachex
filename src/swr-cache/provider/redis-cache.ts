import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type { CacheModuleConfig, CompressionConfig, RedisLike, RedisSubscriberLike } from '../core';
import {
  CACHE_MODULE_CONFIG,
  CacheProvider,
  SWR_REDIS_CLIENT,
  SWR_REDIS_SUBSCRIBER,
} from '../core';
import { compressIfNeeded, decompressIfNeeded } from '../util/compression';

@Injectable()
export class RedisCache implements CacheProvider {
  private readonly logger = new Logger(RedisCache.name);

  private readonly compressionConfig: CompressionConfig;

  constructor(
    @Inject(CACHE_MODULE_CONFIG) config: CacheModuleConfig,
    @Optional()
    @Inject(SWR_REDIS_CLIENT)
    private readonly redis?: RedisLike,
    @Optional()
    @Inject(SWR_REDIS_SUBSCRIBER)
    private readonly subscriber?: RedisSubscriberLike,
  ) {
    this.compressionConfig = config?.compression ?? {};
  }

  async ping(): Promise<string> {
    if (!this.redis) {
      return 'PONG (no redis)';
    }
    return this.redis.ping();
  }

  async tryLock(key: string, expire = 60): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const lockKey = `lock:${key}`;
      const result = await this.redis.set(lockKey, '1', 'EX', expire, 'NX');
      return result === 'OK';
    } catch {
      return false;
    }
  }

  async unlock(key: string): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const lockKey = `lock:${key}`;
      const result = await this.redis.del(lockKey);
      return result === 1;
    } catch {
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const value = await this.redis.get(key);
      if (!value) {
        return null;
      }

      try {
        return await decompressIfNeeded<T>(value);
      } catch {
        return value as unknown as T;
      }
    } catch (e) {
      this.logger.warn(`Redis get error: ${e.message}`);
      return null;
    }
  }

  async put(
    key: string,
    value: any,
    ttl?: number,
    compressionOverride?: CompressionConfig,
  ): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const config = compressionOverride ?? this.compressionConfig;
      const { data } = await compressIfNeeded(value, config);

      if (ttl) {
        await this.redis.set(key, data, 'EX', ttl);
      } else {
        await this.redis.set(key, data);
      }
    } catch (e) {
      this.logger.warn(`캐시 수정 실패`, e);
    }
  }

  async clear(): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.clearKeysByPattern('*');
    } catch (e) {
      this.logger.warn(`캐시 초기화 실패`, e);
    }
  }

  async evict(key: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(key);
    } catch (e) {
      this.logger.warn(`캐시 삭제 실패`, e);
    }
  }

  async waitForResult(key: string, timeoutMs: number): Promise<void> {
    if (!this.subscriber) {
      return Promise.reject(new Error('subscriber 커넥션이 설정되지 않았습니다'));
    }

    const channel = `pending:${key}`;

    return new Promise<void>((resolve, reject) => {
      // handler와 timer가 서로를 참조하는 순환 클로저.
      // ref 객체를 사용해 const 선언을 유지하면서 나중에 timer를 할당 가능하도록 함
      const timerRef: { current: ReturnType<typeof setTimeout> | undefined } = {
        current: undefined,
      };

      const handler = (ch: string) => {
        if (ch === channel) {
          clearTimeout(timerRef.current);
          this.subscriber!.off('message', handler);
          this.subscriber!.unsubscribe(channel).catch(() => {});
          resolve();
        }
      };

      timerRef.current = setTimeout(() => {
        this.subscriber!.off('message', handler);
        this.subscriber!.unsubscribe(channel).catch(() => {});
        reject(new Error(`Pub/Sub 타임아웃 (키: ${key}, ${timeoutMs}ms)`));
      }, timeoutMs);

      this.subscriber!.on('message', handler);
      this.subscriber!.subscribe(channel).catch((err: unknown) => {
        clearTimeout(timerRef.current);
        this.subscriber!.off('message', handler);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async notifyResult(key: string): Promise<void> {
    if (!this.redis?.publish) {
      return;
    }
    try {
      await this.redis.publish(`pending:${key}`, '1');
    } catch (err) {
      this.logger.debug(`Pub/Sub 알림 실패 (키: ${key})`, err);
    }
  }

  async clearKeysByPattern(pattern: string): Promise<void> {
    const { redis } = this;
    if (!redis) {
      return;
    }

    try {
      await this.scanAndDelete(redis, '0', pattern, 100);
    } catch {
      this.logger.warn(`캐시 패턴 삭제 실패`);
    }
  }

  private async scanAndDelete(
    redis: RedisLike,
    cursor: string,
    pattern: string,
    batchSize: number,
  ): Promise<void> {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${pattern}*`, 'COUNT', batchSize);

    if (keys.length > 0) {
      await Promise.all(keys.map((key) => redis.unlink(key)));
    }
    
    if (nextCursor !== '0') {
      await this.scanAndDelete(redis, nextCursor, pattern, batchSize);
    }
  }
}
