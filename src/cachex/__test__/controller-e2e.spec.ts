import { INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import supertest from 'supertest';

import { CacheXModule } from '../cachex.module';

import { TestController } from './fixture/test.controller';

describe('Controller E2E Tests', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let server: supertest.SuperTest<supertest.Test>;

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TestModule,
        CacheXModule.forRootAsync({
          useFactory: () => ({
            defaults: {
              ttl: 1000 * 60,
            },
            memory: {
              max: 100,
            },
          }),
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    server = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await server.post('/api/test/stats/reset').expect(201);
    await server.delete('/api/test/evict-multiple-namespaces').expect(200);
  });

  describe('@Cacheable', () => {
    describe('basic caching behavior', () => {
      it('should return the cached value on subsequent identical requests', async () => {
        const res1 = await server.get('/api/test/explicit-key-basic/1').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/explicit-key-basic/1').expect(200);
        expect(res2.body.executionCount).toBe(1);
        expect(res2.body.timestamp).toBe(res1.body.timestamp);
      });

      it('should store separate cache entries for different parameters', async () => {
        const res1 = await server.get('/api/test/explicit-key-basic/2').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/explicit-key-basic/3').expect(200);
        expect(res2.body.executionCount).toBe(1);
      });
    });

    describe('multi-parameter caching', () => {
      it('should apply the cache only when all parameters match', async () => {
        const res1 = await server
          .get('/api/test/multi-param-key?category=electronics&page=1')
          .expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server
          .get('/api/test/multi-param-key?category=electronics&page=1')
          .expect(200);
        expect(res2.body.executionCount).toBe(1);

        const res3 = await server
          .get('/api/test/multi-param-key?category=books&page=1')
          .expect(200);
        expect(res3.body.executionCount).toBe(1);
      });
    });

    describe('conditional caching', () => {
      it('should not cache the result when unless condition matches (error present)', async () => {
        const res1 = await server.get('/api/test/conditional-cache/-1').expect(200);
        expect(res1.body.error).toBeDefined();
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/conditional-cache/-1').expect(200);
        expect(res2.body.executionCount).toBe(2);
      });

      it('should cache only when condition is satisfied (id > 0)', async () => {
        // id > 0: cached
        const res1 = await server.get('/api/test/conditional-cache/5').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/conditional-cache/5').expect(200);
        expect(res2.body.executionCount).toBe(1);

        // id <= 0: not cached
        const res3 = await server.get('/api/test/conditional-cache/0').expect(200);
        expect(res3.body.executionCount).toBe(1);

        const res4 = await server.get('/api/test/conditional-cache/0').expect(200);
        expect(res4.body.executionCount).toBe(2);
      });
    });

    describe('auto key hashing', () => {
      it('should auto-generate a cache key by hashing parameters when no key is specified', async () => {
        const id = 'abc';
        const q = 'search';
        const body = { user: 'test' };

        // first request: executes and caches
        const res1 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
          .send(body)
          .expect(201);
        expect(res1.body.executionCount).toBe(1);

        // same parameters: returns from cache
        const res2 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
          .send(body)
          .expect(201);
        expect(res2.body.executionCount).toBe(1);

        // different query param: new cache entry
        const res3 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=search2`)
          .send(body)
          .expect(201);
        expect(res3.body.executionCount).toBe(1);

        // different body: new cache entry
        const res4 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
          .send({ user: 'test2' })
          .expect(201);
        expect(res4.body.executionCount).toBe(1);

        // different path param: new cache entry
        const res5 = await server
          .post(`/api/test/auto-hashed-cache/def?q=${q}`)
          .send(body)
          .expect(201);
        expect(res5.body.executionCount).toBe(1);

        const stats = await server.get('/api/test/stats/execution-count').expect(200);
        expect(stats.body['getCacheableWithAutoHash-abc-search-{"user":"test"}']).toBe(1);
        expect(stats.body['getCacheableWithAutoHash-abc-search2-{"user":"test"}']).toBe(1);
        expect(stats.body['getCacheableWithAutoHash-abc-search-{"user":"test2"}']).toBe(1);
        expect(stats.body['getCacheableWithAutoHash-def-search-{"user":"test"}']).toBe(1);
      });
    });
  });

  describe('@CacheEvict', () => {
    describe('eviction with explicit key', () => {
      it('should evict only the cache entry for the specified key', async () => {
        const res1 = await server.get('/api/test/explicit-key-basic/10').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/explicit-key-basic/10').expect(200);
        expect(res2.body.executionCount).toBe(1);

        await server.post('/api/test/evict-explicit-key/10').send({ name: 'Updated' }).expect(201);

        const res3 = await server.get('/api/test/explicit-key-basic/10').expect(200);
        expect(res3.body.executionCount).toBe(2);
      });

      it('should allow eviction from a different method sharing the same key strategy', async () => {
        const res1 = await server.get('/api/test/shared-key-cache/test').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/shared-key-cache/test').expect(200);
        expect(res2.body.executionCount).toBe(1);

        await server.post('/api/test/shared-key-evict/test').send({ data: 'update' }).expect(201);

        const res3 = await server.get('/api/test/shared-key-cache/test').expect(200);
        expect(res3.body.executionCount).toBe(2);
      });
    });

    describe('conditional eviction', () => {
      it('should evict before method execution when beforeInvocation is true', async () => {
        await server.get('/api/test/multi-param-key?category=test').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=test').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // even if the method throws, beforeInvocation evicts the cache first
        await server.delete('/api/test/conditional-evict-all/all').expect(500);

        const res2 = await server.get('/api/test/multi-param-key?category=test').expect(200);
        expect(res2.body.executionCount).toBe(2);
      });

      it('should evict only when condition is satisfied', async () => {
        await server.get('/api/test/multi-param-key?category=test2').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=test2').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // condition not satisfied (id !== 'all'): no eviction
        await server.delete('/api/test/conditional-evict-all/not-all').expect(500);

        const res2 = await server.get('/api/test/multi-param-key?category=test2').expect(200);
        expect(res2.body.executionCount).toBe(1);
      });
    });

    it('should not evict when key strategies differ (auto-hash includes method name — intended behavior)', async () => {
      const id = 'problem-1';
      const q = 'search';
      const body = { data: 'test' };

      const res1 = await server
        .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
        .send(body)
        .expect(201);
      expect(res1.body.executionCount).toBe(1);

      const res2 = await server
        .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
        .send(body)
        .expect(201);
      expect(res2.body.executionCount).toBe(1);

      await server.delete(`/api/test/auto-hashed-evict/${id}?q=${q}`).send(body).expect(200);

      // key includes method name, so the evict key differs from the cache key
      const res3 = await server
        .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
        .send(body)
        .expect(201);
      expect(res3.body.executionCount).toBe(1);
    });

    it('should evict multiple namespaces at once', async () => {
      await server.get('/api/test/explicit-key-basic/multi-1').expect(200);
      await server.get('/api/test/multi-param-key?category=multi').expect(200);
      await server.get('/api/test/conditional-cache/100').expect(200);
      await server.get('/api/test/shared-key-cache/multi-2').expect(200);

      const res1 = await server.get('/api/test/explicit-key-basic/multi-1').expect(200);
      const res2 = await server.get('/api/test/multi-param-key?category=multi').expect(200);
      const res3 = await server.get('/api/test/conditional-cache/100').expect(200);
      const res4 = await server.get('/api/test/shared-key-cache/multi-2').expect(200);

      expect(res1.body.executionCount).toBe(1);
      expect(res2.body.executionCount).toBe(1);
      expect(res3.body.executionCount).toBe(1);
      expect(res4.body.executionCount).toBe(1);

      await server.delete('/api/test/evict-multiple-namespaces').expect(200);

      const res5 = await server.get('/api/test/explicit-key-basic/multi-1').expect(200);
      const res6 = await server.get('/api/test/multi-param-key?category=multi').expect(200);
      const res7 = await server.get('/api/test/conditional-cache/100').expect(200);
      const res8 = await server.get('/api/test/shared-key-cache/multi-2').expect(200);

      expect(res5.body.executionCount).toBe(2);
      expect(res6.body.executionCount).toBe(2);
      expect(res7.body.executionCount).toBe(2);
      expect(res8.body.executionCount).toBe(2);
    });
  });

  describe('multiple decorators', () => {
    describe('@Cacheable + @CacheEvict combined', () => {
      it('should cache its own result while evicting another namespace', async () => {
        await server.get('/api/test/multi-param-key?category=electronics').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=electronics').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // dual-decorator: caches self, evicts products
        const res2 = await server.get('/api/test/dual-decorator/1').expect(200);
        expect(res2.body.executionCount).toBe(1);

        const res3 = await server.get('/api/test/multi-param-key?category=electronics').expect(200);
        expect(res3.body.executionCount).toBe(2);

        const res4 = await server.get('/api/test/dual-decorator/1').expect(200);
        expect(res4.body.executionCount).toBe(1);
        expect(res4.body.timestamp).toBe(res2.body.timestamp);
      });

      it('should create independent cache per ID and evict all products', async () => {
        await server.get('/api/test/multi-param-key?category=books').expect(200);
        await server.get('/api/test/multi-param-key?category=toys').expect(200);

        const res1 = await server.get('/api/test/multi-param-key?category=books').expect(200);
        const res2 = await server.get('/api/test/multi-param-key?category=toys').expect(200);
        expect(res1.body.executionCount).toBe(1);
        expect(res2.body.executionCount).toBe(1);

        await server.get('/api/test/dual-decorator/2').expect(200);

        const res3 = await server.get('/api/test/multi-param-key?category=books').expect(200);
        const res4 = await server.get('/api/test/multi-param-key?category=toys').expect(200);
        expect(res3.body.executionCount).toBe(2);
        expect(res4.body.executionCount).toBe(2);
      });
    });

    describe('multiple @CacheEvict decorators', () => {
      it('should evict multiple namespaces simultaneously', async () => {
        await server.get('/api/test/explicit-key-basic/20').expect(200);
        await server.get('/api/test/multi-param-key?category=test-multi').expect(200);

        const res1 = await server.get('/api/test/explicit-key-basic/20').expect(200);
        const res2 = await server.get('/api/test/multi-param-key?category=test-multi').expect(200);
        expect(res1.body.executionCount).toBe(1);
        expect(res2.body.executionCount).toBe(1);

        const res3 = await server.delete('/api/test/multi-evict').expect(200);
        expect(res3.body.cleared).toEqual(['users', 'products']);
        expect(res3.body.executionCount).toBe(1);

        const res4 = await server.get('/api/test/explicit-key-basic/20').expect(200);
        const res5 = await server.get('/api/test/multi-param-key?category=test-multi').expect(200);
        expect(res4.body.executionCount).toBe(2);
        expect(res5.body.executionCount).toBe(2);
      });

      it('should execute each @CacheEvict independently', async () => {
        await server.get('/api/test/explicit-key-basic/30').expect(200);
        await server.get('/api/test/explicit-key-basic/31').expect(200);
        await server.get('/api/test/multi-param-key?category=cat1').expect(200);
        await server.get('/api/test/multi-param-key?category=cat2').expect(200);

        await server.delete('/api/test/multi-evict').expect(200);

        const res1 = await server.get('/api/test/explicit-key-basic/30').expect(200);
        const res2 = await server.get('/api/test/explicit-key-basic/31').expect(200);
        const res3 = await server.get('/api/test/multi-param-key?category=cat1').expect(200);
        const res4 = await server.get('/api/test/multi-param-key?category=cat2').expect(200);

        expect(res1.body.executionCount).toBe(2);
        expect(res2.body.executionCount).toBe(2);
        expect(res3.body.executionCount).toBe(2);
        expect(res4.body.executionCount).toBe(2);
      });
    });

    describe('conditional @Cacheable + conditional @CacheEvict', () => {
      it('should evaluate each decorator condition independently', async () => {
        await server.get('/api/test/shared-key-cache/2').expect(200);
        const res1 = await server.get('/api/test/shared-key-cache/2').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // cache condition (id>0) and evict condition (id%2==0) both satisfied
        const res2 = await server
          .post('/api/test/conditional-dual/2')
          .send({ data: 'test' })
          .expect(201);
        expect(res2.body.executionCount).toBe(1);

        const res3 = await server.get('/api/test/shared-key-cache/2').expect(200);
        expect(res3.body.executionCount).toBe(2);

        const res4 = await server
          .post('/api/test/conditional-dual/2')
          .send({ data: 'test' })
          .expect(201);
        expect(res4.body.executionCount).toBe(1);
        expect(res4.body.timestamp).toBe(res2.body.timestamp);
      });

      it('should not cache when the cache condition is not satisfied', async () => {
        // cache condition not satisfied (id<=0); evict condition satisfied (id%2==0)
        const res1 = await server
          .post('/api/test/conditional-dual/0')
          .send({ data: 'test' })
          .expect(201);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server
          .post('/api/test/conditional-dual/0')
          .send({ data: 'test' })
          .expect(201);
        expect(res2.body.executionCount).toBe(2);
      });

      it('should not evict when the evict condition is not satisfied', async () => {
        await server.get('/api/test/shared-key-cache/3').expect(200);
        const res1 = await server.get('/api/test/shared-key-cache/3').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // cache condition satisfied (id>0); evict condition not satisfied (id%2!=0)
        const res2 = await server
          .post('/api/test/conditional-dual/3')
          .send({ data: 'test' })
          .expect(201);
        expect(res2.body.executionCount).toBe(1);

        const res3 = await server.get('/api/test/shared-key-cache/3').expect(200);
        expect(res3.body.executionCount).toBe(1);

        const res4 = await server
          .post('/api/test/conditional-dual/3')
          .send({ data: 'test' })
          .expect(201);
        expect(res4.body.executionCount).toBe(1);
      });
    });

    describe('decorator execution order', () => {
      it('should execute decorators in declaration order', async () => {
        await server.get('/api/test/multi-param-key?category=order-test').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=order-test').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // first call: executes method, caches result, then evicts products
        const res2 = await server.get('/api/test/dual-decorator/order-1').expect(200);
        expect(res2.body.executionCount).toBe(1);

        const res3 = await server.get('/api/test/multi-param-key?category=order-test').expect(200);
        expect(res3.body.executionCount).toBe(2);

        // second call: served from cache (CacheEvict does not run)
        const res4 = await server.get('/api/test/dual-decorator/order-1').expect(200);
        expect(res4.body.executionCount).toBe(1);

        await server.get('/api/test/multi-param-key?category=order-test2').expect(200);
        const res5 = await server.get('/api/test/multi-param-key?category=order-test2').expect(200);
        expect(res5.body.executionCount).toBe(1);

        // cached dual-decorator call: CacheEvict does not run, products cache is untouched
        await server.get('/api/test/dual-decorator/order-1').expect(200);
        const res6 = await server.get('/api/test/multi-param-key?category=order-test2').expect(200);
        expect(res6.body.executionCount).toBe(1);
      });
    });
  });

  describe('Stale-While-Revalidate', () => {
    it('should execute the original method only once under 100 concurrent requests', async () => {
      const promises = Array(100)
        .fill(null)
        .map(() => server.get('/api/test/explicit-key-basic/200'));

      const responses = await Promise.all(promises);

      const firstTimestamp = responses[0].body.timestamp;
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body.executionCount).toBe(1);
        expect(response.body.timestamp).toBe(firstTimestamp);
      }

      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getCacheableWithExplicitKey-200']).toBe(1);
    });

    it('should return stale data immediately and refresh in the background after TTL expires', async () => {
      const res1 = await server.get('/api/test/swr-test/1').expect(200);
      expect(res1.body.executionCount).toBe(1);
      const initialTimestamp = res1.body.timestamp;
      const initialGeneratedAt = res1.body.generatedAt;

      // within TTL (1 second): returns cached value
      const res2 = await server.get('/api/test/swr-test/1').expect(200);
      expect(res2.body.executionCount).toBe(1);
      expect(res2.body.timestamp).toBe(initialTimestamp);

      // wait for TTL to expire (1.5 seconds)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // stale data should be returned immediately (< 150 ms)
      const startTime = Date.now();
      const res3 = await server.get('/api/test/swr-test/1').expect(200);
      const responseTime = Date.now() - startTime;

      expect(responseTime).toBeLessThan(150);
      expect(res3.body.executionCount).toBe(1);
      expect(res3.body.timestamp).toBe(initialTimestamp);
      expect(res3.body.generatedAt).toBe(initialGeneratedAt);

      // wait for background refresh to complete (method takes ~100 ms + 50 ms buffer)
      await new Promise((resolve) => setTimeout(resolve, 150));

      const res4 = await server.get('/api/test/swr-test/1').expect(200);
      expect(res4.body.executionCount).toBe(2);
      expect(res4.body.timestamp).toBeGreaterThan(initialTimestamp);
      expect(res4.body.generatedAt).not.toBe(initialGeneratedAt);
    });

    it('should trigger background refresh only once under multiple concurrent stale requests', async () => {
      const res1 = await server.get('/api/test/swr-test/2').expect(200);
      expect(res1.body.executionCount).toBe(1);
      const initialTimestamp = res1.body.timestamp;

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const promises = Array(3)
        .fill(null)
        .map(() => server.get('/api/test/swr-test/2'));

      const responses = await Promise.all(promises);

      // all requests receive stale data immediately
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.executionCount).toBe(1);
        expect(response.body.timestamp).toBe(initialTimestamp);
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const res5 = await server.get('/api/test/swr-test/2').expect(200);
      expect(res5.body.executionCount).toBe(2);
      expect(res5.body.timestamp).toBeGreaterThan(initialTimestamp);

      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrTestData-2']).toBe(2); // initial + one background refresh
    });

    it('should not trigger background refresh when the cache is still fresh', async () => {
      const res1 = await server.get('/api/test/swr-counter').expect(200);
      expect(res1.body.counter).toBe(1);

      // multiple requests within TTL (2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 500));
      const res2 = await server.get('/api/test/swr-counter').expect(200);
      expect(res2.body.counter).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 500));
      const res3 = await server.get('/api/test/swr-counter').expect(200);
      expect(res3.body.counter).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 200));
      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrCounter']).toBe(1);
    });

    it('should retain the previous stale cache when background refresh throws', async () => {
      const res1 = await server.get('/api/test/swr-error/error-test').expect(200);
      expect(res1.body.executionCount).toBe(1);
      expect(res1.body.status).toBe('success');
      const initialTimestamp = res1.body.timestamp;
      const initialValue = res1.body.value;

      await new Promise((resolve) => setTimeout(resolve, 1200));

      // stale data returned; background refresh attempt will throw
      const res2 = await server.get('/api/test/swr-error/error-test').expect(200);
      expect(res2.body.executionCount).toBe(1);
      expect(res2.body.timestamp).toBe(initialTimestamp);
      expect(res2.body.value).toBe(initialValue);

      await new Promise((resolve) => setTimeout(resolve, 300));

      // stale cache is still served despite the background error
      const res3 = await server.get('/api/test/swr-error/error-test').expect(200);
      expect(res3.body.executionCount).toBe(1);
      expect(res3.body.timestamp).toBe(initialTimestamp);
      expect(res3.body.value).toBe(initialValue);
      expect(res3.body.status).toBe('success');

      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrErrorTestData-error-test']).toBe(3); // initial + 2 failed background attempts
    });

    it('should store the physical TTL longer than the logical TTL', async () => {
      const res1 = await server.get('/api/test/swr-test/ttl-test').expect(200);
      expect(res1.body.executionCount).toBe(1);

      // logical TTL (1 second) expires
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // stale but still physically present in cache
      const res2 = await server.get('/api/test/swr-test/ttl-test').expect(200);
      expect(res2.body.executionCount).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const res3 = await server.get('/api/test/swr-test/ttl-test').expect(200);
      expect(res3.body.executionCount).toBe(2);

      // physical TTL = logical TTL × staleMultiplier (e.g. 10s for TTL=1s)
    });

    it('should execute the original method only once under concurrent cache-miss requests', async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => server.get('/api/test/swr-test/stampede-test'));

      const responses = await Promise.all(promises);

      const firstTimestamp = responses[0].body.timestamp;
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];

        expect(response.status).toBe(200);
        expect(response.body.executionCount).toBe(1);
        expect(response.body.timestamp).toBe(firstTimestamp);
      }

      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrTestData-stampede-test']).toBe(1);
    });

    it('should trigger background refresh only once under concurrent stale requests', async () => {
      await server.get('/api/test/swr-test/concurrent-stale').expect(200);

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const promises = Array(20)
        .fill(null)
        .map(() => server.get('/api/test/swr-test/concurrent-stale'));

      await Promise.all(promises);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrTestData-concurrent-stale']).toBe(2); // initial + one refresh
    });
  });

  describe('Compression', () => {
    describe('large data compression', () => {
      it('should compress and cache data larger than 20 KB', async () => {
        const res1 = await server.get('/api/test/large-data/compress-1').expect(200);
        expect(res1.body.executionCount).toBe(1);
        expect(res1.body.items).toHaveLength(500);

        // second request: decompressed from cache
        const res2 = await server.get('/api/test/large-data/compress-1').expect(200);
        expect(res2.body.executionCount).toBe(1);
        expect(res2.body.items).toHaveLength(500);

        expect(res2.body.id).toBe('compress-1');
        expect(res2.body.items[0].id).toBe('item-0');
        expect(res2.body.items[499].id).toBe('item-499');
      });

      it('should correctly restore compressed cache data', async () => {
        const res1 = await server.get('/api/test/large-data/compress-2').expect(200);
        const res2 = await server.get('/api/test/large-data/compress-2').expect(200);

        expect(res2.body.id).toBe(res1.body.id);
        expect(res2.body.items.length).toBe(res1.body.items.length);
        expect(res2.body.timestamp).toBe(res1.body.timestamp);

        // nested objects should be fully restored
        expect(res2.body.items[0].metadata.tags).toEqual(['tag1', 'tag2', 'tag3']);
        expect(res2.body.items[0].metadata.category).toBe('electronics');
      });
    });

    describe('small data without compression', () => {
      it('should cache data smaller than 20 KB without compression', async () => {
        const res1 = await server.get('/api/test/small-data/small-1').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/small-data/small-1').expect(200);
        expect(res2.body.executionCount).toBe(1);

        expect(res2.body.id).toBe('small-1');
        expect(res2.body.name).toBe('Small Data small-1');
      });
    });

    describe('compression data integrity', () => {
      it('should correctly handle large data containing unicode strings', async () => {
        const res1 = await server.get('/api/test/large-data/unicode-test').expect(200);
        const res2 = await server.get('/api/test/large-data/unicode-test').expect(200);

        expect(res2.body.executionCount).toBe(1);
        expect(res2.body.items).toHaveLength(500);
      });

      it('should return consistent results for concurrent large-data requests', async () => {
        const promises = Array(10)
          .fill(null)
          .map(() => server.get('/api/test/large-data/concurrent-compress'));

        const responses = await Promise.all(promises);

        const firstTimestamp = responses[0].body.timestamp;
        for (const response of responses) {
          expect(response.status).toBe(200);
          expect(response.body.executionCount).toBe(1);
          expect(response.body.timestamp).toBe(firstTimestamp);
          expect(response.body.items).toHaveLength(500);
        }
      });
    });
  });
});
