# nestjs-cachex

A decorator-based caching module for NestJS.

SWR, Single-flight, msgpack + zstd, and multi-level cache — all in one package.

---

## Introduction

Most caching modules work well as long as the cache is alive. The moment TTL expires, every subsequent request hits the DB or external API directly, and under load, this leads to Cache Stampede.

`nestjs-cachex` solves this at the root.

- **SWR** — Even after TTL expires, the stale data is returned immediately while the cache is refreshed in the background.
- **Single-flight** — A Redis distributed lock and Pub/Sub ensure that only one refresh runs per key, even across multiple instances.
- **Multi-level cache** — L1 (in-memory) and L2 (Redis) in a layered structure, eliminating unnecessary network overhead.

---

## Quick Start

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

## Features

- **Decorator-based** — Separate caching logic from business code entirely with `@Cacheable` and `@CacheEvict`
- **SWR** — Instant response even on cache expiry. Revalidation happens in the background
- **Single-flight** — Distributed lock + Pub/Sub guarantees a single refresh per key, even across instances
- **Jitter** — Random TTL offset prevents synchronized expiration and Cache Stampede
- **msgpack** — Binary serialization instead of JSON — smaller payload, faster throughput
- **zstd compression** — Data exceeding the threshold is compressed automatically
- **Multi-level cache** — L1 hit skips Redis entirely. L1 miss falls through to L2 with Write-back
- **Dynamic keys** — Generate keys from a static string or a function per request
- **Conditional caching** — Fine-grained control with `condition` and `unless`
- **Full TypeScript support** — Type inference on all options

---

## Installation

```bash
npm install nestjs-cachex
# or
yarn add nestjs-cachex
```

If you're using Redis, install ioredis as well.

```bash
npm install ioredis
```

---

## Usage

### Module Registration

#### Static registration

```typescript
import { SwrCacheModule, CacheManager } from 'nestjs-cachex';

@Module({
  imports: [
    SwrCacheModule.forRoot({
      defaults: {
        ttl: 300,
        cacheManager: CacheManager.REDIS,
      },
    }),
  ],
})
export class AppModule {}
```

#### Async registration

```typescript
SwrCacheModule.forRootAsync({
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
      defaultStaleMultiplier: 5, // ttl × 5 when staleTtl is not set
      pubSubTimeoutMs: 2000,
    },
    compression: {
      enabled: true,
      threshold: 20 * 1024, // compress only if >= 20KB
      level: 3,
    },
  }),
})
```

#### Redis client setup

Pub/Sub requires a dedicated connection. Make sure to inject it separately from the main connection.

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
// SWR pattern
@Cacheable({
  ttl: 10,       // fresh for 10s
  staleTtl: 290, // serve stale for 290s + background refresh
  name: 'dashboard',
  key: (userId: string) => userId,
})
async getDashboard(userId: string) { ... }

// Conditional caching
@Cacheable({
  ttl: 60,
  name: 'items',
  condition: (id: string) => id !== 'guest', // skip cache if false
  unless: (result) => result === null,        // skip storing if true
})
async findItem(id: string) { ... }

// Multi-level cache
@Cacheable({ ttl: 60, name: 'hot-data', cacheManager: CacheManager.MULTI })
async getHotData(id: string) { ... }
```

### @CacheEvict

```typescript
// Evict a specific entry
@CacheEvict({ name: 'users', key: (id: string) => id })
async updateUser(id: string, data: UpdateUserDto) { ... }

// Evict entire namespace
@CacheEvict({ name: 'users', allEntries: true })
async deleteAllUsers() { ... }

// Evict multiple namespaces
@CacheEvict({ name: ['users', 'profiles', 'sessions'], allEntries: true })
async clearAll() { ... }

// Evict before method execution
@CacheEvict({ name: 'users', allEntries: true, beforeInvocation: true })
async refreshUsers() { ... }
```

### Combined usage

```typescript
@Cacheable({ ttl: 60, name: 'user-detail', key: (id: string) => id })
@CacheEvict({ name: 'user-list', allEntries: true })
async getUser(id: string) { ... }
```

---

## API

### @Cacheable

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ttl` | `number` | `defaults.ttl` | Cache TTL in seconds |
| `staleTtl` | `number` | `ttl × staleMultiplier` | Stale window after TTL expires (seconds) |
| `swr` | `boolean` | module config | SWR enabled override |
| `name` | `string \| (...args) => string` | auto-generated | Cache namespace |
| `key` | `string \| (...args) => string` | auto-hash | Cache key |
| `cacheManager` | `CacheManager` | `REDIS` | `REDIS` \| `MEMORY` \| `MULTI` |
| `condition` | `(...args) => boolean` | — | Skip cache lookup/store if `false` |
| `unless` | `(result, ...args) => boolean` | — | Skip storing if `true` |
| `compression` | `boolean \| { threshold?, level? }` | module config | Compression override |

### @CacheEvict

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string \| string[] \| (...args) => string \| string[]` | auto-generated | Namespace(s) to evict |
| `key` | `string \| (...args) => string` | auto-hash | Key to evict. Ignored if `allEntries: true` |
| `cacheManager` | `CacheManager` | `REDIS` | Target backend |
| `allEntries` | `boolean` | `false` | Evict entire namespace |
| `beforeInvocation` | `boolean` | `false` | Evict before method execution |
| `condition` | `(...args) => boolean` | — | Skip eviction if `false` |

---

## How It Works

### SWR + Single-flight

Fresh cache is returned immediately. Once stale, the existing data is returned right away while a background task acquires a Redis distributed lock and starts revalidation. Instances that fail to acquire the lock wait for a Pub/Sub completion signal, falling back to exponential backoff polling on timeout. If staleTtl also expires, a synchronous refresh is performed before returning.

### Cache Key Format

```
{name}::{key}          cache data
lock:{name}::{key}     distributed lock
pending:{name}::{key}  Pub/Sub channel
```

---

## License

MIT
