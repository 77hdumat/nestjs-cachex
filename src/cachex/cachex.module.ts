import { DynamicModule, Module, Provider } from '@nestjs/common';
import { AopModule } from '@toss/nestjs-aop';

import { CacheEvict } from './cache-evict.aspect';
import { Cacheable } from './cacheable.aspect';
import {
  CACHE_MODULE_CONFIG,
  CacheModuleAsyncConfig,
  CacheModuleConfig,
  SWR_REDIS_CLIENT,
  SWR_REDIS_SUBSCRIBER,
} from './core';
import { InMemoryCache, MultiCache, RedisCache } from './provider';
import { CacheAspectSupport, CacheKeyGenerator, CacheOperations, CacheResolver } from './support';

const COMMON_PROVIDERS: Provider[] = [
  InMemoryCache,
  RedisCache,
  MultiCache,
  CacheResolver,
  CacheAspectSupport,
  CacheKeyGenerator,
  CacheOperations,
  Cacheable,
  CacheEvict,
];

@Module({})
export class CacheXModule {
  /** Registers the module with synchronous configuration. */
  static forRoot(config: CacheModuleConfig): DynamicModule {
    return {
      global: true,
      module: CacheXModule,
      imports: [AopModule],
      providers: [
        {
          provide: CACHE_MODULE_CONFIG,
          useValue: config,
        },
        ...COMMON_PROVIDERS,
      ],
    };
  }

  /** Registers the module with asynchronous configuration. */
  static forRootAsync(options: CacheModuleAsyncConfig): DynamicModule {
    const providers: Provider[] = [
      {
        provide: CACHE_MODULE_CONFIG,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      ...COMMON_PROVIDERS,
    ];

    // Bridge external Redis client token to the internal injection token
    if (options.redisToken) {
      providers.push({
        provide: SWR_REDIS_CLIENT,
        useExisting: options.redisToken,
      });
    }

    // Bridge external subscriber token (dedicated connection required for SUBSCRIBE mode)
    if (options.subscriberToken) {
      providers.push({
        provide: SWR_REDIS_SUBSCRIBER,
        useExisting: options.subscriberToken,
      });
    }

    return {
      global: true,
      module: CacheXModule,
      imports: [AopModule, ...(options.imports ?? [])],
      providers,
    };
  }
}
