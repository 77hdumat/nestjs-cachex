import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import type {
  CacheableContext,
  CacheableOption,
  CacheEvictContext,
  CacheProvider,
} from '../../core';
import { CACHE_MODULE_CONFIG, CacheEnvelope } from '../../core';
import { CacheOperations } from '../cache-operations';

describe('CacheOperations', () => {
  let cacheOperations: CacheOperations;
  let mockCacheProvider: jest.Mocked<CacheProvider>;
  let mockMethod: jest.Mock;

  const createContext = (key = 'test-key'): CacheableContext => ({
    key,
    method: mockMethod,
    args: ['arg1', 'arg2'],
    cacheProvider: mockCacheProvider,
  });

  const createOption = (ttl = 60, unless?: (result: any) => boolean): CacheableOption => ({
    ttl,
    unless,
  });

  const flushPromises = async () => {
    await new Promise((resolve) => process.nextTick(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => process.nextTick(resolve));
  };

  const flushPromisesAndTimers = async (ms = 1000) => {
    jest.advanceTimersByTime(ms);
    await flushPromises();
  };

  beforeEach(async () => {
    mockCacheProvider = {
      ping: jest.fn(),
      tryLock: jest.fn(),
      unlock: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      evict: jest.fn(),
      clear: jest.fn(),
      clearKeysByPattern: jest.fn(),
    };

    mockMethod = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheOperations,
        {
          provide: CACHE_MODULE_CONFIG,
          useValue: {},
        },
      ],
    }).compile();

    cacheOperations = module.get<CacheOperations>(CacheOperations);

    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('getWithSwr', () => {
    describe('Cache Miss', () => {
      it('should acquire a lock, call the original method, and store the result on cache miss', async () => {
        const context = createContext();
        const option = createOption();
        const expectedResult = { data: 'result' };

        mockCacheProvider.get.mockResolvedValue(null);
        mockCacheProvider.tryLock.mockResolvedValue(true);
        mockMethod.mockResolvedValue(expectedResult);

        const result = await cacheOperations.getWithSwr(context, option);

        expect(result).toEqual(expectedResult);
        expect(mockCacheProvider.get).toHaveBeenCalledWith('test-key');
        expect(mockCacheProvider.tryLock).toHaveBeenCalledWith('test-key');
        expect(mockMethod).toHaveBeenCalled();
        expect(mockCacheProvider.put).toHaveBeenCalled();
        expect(mockCacheProvider.unlock).toHaveBeenCalledWith('test-key');
      });

      it('should poll and return cache data when a concurrent process populates the cache while waiting', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption();
        const cachedData = { data: 'cached-result' };
        const envelope = CacheEnvelope.create(cachedData, option.ttl!);

        // tryLock → false (no pub/sub) → polling fallback
        // poll attempt 0: delay → get(null)
        // poll attempt 1: delay → get(envelope) → cache hit → return
        mockCacheProvider.tryLock.mockResolvedValue(false);

        mockCacheProvider.get
          .mockResolvedValueOnce(null)             // initial getWithSwr check
          .mockResolvedValueOnce(null)             // poll attempt 0
          .mockResolvedValueOnce(envelope.toObject()); // poll attempt 1 → cache hit

        const resultPromise = cacheOperations.getWithSwr(context, option);

        await flushPromisesAndTimers(10000);
        await flushPromisesAndTimers(10000);
        await flushPromisesAndTimers(10000);

        const result = await resultPromise;

        expect(result).toEqual(cachedData);
        expect(mockMethod).not.toHaveBeenCalled();
        expect(mockCacheProvider.tryLock).toHaveBeenCalledTimes(1);
      });

      it('should fall back to calling the original method after exhausting polling attempts (max 10)', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption();
        const expectedResult = { data: 'fallback' };

        mockCacheProvider.get.mockResolvedValue(null);
        mockCacheProvider.tryLock.mockResolvedValue(false);
        mockMethod.mockResolvedValue(expectedResult);

        const resultPromise = cacheOperations.getWithSwr(context, option);

        for (let i = 0; i < 15; i++) {
          await flushPromisesAndTimers(1000);
        }

        const result = await resultPromise;

        expect(result).toEqual(expectedResult);
        expect(mockMethod).toHaveBeenCalled();
        expect(mockCacheProvider.tryLock).toHaveBeenCalledTimes(1);
        expect(mockCacheProvider.put).not.toHaveBeenCalled();
      }, 30000);
    });

    describe('Cache Hit', () => {
      it('should return a fresh cache entry immediately', async () => {
        const context = createContext();
        const option = createOption();
        const cachedData = { data: 'fresh' };
        const envelope = CacheEnvelope.create(cachedData, option.ttl!);

        mockCacheProvider.get.mockResolvedValue(envelope.toObject());

        const result = await cacheOperations.getWithSwr(context, option);

        expect(result).toEqual(cachedData);
        expect(mockMethod).not.toHaveBeenCalled();
        expect(mockCacheProvider.tryLock).not.toHaveBeenCalled();
      });

      it('should return stale data immediately and refresh in the background', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption(1);
        const staleData = { data: 'stale' };
        const freshData = { data: 'fresh' };

        const staleEnvelope = new CacheEnvelope(staleData, Date.now() - 2000, Date.now() - 1000);

        mockCacheProvider.get.mockResolvedValue(staleEnvelope.toObject());
        mockCacheProvider.tryLock.mockResolvedValue(true);
        mockMethod.mockResolvedValue(freshData);

        const result = await cacheOperations.getWithSwr(context, option);
        expect(result).toEqual(staleData);
        expect(mockMethod).not.toHaveBeenCalled();

        // flush microtask/macrotask queues to trigger background refresh
        await flushPromises();

        expect(mockMethod).toHaveBeenCalled();
        expect(mockCacheProvider.put).toHaveBeenCalled();
        expect(mockCacheProvider.unlock).toHaveBeenCalled();
      }, 15000);

      it('should skip background refresh when the lock cannot be acquired', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption();
        const staleEnvelope = new CacheEnvelope(
          { data: 'stale' },
          Date.now() - 2000,
          Date.now() - 1000,
        );

        mockCacheProvider.get.mockResolvedValue(staleEnvelope.toObject());
        mockCacheProvider.tryLock.mockResolvedValue(false);

        await cacheOperations.getWithSwr(context, option);

        await flushPromises();

        expect(mockCacheProvider.put).not.toHaveBeenCalled();
      }, 15000);
    });

    describe('Unless condition', () => {
      it('should not cache the result when unless returns true', async () => {
        const context = createContext();
        const option = createOption(60, (res) => res.error);
        const errorResult = { error: true, msg: 'fail' };

        mockCacheProvider.get.mockResolvedValue(null);
        mockCacheProvider.tryLock.mockResolvedValue(true);
        mockMethod.mockResolvedValue(errorResult);

        const result = await cacheOperations.getWithSwr(context, option);

        expect(result).toEqual(errorResult);
        expect(mockCacheProvider.put).not.toHaveBeenCalled();
        expect(mockCacheProvider.unlock).toHaveBeenCalled();
      });
    });
  });

  describe('bulkEvict', () => {
    it('should call clearKeysByPattern when allEntries is true', async () => {
      const context: CacheEvictContext = {
        keys: ['users:*'],
        cacheProvider: mockCacheProvider,
        allEntries: true,
      };
      await cacheOperations.bulkEvict(context);
      expect(mockCacheProvider.clearKeysByPattern).toHaveBeenCalledWith('users:*');
    });

    it('should call evict per key when allEntries is false', async () => {
      const context: CacheEvictContext = {
        keys: ['k1'],
        cacheProvider: mockCacheProvider,
        allEntries: false,
      };
      await cacheOperations.bulkEvict(context);
      expect(mockCacheProvider.evict).toHaveBeenCalledTimes(1);
    });

    describe('debounceMs', () => {
      beforeEach(() => jest.useFakeTimers());

      it('should collapse multiple calls within the debounce window into one eviction', async () => {
        const context: CacheEvictContext = {
          keys: ['k1'],
          cacheProvider: mockCacheProvider,
          debounceMs: 100,
        };

        void cacheOperations.bulkEvict(context);
        void cacheOperations.bulkEvict(context);
        void cacheOperations.bulkEvict(context);

        expect(mockCacheProvider.evict).not.toHaveBeenCalled();

        jest.advanceTimersByTime(100);
        await Promise.resolve(); // flush microtasks

        expect(mockCacheProvider.evict).toHaveBeenCalledTimes(1);
      });

      it('should evict immediately when debounceMs is not set', async () => {
        const context: CacheEvictContext = { keys: ['k1'], cacheProvider: mockCacheProvider };
        await cacheOperations.bulkEvict(context);
        expect(mockCacheProvider.evict).toHaveBeenCalledTimes(1);
      });

      it('should debounce independently for different key sets', async () => {
        void cacheOperations.bulkEvict({
          keys: ['k1'],
          cacheProvider: mockCacheProvider,
          debounceMs: 100,
        });
        void cacheOperations.bulkEvict({
          keys: ['k2'],
          cacheProvider: mockCacheProvider,
          debounceMs: 100,
        });

        jest.advanceTimersByTime(100);
        await Promise.resolve();

        expect(mockCacheProvider.evict).toHaveBeenCalledTimes(2);
      });

      it('should reset the timer when called again within the window', async () => {
        const context: CacheEvictContext = {
          keys: ['k1'],
          cacheProvider: mockCacheProvider,
          debounceMs: 100,
        };

        void cacheOperations.bulkEvict(context);
        jest.advanceTimersByTime(50);
        void cacheOperations.bulkEvict(context); // resets timer

        jest.advanceTimersByTime(50); // 100ms total elapsed, but timer was reset at 50ms
        expect(mockCacheProvider.evict).not.toHaveBeenCalled();

        jest.advanceTimersByTime(50); // 50ms after reset — timer fires now
        await Promise.resolve();

        expect(mockCacheProvider.evict).toHaveBeenCalledTimes(1);
      });

      it('should clear pending timers on module destroy without executing eviction', () => {
        const context: CacheEvictContext = {
          keys: ['k1'],
          cacheProvider: mockCacheProvider,
          debounceMs: 100,
        };
        void cacheOperations.bulkEvict(context);

        cacheOperations.onModuleDestroy();
        jest.advanceTimersByTime(200);

        expect(mockCacheProvider.evict).not.toHaveBeenCalled();
      });
    });
  });

  it('should increase the wait time exponentially with each retry attempt', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const context = createContext();
    const option = createOption();

    const mockData = { data: 'ok' };
    const envelope = CacheEnvelope.create(mockData, option.ttl!);

    // tryLock → false → polling fallback
    // attempts 0 and 1 return null; attempt 2 returns the envelope
    mockCacheProvider.tryLock.mockResolvedValue(false);
    mockCacheProvider.get
      .mockResolvedValueOnce(null)             // initial getWithSwr check
      .mockResolvedValueOnce(null)             // poll attempt 0
      .mockResolvedValueOnce(null)             // poll attempt 1
      .mockResolvedValue(envelope.toObject()); // poll attempt 2 → cache hit

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const resultPromise = cacheOperations.getWithSwr(context, option);

    await flushPromisesAndTimers();
    await flushPromisesAndTimers();
    await flushPromisesAndTimers();
    await flushPromisesAndTimers();

    await resultPromise;

    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    const call1 = setTimeoutSpy.mock.calls[0][1] as number;
    expect(call1).toBeGreaterThanOrEqual(20); // baseDelayMs = 20
  });

  it('should compute physicalTtl = ttl + staleTtl using the default staleMultiplier of 5', async () => {
    const context = createContext();
    const option = createOption(30); // staleTtl = 30 * 5 = 150, physicalTtl = 30 + 150 = 180
    mockCacheProvider.get.mockResolvedValue(null);
    mockCacheProvider.tryLock.mockResolvedValue(true);
    mockMethod.mockResolvedValue({ data: 'ok' });
    await cacheOperations.getWithSwr(context, option);
    const putArgs = mockCacheProvider.put.mock.calls[0];
    const physicalTtl = putArgs[2];
    expect(physicalTtl).toBeGreaterThanOrEqual(150);
  });

  it('should compute physicalTtl = ttl + explicit staleTtl', async () => {
    const context = createContext();
    const option: CacheableOption = { ttl: 60, staleTtl: 300 }; // physicalTtl = 60 + 300 = 360
    mockCacheProvider.get.mockResolvedValue(null);
    mockCacheProvider.tryLock.mockResolvedValue(true);
    mockMethod.mockResolvedValue({ data: 'ok' });
    await cacheOperations.getWithSwr(context, option);
    const putArgs = mockCacheProvider.put.mock.calls[0];
    const physicalTtl = putArgs[2];
    expect(physicalTtl).toBeGreaterThanOrEqual(360);
    expect(physicalTtl).toBeLessThan(400); // up to 20s jitter
  });

  it('should use simple cache logic when swr is false', async () => {
    const context = createContext();
    const option: CacheableOption = { ttl: 60, swr: false };
    const expectedResult = { data: 'result' };

    mockCacheProvider.get.mockResolvedValue(null);
    mockMethod.mockResolvedValue(expectedResult);

    const result = await cacheOperations.getWithSwr(context, option);

    expect(result).toEqual(expectedResult);
    expect(mockCacheProvider.put).toHaveBeenCalledWith('test-key', expectedResult, 60, undefined);
    expect(mockCacheProvider.tryLock).not.toHaveBeenCalled();
  });

  it('should schedule background refresh only once even when multiple concurrent requests see a stale entry', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    const context = createContext();
    const option = createOption(1);
    const staleEnvelope = new CacheEnvelope(
      { data: 'stale' },
      Date.now() - 2000,
      Date.now() - 1000,
    );

    mockCacheProvider.get.mockResolvedValue(staleEnvelope.toObject());
    mockCacheProvider.tryLock.mockResolvedValue(false);

    await Promise.all([
      cacheOperations.getWithSwr(context, option),
      cacheOperations.getWithSwr(context, option),
      cacheOperations.getWithSwr(context, option),
    ]);

    await flushPromises();

    expect(mockCacheProvider.tryLock).toHaveBeenCalledTimes(1);
  }, 15000);
});
