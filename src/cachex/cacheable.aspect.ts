import { Injectable } from '@nestjs/common';
import { Aspect, LazyDecorator, WrapParams } from '@toss/nestjs-aop';

import { CACHEABLE } from './cache.decorators';
import { CacheableOption } from './core';
import { CacheAspectSupport } from './support';

@Aspect(CACHEABLE)
@Injectable()
export class Cacheable implements LazyDecorator<any, CacheableOption> {
  constructor(private readonly cacheAspectSupport: CacheAspectSupport) {}

  wrap({ metadata, method, instance, methodName }: WrapParams<any, CacheableOption>) {
    return async (...args: any[]) =>
      this.cacheAspectSupport.executeCacheable(metadata, {
        method,
        instance,
        methodName,
        args,
      });
  }
}
