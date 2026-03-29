import { Inject, Injectable, Logger } from '@nestjs/common';

import type { CacheModuleConfig, CompressionConfig, SwrConfig } from '../core';
import {
  CACHE_MODULE_CONFIG,
  CacheableContext,
  CacheableOption,
  CacheEnvelope,
  CacheEvictContext,
  CacheProvider,
  DEFAULT_CONFIG,
} from '../core';
import { sleep } from '../util';

/**
 * 런타임에 사용될 병합된 SWR 설정
 */
interface ResolvedSwrConfig {
  enabled: boolean;
  defaultStaleMultiplier: number;
}

@Injectable()
export class CacheOperations {
  private readonly logger = new Logger(CacheOperations.name);

  private readonly globalSwrConfig: SwrConfig;
  private readonly globalDefaultTtl: number | undefined;
  private readonly globalCompressionConfig: CompressionConfig;

  /**
   * 백그라운드 갱신이 예약된 키 추적 (중복 스케줄 방지)
   */
  private readonly refreshingKeys = new Set<string>();

  /**
   * 인-프로세스 싱글플라이트: 같은 서버 내 동일 키에 대한 중복 요청을 단일 Promise로 병합
   */
  private readonly inflightMap = new Map<string, Promise<unknown>>();

  private readonly pubSubTimeoutMs: number;

  constructor(@Inject(CACHE_MODULE_CONFIG) config: CacheModuleConfig) {
    this.globalSwrConfig = config?.swr ?? {};
    this.globalDefaultTtl = config?.defaults?.ttl;
    this.globalCompressionConfig = config?.compression ?? {};
    this.pubSubTimeoutMs = config?.swr?.pubSubTimeoutMs ?? DEFAULT_CONFIG.swr.pubSubTimeoutMs;
  }

  /**
   * SWR 전략으로 캐시를 조회합니다
   */
  async getWithSwr(context: CacheableContext, option: CacheableOption): Promise<unknown> {
    const { key, cacheProvider } = context;
    const swrConfig = this.resolveSwrConfig(option);

    // SWR 비활성화 시 단순 캐시 로직
    if (!swrConfig.enabled) {
      return this.getWithSimpleCache(context, option);
    }

    let envelope: CacheEnvelope | null = null;

    try {
      const cached = await cacheProvider.get<unknown>(key);
      envelope = CacheEnvelope.fromObject(cached);
    } catch (error) {
      this.logger.debug(`캐시 조회 실패 (키: ${key}). 갱신 시도.`, error);
    }

    if (!envelope) {
      return this.handleCacheMissWithLock(context, option, swrConfig);
    }

    if (envelope.isStale()) {
      this.scheduleBackgroundRefresh(context, option, swrConfig);
      return envelope.data;
    }

    return envelope.data;
  }

  /**
   * 캐시를 삭제합니다
   */
  async bulkEvict(context: CacheEvictContext): Promise<void> {
    const { keys, cacheProvider, allEntries = false } = context;

    try {
      if (allEntries) {
        await this.deleteByPatterns(cacheProvider, keys);
      } else {
        await this.deleteByKeys(cacheProvider, keys);
      }
    } catch (error) {
      this.logger.error('캐시 삭제 실패', error);
    }
  }

  /**
   * 데코레이터 옵션과 글로벌 설정을 병합합니다
   * 우선순위: @Cacheable({ swr }) > forRootAsync({ swr.enabled })
   */
  private resolveSwrConfig(option?: CacheableOption): ResolvedSwrConfig {
    const enabled: boolean =
      option?.swr !== undefined
        ? option.swr
        : (this.globalSwrConfig.enabled ?? DEFAULT_CONFIG.swr.enabled);

    const defaultStaleMultiplier: number =
      this.globalSwrConfig.defaultStaleMultiplier ?? DEFAULT_CONFIG.swr.defaultStaleMultiplier;

    return { enabled, defaultStaleMultiplier };
  }

  /**
   * TTL을 해석합니다 (데코레이터 → 글로벌 fallback)
   */
  private resolveTtl(option: CacheableOption): number {
    const ttl = option.ttl ?? this.globalDefaultTtl;
    if (ttl === undefined) {
      throw new Error(
        'TTL이 설정되지 않았습니다. 데코레이터 또는 글로벌 defaults.ttl을 설정해주세요.',
      );
    }
    return ttl;
  }

  /**
   * staleTtl을 계산합니다
   * 우선순위: option.staleTtl > ttl * defaultStaleMultiplier
   */
  private resolveStaleTtl(option: CacheableOption, multiplier: number): number {
    const ttl = this.resolveTtl(option);
    return option.staleTtl ?? ttl * multiplier;
  }

