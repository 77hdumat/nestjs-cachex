import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import type { CacheableOption, CacheEvictOption, CacheOperationContext } from '../../core';
import { CacheManager } from '../../core';
import { CacheAspectSupport } from '../cache-aspect-support';
import { CacheKeyGenerator } from '../cache-key-generator';
import { CacheOperations } from '../cache-operations';
import { CacheResolver } from '../cache-resolver';

describe('CacheAspectSupport', () => {
  let aspectSupport: CacheAspectSupport;
  let mockCacheResolver: jest.Mocked<CacheResolver>;
  let mockCacheKeyGenerator: jest.Mocked<CacheKeyGenerator>;
  let mockCacheOperations: jest.Mocked<CacheOperations>;
  let mockCacheProvider: any;

  const createParams = (
    methodName = 'testMethod',
    args: any[] = ['arg1'],
  ): CacheOperationContext => ({
    instance: {},
    method: jest.fn().mockResolvedValue('original-result'),
    methodName,
    args,
  });

  beforeEach(async () => {
    mockCacheProvider = { name: 'MockProvider' };

    mockCacheResolver = {
      get: jest.fn().mockReturnValue(mockCacheProvider),
    } as any;

    mockCacheKeyGenerator = {
      generateCacheableKey: jest.fn().mockReturnValue('generated-key'),
      generateEvictKeys: jest.fn().mockReturnValue(['generated-key']),
    } as any;

    mockCacheOperations = {
      getWithSwr: jest.fn().mockResolvedValue('cached-result'),
      bulkEvict: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheAspectSupport,
        { provide: CacheResolver, useValue: mockCacheResolver },
        { provide: CacheKeyGenerator, useValue: mockCacheKeyGenerator },
        { provide: CacheOperations, useValue: mockCacheOperations },
      ],
    }).compile();

    aspectSupport = module.get<CacheAspectSupport>(CacheAspectSupport);
  });

  describe('executeCacheable', () => {
    it('should skip cache logic and call the original method when condition returns false', async () => {
      const option: CacheableOption = {
        ttl: 60,
        condition: (arg) => arg === 'valid',
      };
      const params = createParams('test', ['invalid']);

      const result = await aspectSupport.executeCacheable(option, params);

      expect(result).toBe('original-result');
      expect(params.method).toHaveBeenCalledWith('invalid');
      expect(mockCacheOperations.getWithSwr).not.toHaveBeenCalled();
    });

    it('should execute cache operations when condition returns true', async () => {
      const option: CacheableOption = {
        ttl: 60,
        condition: (arg) => arg === 'valid',
      };
      const params = createParams('test', ['valid']);

      const result = await aspectSupport.executeCacheable(option, params);

      expect(result).toBe('cached-result');
      expect(mockCacheOperations.getWithSwr).toHaveBeenCalled();
    });

    it('should generate a key using CacheKeyGenerator.generateCacheableKey', async () => {
      const option: CacheableOption = { ttl: 60 };
      const params = createParams();

      await aspectSupport.executeCacheable(option, params);

      expect(mockCacheKeyGenerator.generateCacheableKey).toHaveBeenCalledWith(
        option,
        expect.objectContaining({
          target: params.instance,
          methodName: params.methodName,
          args: params.args,
        }),
      );
      expect(mockCacheOperations.getWithSwr).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'generated-key' }),
        option,
      );
    });

    it('should resolve the specified CacheManager from CacheResolver', async () => {
      const option: CacheableOption = {
        ttl: 60,
        cacheManager: CacheManager.REDIS,
      };
      const params = createParams();

      await aspectSupport.executeCacheable(option, params);

      expect(mockCacheResolver.get).toHaveBeenCalledWith(CacheManager.REDIS);
      expect(mockCacheOperations.getWithSwr).toHaveBeenCalledWith(
        expect.objectContaining({ cacheProvider: mockCacheProvider }),
        option,
      );
    });
  });

  describe('executeCacheEvict', () => {
    it('should skip eviction when condition returns false', async () => {
      const option: CacheEvictOption = {
        condition: () => false,
      };
      const params = createParams();

      const result = await aspectSupport.executeCacheEvict(option, params);

      expect(result).toBe('original-result');
      expect(mockCacheOperations.bulkEvict).not.toHaveBeenCalled();
    });

    it('should evict the cache after the original method executes', async () => {
      const option: CacheEvictOption = {};
      const params = createParams();

      await aspectSupport.executeCacheEvict(option, params);

      // verify order: method call → eviction
      expect(params.method).toHaveBeenCalled();
      expect(mockCacheOperations.bulkEvict).toHaveBeenCalled();
    });

    it('should generate keys using CacheKeyGenerator.generateEvictKeys', async () => {
      const option: CacheEvictOption = {
        name: 'users',
      };
      const params = createParams('test', ['user-1']);
      mockCacheKeyGenerator.generateEvictKeys.mockReturnValue(['users::generated-key']);

      await aspectSupport.executeCacheEvict(option, params);

      expect(mockCacheKeyGenerator.generateEvictKeys).toHaveBeenCalledWith(
        option,
        expect.objectContaining({
          target: params.instance,
          methodName: params.methodName,
          args: params.args,
        }),
      );
      expect(mockCacheOperations.bulkEvict).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: ['users::generated-key'],
        }),
      );
    });

    it('should evict before the original method executes when beforeInvocation is true', async () => {
      const option: CacheEvictOption = {
        beforeInvocation: true,
      };
      const params = createParams();

      // override mock implementations to capture execution order
      const executionOrder: string[] = [];
      mockCacheOperations.bulkEvict.mockImplementation(async () => {
        executionOrder.push('evict');
      });

      (params.method as jest.Mock).mockImplementation(async () => {
        executionOrder.push('method');
        return 'result';
      });

      await aspectSupport.executeCacheEvict(option, params);

      expect(executionOrder).toEqual(['evict', 'method']);
    });

    it('should pass the allEntries option in the evict context', async () => {
      const option: CacheEvictOption = {
        name: 'products',
        allEntries: true,
      };
      const params = createParams();
      mockCacheKeyGenerator.generateEvictKeys.mockReturnValue(['products::']);

      await aspectSupport.executeCacheEvict(option, params);

      expect(mockCacheOperations.bulkEvict).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: ['products::'],
          allEntries: true,
        }),
      );
    });
  });
});
