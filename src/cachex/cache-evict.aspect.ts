import { Injectable } from '@nestjs/common';
import { Aspect, LazyDecorator, WrapParams } from '@toss/nestjs-aop';

import { CACHE_EVICT } from './cache.decorators';
import { CacheEvictOption } from './core';
import { CacheAspectSupport } from './support';

@Aspect(CACHE_EVICT)
@Injectable()
export class CacheEvict implements LazyDecorator<any, CacheEvictOption> {
  constructor(private readonly cacheAspectSupport: CacheAspectSupport) {}

  wrap({ method, metadata, methodName, instance }: WrapParams<any, CacheEvictOption>) {
    return async (...args: any[]) =>
      this.cacheAspectSupport.executeCacheEvict(metadata, {
        method,
        instance,
        methodName,
        args,
      });
  }
}