  /**
   * 압축 설정을 해석합니다 (데코레이터 → 글로벌 fallback)
   * 우선순위: @Cacheable({ compression }) > forRootAsync({ compression })
   */
  private resolveCompressionOverride(option: CacheableOption): CompressionConfig | undefined {
    if (option.compression === undefined) {
      return undefined;
    }
    if (option.compression === false) {
      return { enabled: false };
    }
    if (option.compression === true) {
      return { ...this.globalCompressionConfig, enabled: true };
    }
    return { ...this.globalCompressionConfig, ...option.compression, enabled: true };
  }

  /**
   * SWR 비활성화 시 단순 캐시 로직
   */
  private async getWithSimpleCache(
    context: CacheableContext,
    option: CacheableOption,
  ): Promise<unknown> {
    const { key, cacheProvider, method, args } = context;
    const compressionOverride = this.resolveCompressionOverride(option);

    try {
      const cached = await cacheProvider.get<unknown>(key);
      if (cached !== null) {
        return cached;
      }
    } catch (error) {
      this.logger.debug(`캐시 조회 실패 (키: ${key})`, error);
    }

    const result = await method(...args);

    if (option.unless?.(result, ...args)) {
      return result;
    }

    const ttl = this.resolveTtl(option);
    try {
      await cacheProvider.put(key, result, ttl, compressionOverride);
    } catch (error) {
      this.logger.warn(`캐시 저장 실패 (키: ${key})`, error);
    }

    return result;
  }

  /**
   * 캐시 미스 발생 시 인-프로세스 중복 방지 후 분산 락/Pub/Sub으로 처리합니다
   * inflightMap으로 같은 서버 내 동일 키 요청을 단일 Promise로 병합합니다
   */
  private handleCacheMissWithLock(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<unknown> {
    const { key } = context;

    const inflight = this.inflightMap.get(key);
    if (inflight) {
      return inflight;
    }

    const promise = this.fetchWithLockAndPubSub(context, option, swrConfig);
    this.inflightMap.set(key, promise);
    void promise.finally(() => this.inflightMap.delete(key));
    return promise;
  }

  /**
   * 분산 락 획득 후 캐시를 갱신하거나, 락 실패 시 Pub/Sub 또는 폴링으로 결과를 기다립니다
   *
   * 처리 순서:
   * 1. tryLock 성공 → renewCache + notifyResult (다른 서버에 PUBLISH)
   * 2. tryLock 실패 + waitForResult 있음 → SUBSCRIBE 대기 → 캐시 조회
   * 3. 타임아웃 또는 waitForResult 없음 → 지수 백오프 폴링
   * 4. 최후 수단 → 원본 메서드 직접 호출
   */
  private async fetchWithLockAndPubSub(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<unknown> {
    const { key, cacheProvider, method, args } = context;

    const lockAcquired = await cacheProvider.tryLock(key);

    if (lockAcquired) {
      try {
        // 더블 체크: 락 대기 중 다른 프로세스가 이미 캐시를 생성했을 수 있음
        const cached = await this.getCacheEnvelope(key, cacheProvider);
        if (cached) {
          return cached.data;
        }

        const result = await this.renewCache(context, option, swrConfig);

        // 대기 중인 다른 서버에 갱신 완료 알림
        void cacheProvider.notifyResult?.(key);

        return result;
      } finally {
        await this.releaseLock(cacheProvider, key);
      }
    }

    // 락 획득 실패 — Pub/Sub으로 갱신 완료 이벤트 대기
    if (cacheProvider.waitForResult) {
      try {
        await cacheProvider.waitForResult(key, this.pubSubTimeoutMs);
        const cached = await this.getCacheEnvelope(key, cacheProvider);
        if (cached) {
          return cached.data;
        }
      } catch {
        this.logger.debug(`Pub/Sub 대기 실패, 폴링으로 폴백 (키: ${key})`);
      }
    }

    // 폴링 폴백: 지수 백오프로 캐시 재조회
    const { maxAttempts } = DEFAULT_CONFIG.swr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      await this.delayWithExponentialBackoff(attempt);
      // eslint-disable-next-line no-await-in-loop
      const cached = await this.getCacheEnvelope(key, cacheProvider);
      if (cached) {
        return cached.data;
      }
    }

    // 최후 수단: 원본 메서드 직접 호출
    return method(...args);
  }

  /**
   * 논리적으로 만료된 캐시를 백그라운드에서 갱신하도록 스케줄링합니다
   * 동시에 들어온 여러 요청이 중복으로 스케줄하지 않도록 Set으로 추적합니다
   */
  private scheduleBackgroundRefresh(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): void {
    const { key } = context;

    if (this.refreshingKeys.has(key)) {
      return;
    }

    this.refreshingKeys.add(key);

    setImmediate(() => {
      this.backgroundRefresh(context, option, swrConfig)
        .catch((error) => {
          this.logger.error(`백그라운드 캐시 갱신 실패 (키: ${key})`, error);
        })
        .finally(() => {
          this.refreshingKeys.delete(key);
        });
    });
  }

  /**
   * 백그라운드에서 캐시를 갱신합니다
   */
  private async backgroundRefresh(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<void> {
    const { key, cacheProvider } = context;
    let lockAcquired = false;

    try {
      lockAcquired = await cacheProvider.tryLock(key);
      if (!lockAcquired) {
        return;
      }

      const cached = await this.getCacheEnvelope(key, cacheProvider);
      if (cached && cached.isFresh()) {
        return;
      }

      await this.renewCache(context, option, swrConfig);
    } finally {
      if (lockAcquired) {
        await this.releaseLock(cacheProvider, key);
      }
    }
  }

  /**
   * 원본 메서드를 실행하고 결과를 캐시에 저장합니다
   */
  private async renewCache(
    context: CacheableContext,
    option: CacheableOption,
    swrConfig: ResolvedSwrConfig,
  ): Promise<unknown> {
    const { key, method, args, cacheProvider } = context;
    const ttl = this.resolveTtl(option);

    const result = await method(...args);

    if (option.unless?.(result, ...args)) {
      return result;
    }

    try {
      const envelope = CacheEnvelope.create(result, ttl);
      const staleTtl = this.resolveStaleTtl(option, swrConfig.defaultStaleMultiplier);
      const physicalTtl = this.resolvePhysicalTtl(ttl, staleTtl);
      const compressionOverride = this.resolveCompressionOverride(option);

      await cacheProvider.put(key, envelope.toObject(), physicalTtl, compressionOverride);
    } catch (error) {
      this.logger.warn(`캐시 저장 실패 (키: ${key})`, error);
    }

    return result;
  }

  /**
   * 패턴으로 캐시를 삭제합니다
   */
  private async deleteByPatterns(cacheProvider: CacheProvider, patterns: string[]): Promise<void> {
    await Promise.all(patterns.map((pattern) => cacheProvider.clearKeysByPattern(pattern)));
  }

  /**
   * 키로 캐시를 삭제합니다
   */
  private async deleteByKeys(cacheProvider: CacheProvider, keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => cacheProvider.evict(key)));
  }

