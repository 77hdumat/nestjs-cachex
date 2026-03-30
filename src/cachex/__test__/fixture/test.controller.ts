import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';

import { Cacheable, CacheEvict } from '../../cache.decorators';
import { CacheManager } from '../../core/types';

export const executionCount = new Map<string, number>();
export const errorFlags = new Map<string, boolean>();

@Controller('/api/test')
export class TestController {
  /**
   * 명시적 키를 사용한 기본 캐싱 테스트
   * 키 전략: 'user-{id}'
   */
  @Cacheable({
    ttl: 60,
    name: 'users',
    key: (id: string) => `user-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/explicit-key-basic/:id')
  async getCacheableWithExplicitKey(@Param('id') id: string) {
    const count = this.incrementExecution(`getCacheableWithExplicitKey-${id}`);
    // [설정] 락 경합 테스트를 위해 처리 시간을 50ms로 설정
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      id,
      name: `User ${id}`,
      executionCount: count,
      timestamp: Date.now(),
    };
  }

  /**
   * 다중 파라미터를 활용한 복합 키 캐싱 테스트
   * 키 전략: 'products-{category}-{page}'
   */
  @Cacheable({
    ttl: 60,
    name: 'products',
    key: (category?: string, page?: number) => `products-${category || 'all'}-${page || 1}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/multi-param-key')
  async getCacheableWithMultipleParams(
    @Query('category') category?: string,
    @Query('page') page?: number,
  ) {
    const count = this.incrementExecution(`getCacheableWithMultipleParams-${category}-${page}`);
    return {
      category: category || 'all',
      page: page || 1,
      items: [`Product 1`, `Product 2`],
      executionCount: count,
    };
  }

  /**
   * condition과 unless를 활용한 조건부 캐싱 테스트
   * condition: id > 0일 때만 캐싱
   * unless: 결과에 error가 있으면 캐싱 안함
   */
  @Cacheable({
    ttl: 60,
    name: 'conditional',
    condition: (id: string) => parseInt(id) > 0,
    unless: (result) => result.error !== undefined,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/conditional-cache/:id')
  async getCacheableWithConditions(@Param('id') id: string) {
    const count = this.incrementExecution(`getCacheableWithConditions-${id}`);
    if (parseInt(id) === -1) {
      return { error: 'Invalid ID', executionCount: count };
    }
    return {
      id,
      data: `Conditional data for ${id}`,
      executionCount: count,
    };
  }

  /**
   * 명시적 키를 사용한 캐시 삭제 테스트
   * 동일한 키 전략으로 특정 캐시 항목 삭제
   */
  @CacheEvict({
    name: 'users',
    key: (id: string) => `user-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Post('/evict-explicit-key/:id')
  async evictCacheWithExplicitKey(@Param('id') id: string, @Body() data: any) {
    const count = this.incrementExecution(`evictCacheWithExplicitKey-${id}`);
    return {
      id,
      updated: true,
      data,
      executionCount: count,
    };
  }

  /**
   * 캐시와 삭제가 동일한 키를 공유하는 복합 테스트 - 조회
   */
  @Cacheable({
    ttl: 60,
    name: 'shared-key-namespace',
    key: (id: string) => `shared-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/shared-key-cache/:id')
  async getCacheableWithSharedKey(@Param('id') id: string) {
    const count = this.incrementExecution(`getCacheableWithSharedKey-${id}`);
    return {
      id,
      type: 'shared',
      executionCount: count,
      timestamp: Date.now(),
    };
  }

  /**
   * 캐시와 삭제가 동일한 키를 공유하는 복합 테스트 - 삭제
   */
  @CacheEvict({
    name: 'shared-key-namespace',
    key: (id: string) => `shared-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Post('/shared-key-evict/:id')
  async evictCacheWithSharedKey(@Param('id') id: string, @Body() data: any) {
    return {
      id,
      updated: true,
      data,
    };
  }

  /**
   * beforeInvocation과 condition을 활용한 전체 삭제 테스트
   * beforeInvocation: true - 메서드 실행 전 삭제
   * condition: id === 'all'일 때만 삭제
   * allEntries: true - 네임스페이스 전체 삭제
   */
  @CacheEvict({
    name: 'products',
    allEntries: true,
    condition: (id: string) => id === 'all',
    beforeInvocation: true,
    cacheManager: CacheManager.MEMORY,
  })
  @Delete('/conditional-evict-all/:id')
  async evictAllWithConditionBeforeInvocation(@Param('id') id: string) {
    this.incrementExecution(`evictAllWithConditionBeforeInvocation`);
    // 의도적으로 에러 발생 - beforeInvocation 테스트
    throw new Error('error');
  }

  /**
   * 다중 네임스페이스 동시 삭제 테스트
   * 여러 캐시 네임스페이스를 한번에 초기화
   */
  @CacheEvict({
    name: ['users', 'products', 'conditional', 'shared-key-namespace', 'auto-hashed'],
    allEntries: true,
    cacheManager: CacheManager.MEMORY,
  })
  @Delete('/evict-multiple-namespaces')
  async evictMultipleNamespaces() {
    return {
      cleared: ['users', 'products', 'conditional', 'shared-key-namespace', 'auto-hashed'],
    };
  }

  /**
   * 자동 키 해싱을 사용하는 캐싱 테스트 (name 없이)
   * 클래스명:메서드명:해시 형태로 자동 키 생성
   */
  @Cacheable({
    ttl: 60,
    cacheManager: CacheManager.MEMORY,
  })
  @Post('/auto-hashed-cache/:id')
  async getCacheableWithAutoHash(
    @Param('id') id: string,
    @Query('q') q: string,
    @Body() body: any,
  ) {
    const count = this.incrementExecution(
      `getCacheableWithAutoHash-${id}-${q}-${JSON.stringify(body)}`,
    );
    return {
      id,
      q,
      body,
      executionCount: count,
    };
  }

  /**
   * 자동 키 해싱을 사용하는 캐시 삭제 테스트
   * 메서드명이 달라서 실제로는 삭제되지 않는 케이스 (의도된 동작)
   */
  @CacheEvict({
    cacheManager: CacheManager.MEMORY,
  })
  @Delete('/auto-hashed-evict/:id')
  async evictCacheWithAutoHash(@Param('id') id: string, @Query('q') q: string, @Body() body: any) {
    return {
      deleted: true,
      id,
      q,
      body,
    };
  }

  /**
   * 두 개의 데코레이터를 사용하는 테스트 - Cacheable과 CacheEvict 동시 사용
   * 캐싱과 다른 캐시 삭제를 동시에 수행
   */
  @Cacheable({
    ttl: 60,
    name: 'dual-decorator',
    key: (id: string) => `dual-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @CacheEvict({
    name: 'products',
    allEntries: true,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/dual-decorator/:id')
  async getDualDecorator(@Param('id') id: string) {
    const count = this.incrementExecution(`getDualDecorator-${id}`);
    return {
      id,
      data: `Dual decorator data for ${id}`,
      executionCount: count,
      timestamp: Date.now(),
    };
  }

  /**
   * 여러 CacheEvict 데코레이터를 사용하는 테스트
   * 여러 네임스페이스를 한 번에 삭제
   */
  @CacheEvict({
    name: 'users',
    allEntries: true,
    cacheManager: CacheManager.MEMORY,
  })
  @CacheEvict({
    name: 'products',
    allEntries: true,
    cacheManager: CacheManager.MEMORY,
  })
  @Delete('/multi-evict')
  async multipleEvict() {
    const count = this.incrementExecution('multipleEvict');
    return {
      cleared: ['users', 'products'],
      executionCount: count,
    };
  }

  /**
   * SWR(Stale-While-Revalidate) 테스트를 위한 짧은 TTL 엔드포인트
   * TTL이 매우 짧아 stale 상태를 쉽게 만들 수 있음
   */
  @Cacheable({
    ttl: 1, // 1초 TTL - stale 상태를 빠르게 만들기 위함
    name: 'swr-test',
    key: (id: string) => `swr-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/swr-test/:id')
  async getSwrTestData(@Param('id') id: string) {
    const count = this.incrementExecution(`getSwrTestData-${id}`);
    // 실제 처리 시간을 시뮬레이션 (백그라운드 갱신 시간 확인용)
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      id,
      value: `SWR Data for ${id}`,
      executionCount: count,
      timestamp: Date.now(),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * [추가됨] SWR 동시성 테스트 전용 엔드포인트
   */
  @Cacheable({
    ttl: 1, // 1초 TTL
    name: 'swr-concurrent-stale',
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/swr-concurrent-stale')
  async getSwrConcurrentStale() {
    const count = this.incrementExecution('getSwrConcurrentStale');
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      value: 'SWR Concurrent Stale Data',
      executionCount: count,
      timestamp: Date.now(),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * SWR 테스트용 - 카운터만 증가시키는 빠른 엔드포인트
   */
  @Cacheable({
    ttl: 2, // 2초 TTL
    name: 'swr-counter',
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/swr-counter')
  async getSwrCounter() {
    const count = this.incrementExecution('getSwrCounter');
    return {
      counter: count,
      timestamp: Date.now(),
    };
  }

  /**
   * 조건부 캐싱과 조건부 삭제를 동시에 사용하는 테스트
   */
  @Cacheable({
    ttl: 60,
    name: 'conditional-dual',
    condition: (id: string) => parseInt(id) > 0,
    cacheManager: CacheManager.MEMORY,
  })
  @CacheEvict({
    name: 'shared-key-namespace',
    key: (id: string) => `shared-${id}`,
    condition: (id: string) => parseInt(id) % 2 === 0,
    cacheManager: CacheManager.MEMORY,
  })
  @Post('/conditional-dual/:id')
  async conditionalDualDecorator(@Param('id') id: string, @Body() data: any) {
    const count = this.incrementExecution(`conditionalDualDecorator-${id}`);
    return {
      id,
      data,
      executionCount: count,
      timestamp: Date.now(),
    };
  }

  /**
   * SWR 에러 시뮬레이션 엔드포인트
   * 첫 번째 호출은 성공, 이후 호출에서는 에러를 발생시킴
   */
  @Cacheable({
    ttl: 1, // 1초 TTL - stale 상태를 빠르게 만들기 위함
    name: 'swr-error-test',
    key: (id: string) => `swr-error-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/swr-error/:id')
  async getSwrErrorTestData(@Param('id') id: string) {
    const count = this.incrementExecution(`getSwrErrorTestData-${id}`);

    // 첫 번째 실행은 성공, 두 번째부터 에러 발생
    if (count > 1) {
      throw new Error(`Simulated background refresh error for ${id}`);
    }

    return {
      id,
      value: `SWR Error Test Data for ${id}`,
      executionCount: count,
      timestamp: Date.now(),
      status: 'success',
    };
  }

  /**
   * 에러 플래그 설정/해제 엔드포인트
   */
  @Post('/error-flags/:key')
  setErrorFlag(@Param('key') key: string, @Body('shouldError') shouldError: boolean) {
    errorFlags.set(key, shouldError);
    return { key, shouldError };
  }

  /**
   * SWR 제어 가능한 에러 시뮬레이션 엔드포인트
   * errorFlags를 통해 에러 발생 여부를 제어
   */
  @Cacheable({
    ttl: 1, // 1초 TTL
    name: 'swr-controlled-error',
    key: (id: string) => `swr-controlled-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/swr-controlled/:id')
  async getSwrControlledData(@Param('id') id: string) {
    const count = this.incrementExecution(`getSwrControlledData-${id}`);

    // 에러 플래그가 설정되어 있으면 에러 발생
    if (errorFlags.get(`swr-controlled-${id}`)) {
      throw new Error(`Controlled error for ${id}`);
    }

    return {
      id,
      value: `Controlled SWR Data for ${id}`,
      executionCount: count,
      timestamp: Date.now(),
      status: 'success',
    };
  }

  /**
   * 압축 테스트용 대용량 데이터 엔드포인트 (20KB 이상)
   * Brotli 압축이 적용되는지 확인
   */
  @Cacheable({
    ttl: 60,
    name: 'large-data',
    key: (id: string) => `large-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/large-data/:id')
  async getLargeData(@Param('id') id: string) {
    const count = this.incrementExecution(`getLargeData-${id}`);
    // 20KB 이상의 대용량 데이터 생성
    const items = Array(500)
      .fill(null)
      .map((_, i) => ({
        id: `item-${i}`,
        name: `Item Name ${i}`,
        description:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
        metadata: {
          createdAt: new Date().toISOString(),
          tags: ['tag1', 'tag2', 'tag3'],
          category: 'electronics',
        },
      }));

    return {
      id,
      items,
      executionCount: count,
      timestamp: Date.now(),
    };
  }

  /**
   * 압축 테스트용 소용량 데이터 엔드포인트 (20KB 미만)
   * 압축이 적용되지 않아야 함
   */
  @Cacheable({
    ttl: 60,
    name: 'small-data',
    key: (id: string) => `small-${id}`,
    cacheManager: CacheManager.MEMORY,
  })
  @Get('/small-data/:id')
  async getSmallData(@Param('id') id: string) {
    const count = this.incrementExecution(`getSmallData-${id}`);
    return {
      id,
      name: `Small Data ${id}`,
      executionCount: count,
      timestamp: Date.now(),
    };
  }

  /**
   * 테스트 통계 조회
   * 각 메서드의 실제 실행 횟수 확인
   */
  @Get('/stats/execution-count')
  getExecutionStats() {
    return Object.fromEntries(executionCount);
  }

  /**
   * 테스트 통계 초기화
   */
  @Post('/stats/reset')
  resetExecutionStats() {
    executionCount.clear();
    return { reset: true };
  }

  private incrementExecution(key: string): number {
    const count = (executionCount.get(key) || 0) + 1;
    executionCount.set(key, count);
    return count;
  }
}
