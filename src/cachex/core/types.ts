import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';

import type { CacheProvider } from './cache-provider';

export enum CacheManager {
  REDIS = 'REDIS',
  MEMORY = 'MEMORY',
  MULTI = 'MULTI',
}

export type CacheableNameResolver = string | ((...args: any[]) => string);
export type CacheEvictNameResolver = string | string[] | ((...args: any[]) => string | string[]);
export type CacheKeyResolver = string | ((...args: any[]) => string);

export type CacheableContext = {
  readonly key: string;
  readonly method: (...args: unknown[]) => unknown;
  readonly args: unknown[];
  readonly cacheProvider: CacheProvider;
};

export type CacheEvictContext = {
  keys: string[];
  cacheProvider: CacheProvider;
  allEntries?: boolean;
  debounceMs?: number;
};

export type CacheKeyContext = {
  target: any;
  methodName: string;
  args: any[];
};

export type CacheOperationContext = {
  method: (...args: any[]) => any;
  instance: any;
  methodName: string;
  args: any[];
};

export const CACHE_MODULE_CONFIG = 'CACHE_MODULE_CONFIG';
export const SWR_REDIS_CLIENT = Symbol('SWR_REDIS_CLIENT');
export const SWR_REDIS_SUBSCRIBER = Symbol('SWR_REDIS_SUBSCRIBER');

/**
 * Minimal Redis client interface.
 * Compatible with ioredis, node-redis, or any client implementing these methods.
 */
export interface RedisLike {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  scan(
    cursor: string | number,
    ...args: (string | number)[]
  ): Promise<[cursor: string, keys: string[]]>;
  unlink(...keys: string[]): Promise<number>;
  /**
   * Publishes a message to a channel (optional).
   * Required for Pub/Sub single-flight. notifyResult is a no-op when absent.
   */
  publish?(channel: string, message: string): Promise<number>;
}

/**
 * Dedicated Redis subscriber connection interface.
 * ioredis enters subscribe-only mode after SUBSCRIBE, blocking regular commands —
 * a separate connection must be provided.
 */
export interface RedisSubscriberLike {
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  on(event: 'message', listener: (channel: string, message: string) => void): this;
  off(event: 'message', listener: (channel: string, message: string) => void): this;
}

export interface SwrConfig {
  /**
   * Enables stale-while-revalidate.
   * @default true
   */
  enabled?: boolean;

  /**
   * Multiplier applied to ttl when staleTtl is not explicitly set.
   * physicalTtl = ttl + ttl * defaultStaleMultiplier
   * @default 5
   */
  defaultStaleMultiplier?: number;

  /**
   * Maximum time in ms to wait for a Pub/Sub cache-ready event before falling back to polling.
   * @default 2000
   */
  pubSubTimeoutMs?: number;
}

export interface CompressionConfig {
  enabled?: boolean;
  threshold?: number;
  level?: number;
}

export interface MultiCacheConfig {
  l1MaxTtl?: number;
  l2DefaultTtl?: number;
  writeBackTtl?: number;
}

export interface MemoryCacheConfig {
  max?: number;
  ttl?: number;
}

export interface DefaultsConfig {
  ttl?: number;
  cacheManager?: CacheManager;
}

export const DEFAULT_CONFIG = {
  memory: {
    max: 1000,
    ttl: 3600000,
  },
  multi: {
    l1MaxTtl: 300,
    l2DefaultTtl: 60,
    writeBackTtl: 60,
  },
  compression: {
    enabled: true,
    threshold: 20 * 1024,
    level: 3,
  },
  swr: {
    enabled: true,
    defaultStaleMultiplier: 5,
    maxAttempts: 10,
    baseDelayMs: 20,
    maxDelayMs: 200,
    jitterMs: 10,
    pubSubTimeoutMs: 2000,
  },
} as const;

export interface CacheModuleConfig {
  defaults?: DefaultsConfig;
  memory?: MemoryCacheConfig;
  multi?: MultiCacheConfig;
  compression?: CompressionConfig;
  swr?: SwrConfig;
}

export interface CacheModuleAsyncConfig extends Pick<ModuleMetadata, 'imports'> {
  redisToken?: InjectionToken;
  /**
   * Dedicated Redis connection for SUBSCRIBE.
   * ioredis cannot run regular commands after SUBSCRIBE — provide a separate connection.
   * When omitted, Pub/Sub is disabled and polling is used instead.
   * @example
   * subscriberToken: REDIS_SUBSCRIBER // { provide: REDIS_SUBSCRIBER, useFactory: () => new Redis() }
   */
  subscriberToken?: InjectionToken;
  inject?: InjectionToken[] | OptionalFactoryDependency[];
  useFactory: (...args: any[]) => Promise<CacheModuleConfig> | CacheModuleConfig;
}