  /**
   * 물리적 TTL을 계산합니다
   * physicalTtl = ttl + staleTtl + jitter
   * jitter는 Redis 동시 만료 분산 목적으로 물리 TTL에만 적용합니다
   */
  private resolvePhysicalTtl(ttl: number, staleTtl: number): number {
    const physicalTtl = ttl + staleTtl;

    const JITTER_RATIO = 0.1;
    const MAX_JITTER_SECONDS = 20;
    const maxJitter = Math.min(physicalTtl * JITTER_RATIO, MAX_JITTER_SECONDS);
    const jitter = Math.random() * maxJitter;

    return Math.round(physicalTtl + jitter);
  }

  /**
   * 지수 백오프(Exponential Backoff)와 지터(Jitter)를 적용한 대기 함수
   */
  private async delayWithExponentialBackoff(attempt: number): Promise<void> {
    const { baseDelayMs, jitterMs, maxDelayMs } = DEFAULT_CONFIG.swr;

    const baseDelay = baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * jitterMs;
    const delay = Math.min(baseDelay + jitter, maxDelayMs);

    await sleep(delay);
  }

  /**
   * 캐시를 조회합니다
   */
  private async getCacheEnvelope(
    key: string,
    cacheProvider: CacheProvider,
  ): Promise<CacheEnvelope | null> {
    try {
      const cached = await cacheProvider.get<unknown>(key);
      return CacheEnvelope.fromObject(cached);
    } catch {
      return null;
    }
  }

  /**
   * 분산 락을 안전하게 해제합니다
   */
  private async releaseLock(cacheProvider: CacheProvider, lockKey: string): Promise<void> {
    try {
      await cacheProvider.unlock(lockKey);
    } catch (error) {
      this.logger.warn(`락 해제 실패 (키: ${lockKey})`, error);
    }
  }
}
