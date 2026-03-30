import { createDecorator } from '@toss/nestjs-aop';

import type { CacheEvictOption } from './core/cache-evict-option';
import type { CacheableOption } from './core/cacheable-option';

export const CACHEABLE = Symbol('Cacheable');
export const Cacheable = (option: CacheableOption) => createDecorator(CACHEABLE, option);

export const CACHE_EVICT = Symbol('CacheEvict');
export const CacheEvict = (option: CacheEvictOption) => createDecorator(CACHE_EVICT, option);
