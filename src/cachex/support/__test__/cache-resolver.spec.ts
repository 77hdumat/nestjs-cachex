import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { CACHE_MODULE_CONFIG, CacheManager } from '../../core/types';
import { InMemoryCache } from '../../provider/memory-cache';
import { MultiCache } from '../../provider/multi-cache';
import { RedisCache } from '../../provider/redis-cache';
import { CacheResolver } from '../cache-resolver';

describe('CacheResolver', () => {
  let cacheResolver: CacheResolver;
  let mockRedisCache: RedisCache;
  let mockInMemoryCache: InMemoryCache;
  let mockMultiCache: MultiCache;
  let mockLoggerWarn: jest.SpyInstance;

  const createMockCacheProvider = () => ({
    get: jest.fn(),
    put: jest.fn(),
    evict: jest.fn(),
  });

  describe('when all providers are injected', () => {
    beforeEach(async () => {
      mockRedisCache = createMockCacheProvider() as any;
      mockInMemoryCache = createMockCacheProvider() as any;
      mockMultiCache = createMockCacheProvider() as any;

      mockLoggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CacheResolver,
          { provide: CACHE_MODULE_CONFIG, useValue: {} },
          { provide: RedisCache, useValue: mockRedisCache },
          { provide: InMemoryCache, useValue: mockInMemoryCache },
          { provide: MultiCache, useValue: mockMultiCache },
        ],
      }).compile();

      cacheResolver = module.get<CacheResolver>(CacheResolver);

      // manually invoke onModuleInit (TestingModule does not auto-run lifecycle hooks in unit tests)
      await cacheResolver.onModuleInit();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('onModuleInit', () => {
      it('should register all injected cache providers', () => {
        // verify indirectly via get() since the internal map is private
        expect(cacheResolver.get(CacheManager.REDIS)).toBe(mockRedisCache);
        expect(cacheResolver.get(CacheManager.MEMORY)).toBe(mockInMemoryCache);
        expect(cacheResolver.get(CacheManager.MULTI)).toBe(mockMultiCache);
      });

      it('should not log a warning when providers are present', () => {
        expect(mockLoggerWarn).not.toHaveBeenCalled();
      });
    });

    describe('get', () => {
      it('should return RedisCache for CacheManager.REDIS', () => {
        const result = cacheResolver.get(CacheManager.REDIS);
        expect(result).toBe(mockRedisCache);
      });

      it('should return InMemoryCache for CacheManager.MEMORY', () => {
        const result = cacheResolver.get(CacheManager.MEMORY);
        expect(result).toBe(mockInMemoryCache);
      });

      it('should return MultiCache for CacheManager.MULTI', () => {
        const result = cacheResolver.get(CacheManager.MULTI);
        expect(result).toBe(mockMultiCache);
      });

      it('should return RedisCache by default when called without arguments', () => {
        const result = cacheResolver.get();
        expect(result).toBe(mockRedisCache);
      });
    });
  });

  describe('when only some providers are injected', () => {
    beforeEach(async () => {
      mockInMemoryCache = createMockCacheProvider() as any;
      mockLoggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CacheResolver,
          { provide: CACHE_MODULE_CONFIG, useValue: {} },
          { provide: InMemoryCache, useValue: mockInMemoryCache },
        ],
      }).compile();

      cacheResolver = module.get<CacheResolver>(CacheResolver);
      await cacheResolver.onModuleInit();
    });

    it('should return InMemoryCache when requested', () => {
      expect(cacheResolver.get(CacheManager.MEMORY)).toBe(mockInMemoryCache);
    });

    it('should throw when requesting an unregistered provider', () => {
      expect(() => cacheResolver.get(CacheManager.REDIS)).toThrow(
        `No cache provider found for manager: ${CacheManager.REDIS}`,
      );
    });

    it('should throw for the default (REDIS) provider when it is not registered', () => {
      expect(() => cacheResolver.get()).toThrow(
        `No cache provider found for manager: ${CacheManager.REDIS}`,
      );
    });
  });

  describe('when no providers are injected', () => {
    beforeEach(async () => {
      mockLoggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const module: TestingModule = await Test.createTestingModule({
        providers: [CacheResolver, { provide: CACHE_MODULE_CONFIG, useValue: {} }],
      }).compile();

      cacheResolver = module.get<CacheResolver>(CacheResolver);
      await cacheResolver.onModuleInit();
    });

    it('should log a warning on initialization', () => {
      expect(mockLoggerWarn).toHaveBeenCalledWith('No cache providers configured.');
    });

    it('should throw for any requested provider', () => {
      expect(() => cacheResolver.get(CacheManager.MEMORY)).toThrow();
      expect(() => cacheResolver.get(CacheManager.REDIS)).toThrow();
      expect(() => cacheResolver.get(CacheManager.MULTI)).toThrow();
    });
  });
});
