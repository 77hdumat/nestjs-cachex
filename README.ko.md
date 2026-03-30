[English](./README.md) | **한국어** | [日本語](./README.ja.md)

# nestjs-cachex

[![npm version](https://img.shields.io/npm/v/nestjs-cachex)](https://npmjs.com/package/nestjs-cachex)
[![license](https://img.shields.io/npm/l/nestjs-cachex)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)](https://typescriptlang.org)

NestJS를 위한 데코레이터 기반 캐싱 모듈입니다.

SWR, Single-flight, msgpack + zstd, 멀티레벨 캐시를 하나의 패키지로 제공합니다.

---

## 소개

대부분의 캐싱 모듈은 캐시가 살아있는 동안만 잘 동작합니다. TTL이 만료되는 순간, 이후 요청은 모두 DB나 외부 API로 직접 향하고 동시에 몰릴 경우 Cache Stampede로 이어집니다.

`nestjs-cachex`는 이 문제를 원천적으로 해결합니다.

- **SWR** — 캐시가 만료돼도 기존 데이터를 즉시 반환하고, 갱신은 백그라운드에서 처리합니다.
- **Single-flight** — Redis 분산 락과 Pub/Sub으로 동일 키에 대한 갱신을 단 한 번만 실행합니다.
- **멀티레벨 캐시** — L1(메모리)과 L2(Redis)를 계층으로 구성해 불필요한 네트워크 비용을 없앱니다.

| 기능 | @nestjs/cache-manager | nestjs-cachex |
|---|---|---|
| SWR | ✗ | ✓ |
| Single-flight | ✗ | ✓ |
| 분산 락 | ✗ | ✓ |
| msgpack 직렬화 | ✗ | ✓ |
| zstd 압축 | ✗ | ✓ |
| 멀티레벨 캐시 | ✗ | ✓ |

---

## 빠른 시작

```typescript
import { Cacheable, CacheEvict } from 'nestjs-cachex';

@Injectable()
export class UserService {
  @Cacheable({ ttl: 60, name: 'users', key: (id: string) => id })
  async findUser(id: string) {
    return this.userRepository.findOne(id);
  }

  @CacheEvict({ name: 'users', key: (id: string) => id })
  async updateUser(id: string, data: UpdateUserDto) {
    return this.userRepository.update(id, data);
  }
}
```

---

## 주요 기능

- **데코레이터 기반** — `@Cacheable`, `@CacheEvict` 하나로 캐싱 로직을 비즈니스 코드와 완전히 분리
- **SWR** — 캐시가 만료돼도 응답은 즉시. 갱신은 백그라운드에서
- **Single-flight** — 분산 락과 Pub/Sub으로 멀티 인스턴스 환경에서도 갱신은 단 한 번
- **Jitter** — TTL에 랜덤 오프셋을 더해 Cache Stampede를 원천 차단
- **msgpack** — JSON 대신 바이너리 직렬화로 더 작게, 더 빠르게
- **zstd 압축** — 임계값을 넘는 데이터는 자동으로 압축해 저장
- **멀티레벨 캐시** — L1(메모리) 히트 시 Redis 조회 없음. L1 미스 시 L2에서 조회 후 Write-back
- **동적 키** — 문자열 고정값 또는 함수로 요청마다 다른 키 생성
- **조건부 캐싱** — `condition`, `unless`로 저장 여부를 세밀하게 제어
- **완전한 TypeScript 지원** — 모든 옵션에 타입 추론 제공

---

## 요구사항

- Node.js 18+
- NestJS 9+
- Redis 6+ _(optional, Redis / 멀티레벨 캐시 사용 시)_

---

## 설치

```bash
npm install nestjs-cachex
# 또는
yarn add nestjs-cachex
```

Redis를 사용한다면 ioredis도 함께 설치합니다.

```bash
npm install ioredis
```

---

## 사용법

### 모듈 등록

#### 정적 등록

```typescript
import { CacheXModule, CacheManager } from 'nestjs-cachex';

@Module({
  imports: [
    CacheXModule.forRoot({
      defaults: {
        ttl: 300,
        cacheManager: CacheManager.REDIS,
      },
    }),
  ],
})
export class AppModule {}
```

#### 동적 등록

```typescript
CacheXModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  redisToken: REDIS_CLIENT,
  subscriberToken: REDIS_SUBSCRIBER,
  useFactory: async (config: ConfigService) => ({
    defaults: {
      ttl: config.get('CACHE_TTL'),
      cacheManager: CacheManager.REDIS,
    },
    swr: {
      enabled: true,
      defaultStaleMultiplier: 5, // staleTtl 미지정 시 ttl × 5
      pubSubTimeoutMs: 2000,
    },
    compression: {
      enabled: true,
      threshold: 20 * 1024, // 20KB 이상만 압축
      level: 3,
    },
  }),
})
```

#### Redis 클라이언트 구성

Pub/Sub은 전용 커넥션이 필요합니다. 일반 커넥션과 **반드시 분리**해서 주입하세요.

```typescript
export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

@Module({
  providers: [
    { provide: REDIS_CLIENT, useFactory: () => new Redis({ host: 'localhost', port: 6379 }) },
    { provide: REDIS_SUBSCRIBER, useFactory: () => new Redis({ host: 'localhost', port: 6379 }) },
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule {}
```

### @Cacheable

```typescript
// SWR 패턴
@Cacheable({
  ttl: 10,       // 10초 동안 fresh
  staleTtl: 290, // 이후 290초 동안 stale 반환 + 백그라운드 갱신
  name: 'dashboard',
  key: (userId: string) => userId,
})
async getDashboard(userId: string) { ... }

// 조건부 캐싱
@Cacheable({
  ttl: 60,
  name: 'items',
  condition: (id: string) => id !== 'guest', // false면 캐시 건너뜀
  unless: (result) => result === null,        // true면 저장 안 함
})
async findItem(id: string) { ... }

// 멀티레벨 캐시
@Cacheable({ ttl: 60, name: 'hot-data', cacheManager: CacheManager.MULTI })
async getHotData(id: string) { ... }
```

### @CacheEvict

```typescript
// 특정 항목 삭제
@CacheEvict({ name: 'users', key: (id: string) => id })
async updateUser(id: string, data: UpdateUserDto) { ... }

// 네임스페이스 전체 삭제
@CacheEvict({ name: 'users', allEntries: true })
async deleteAllUsers() { ... }

// 여러 네임스페이스 삭제
@CacheEvict({ name: ['users', 'profiles', 'sessions'], allEntries: true })
async clearAll() { ... }

// 메서드 실행 전 삭제
@CacheEvict({ name: 'users', allEntries: true, beforeInvocation: true })
async refreshUsers() { ... }

// debounce 삭제 — 짧은 시간 내 동일 키에 무효화 요청이 폭발적으로 들어올 때 유용
@CacheEvict({ name: 'reports', allEntries: true, debounceMs: 3000 })
async onDataChanged() { ... }
```

### 복합 사용

```typescript
@Cacheable({ ttl: 60, name: 'user-detail', key: (id: string) => id })
@CacheEvict({ name: 'user-list', allEntries: true })
async getUser(id: string) { ... }
```

---

## API

### @Cacheable

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `ttl` | `number` | `defaults.ttl` | 캐시 유효 시간 (초) |
| `staleTtl` | `number` | `ttl × staleMultiplier` | TTL 만료 후 stale 유지 시간 (초) |
| `swr` | `boolean` | 모듈 설정 | SWR 활성화 여부 override |
| `name` | `string \| (...args) => string` | 자동 생성 | 캐시 네임스페이스 |
| `key` | `string \| (...args) => string` | 자동 해시 | 캐시 키 |
| `cacheManager` | `CacheManager` | `REDIS` | `REDIS` \| `MEMORY` \| `MULTI` |
| `condition` | `(...args) => boolean` | — | `false`면 캐시 조회/저장 건너뜀 |
| `unless` | `(result, ...args) => boolean` | — | `true`면 저장 건너뜀 |
| `compression` | `boolean \| { threshold?, level? }` | 모듈 설정 | 압축 설정 override |

### @CacheEvict

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `name` | `string \| string[] \| (...args) => string \| string[]` | 자동 생성 | 삭제할 네임스페이스 |
| `key` | `string \| (...args) => string` | 자동 해시 | 삭제할 키. `allEntries: true`면 무시 |
| `cacheManager` | `CacheManager` | `REDIS` | 삭제 대상 백엔드 |
| `allEntries` | `boolean` | `false` | 네임스페이스 전체 삭제 |
| `beforeInvocation` | `boolean` | `false` | 메서드 실행 전 삭제 |
| `condition` | `(...args) => boolean` | — | `false`면 삭제 건너뜀 |
| `debounceMs` | `number` | — | 지정한 시간(ms) 내 동일 키에 대한 중복 삭제 요청을 하나로 병합 |

---

## 내부 동작

### SWR + Single-flight

```
Request
   │
   ├─[Fresh]───────────────────────────────────────────► 즉시 반환
   │
   ├─[Stale]───► stale 데이터 즉시 반환
   │              └─ Background:
   │                  tryLock ──[획득]──► fetch → store → Pub/Sub notify
   │                           └[실패]── skip (다른 인스턴스가 처리 중)
   │
   └─[Miss]────► tryLock ──[획득]──► fetch → store ──────────────► 반환
                           └[실패]── Pub/Sub 대기
                                      ├─[알림 수신]──► cache 조회 ──► 반환
                                      └─[타임아웃]──► 지수 백오프 폴링
                                                       └─[최대 재시도]─► 직접 fetch
```

### 캐시 키 포맷

```
{name}::{key}          캐시 데이터
lock:{name}::{key}     분산 락
pending:{name}::{key}  Pub/Sub 채널
```

---

## 라이선스

MIT
