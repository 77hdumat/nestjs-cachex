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
export class SwrCacheModule {
  /**
   * 동기 설정으로 모듈을 등록합니다
   */
  static forRoot(config: CacheModuleConfig): DynamicModule {
    return {
      global: true,
      module: SwrCacheModule,
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

  /**
   * 비동기 설정으로 모듈을 등록합니다
   */
  static forRootAsync(options: CacheModuleAsyncConfig): DynamicModule {
    const providers: Provider[] = [
      {
        provide: CACHE_MODULE_CONFIG,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      ...COMMON_PROVIDERS,
    ];

    // Redis Token Bridge
    if (options.redisToken) {
      providers.push({
        provide: SWR_REDIS_CLIENT,
        useExisting: options.redisToken,
      });
    }

    // Redis Subscriber Token Bridge (Pub/Sub 싱글플라이트용 전용 커넥션)
    if (options.subscriberToken) {
      providers.push({
        provide: SWR_REDIS_SUBSCRIBER,
        useExisting: options.subscriberToken,
      });
    }

    return {
      global: true,
      module: SwrCacheModule,
      imports: [AopModule, ...(options.imports ?? [])],
      providers,
    };
  }
}
