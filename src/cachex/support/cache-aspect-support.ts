import { Injectable } from '@nestjs/common';

import type {
  CacheableContext,
  CacheableOption,
  CacheEvictContext,
  CacheEvictOption,
  CacheKeyContext,
  CacheOperationContext,
} from '../core';

import { CacheKeyGenerator } from './cache-key-generator';
import { CacheOperations } from './cache-operations';
import { CacheResolver } from './cache-resolver';

@Injectable()
export class CacheAspectSupport {
  constructor(
    private readonly cacheResolver: CacheResolver,
    private readonly cacheKeyGenerator: CacheKeyGenerator,
    private readonly cacheOperations: CacheOperations,
  ) {}

  async executeCacheable(option: CacheableOption, params: CacheOperationContext): Promise<any> {
    const { method, instance, methodName, args } = params;

    if (option.condition && !option.condition(...args)) {
      return method(...args);
    }

    const keyContext: CacheKeyContext = { target: instance, methodName, args };
    const key = this.cacheKeyGenerator.generateCacheableKey(option, keyContext);
    const cacheProvider = this.cacheResolver.get(option.cacheManager);

    const context: CacheableContext = {
      key,
      method,
      args,
      cacheProvider,
    };

    return this.cacheOperations.getWithSwr(context, option);
  }

  async executeCacheEvict(option: CacheEvictOption, params: CacheOperationContext): Promise<any> {
    const { method, instance, methodName, args } = params;

    if (option.condition && !option.condition(...args)) {
      return method(...args);
    }

    const keyContext: CacheKeyContext = { target: instance, methodName, args };
    const keys = this.cacheKeyGenerator.generateEvictKeys(option, keyContext);
    const cacheProvider = this.cacheResolver.get(option.cacheManager);

    const context: CacheEvictContext = {
      keys,
      cacheProvider,
      allEntries: option.allEntries,
      debounceMs: option.debounceMs,
    };

    if (option.beforeInvocation) {
      await this.cacheOperations.bulkEvict(context);
      return method(...args);
    }

    const result = await method(...args);
    await this.cacheOperations.bulkEvict(context);
    return result;
  }
}
