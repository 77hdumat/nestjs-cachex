[English](https://github.com/77hdumat/nestjs-cachex/blob/main/README.md) | [한국어](https://github.com/77hdumat/nestjs-cachex/blob/main/README.ko.md) | **日本語**

# nestjs-cachex

[![npm version](https://img.shields.io/npm/v/nestjs-cachex)](https://npmjs.com/package/nestjs-cachex)
[![license](https://img.shields.io/npm/l/nestjs-cachex)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)](https://typescriptlang.org)

NestJS向けのデコレータベースキャッシングモジュールです。

SWR、Single-flight、msgpack + zstd、マルチレベルキャッシュをひとつのパッケージで提供します。

---

## はじめに

ほとんどのキャッシングモジュールは、キャッシュが生きている間はうまく動作します。しかしTTLが切れた瞬間、以降のリクエストはすべてDBや外部APIへ直接向かい、同時に集中するとCache Stampede問題につながります。

`nestjs-cachex`はこの問題を根本から解決します。

- **SWR** — TTLが切れても既存データを即座に返しつつ、バックグラウンドでキャッシュを更新します。
- **Single-flight** — Redisの分散ロックとPub/Subにより、同一キーへの更新を一度だけ実行します。複数インスタンス環境でも機能します。
- **マルチレベルキャッシュ** — L1（メモリ）とL2（Redis）を階層構成にし、不要なネットワークコストを排除します。

| 機能 | @nestjs/cache-manager | nestjs-cachex |
|---|---|---|
| SWR | ✗ | ✓ |
| Single-flight | ✗ | ✓ |
| 分散ロック | ✗ | ✓ |
| msgpackシリアライズ | ✗ | ✓ |
| zstd圧縮 | ✗ | ✓ |
| マルチレベルキャッシュ | ✗ | ✓ |

---

## クイックスタート

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

## 主な機能

- **デコレータベース** — `@Cacheable`、`@CacheEvict` ひとつでキャッシュロジックをビジネスコードから完全に分離
- **SWR** — キャッシュが切れてもレスポンスは即座。更新はバックグラウンドで
- **Single-flight** — 分散ロックとPub/Subにより、マルチインスタンス環境でも更新は一度だけ
- **Jitter** — TTLにランダムオフセットを加算してCache Stampede を根本的に防止
- **msgpack** — JSONの代わりにバイナリシリアライズでより小さく、より速く
- **zstd圧縮** — 閾値を超えるデータは自動的に圧縮して保存
- **マルチレベルキャッシュ** — L1ヒット時はRedisアクセスなし。L1ミス時はL2から取得してWrite-back
- **動的キー** — 固定文字列または関数でリクエストごとに異なるキーを生成
- **条件付きキャッシュ** — `condition`、`unless`で保存有無をきめ細かく制御
- **完全なTypeScriptサポート** — すべてのオプションに型推論を提供

---

## 動作環境

- Node.js 18+
- NestJS 9+
- Redis 6+ _(optional, Redis / マルチレベルキャッシュ使用時)_

---

## インストール

```bash
npm install nestjs-cachex
# または
yarn add nestjs-cachex
# または
pnpm add nestjs-cachex
```

Redisを使用する場合はioredisも合わせてインストールします。

```bash
npm install ioredis
# または
yarn add ioredis
# または
pnpm add ioredis
```

---

## 使い方

### モジュール登録

#### 静的登録

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

#### 動的登録

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
      defaultStaleMultiplier: 5, // staleTtl未指定時は ttl × 5
      pubSubTimeoutMs: 2000,
    },
    compression: {
      enabled: true,
      threshold: 20 * 1024, // 20KB以上のみ圧縮
      level: 3,
    },
  }),
})
```

#### Redisクライアントの設定

Pub/Subには専用コネクションが必要です。通常のコネクションと**必ず分離**して注入してください。

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
// SWRパターン
@Cacheable({
  ttl: 10,       // 10秒間 fresh
  staleTtl: 290, // その後290秒間 stale返却 + バックグラウンド更新
  name: 'dashboard',
  key: (userId: string) => userId,
})
async getDashboard(userId: string) { ... }

// 条件付きキャッシュ
@Cacheable({
  ttl: 60,
  name: 'items',
  condition: (id: string) => id !== 'guest', // falseならキャッシュをスキップ
  unless: (result) => result === null,        // trueなら保存しない
})
async findItem(id: string) { ... }

// マルチレベルキャッシュ
@Cacheable({ ttl: 60, name: 'hot-data', cacheManager: CacheManager.MULTI })
async getHotData(id: string) { ... }
```

### @CacheEvict

```typescript
// 特定エントリを削除
@CacheEvict({ name: 'users', key: (id: string) => id })
async updateUser(id: string, data: UpdateUserDto) { ... }

// ネームスペース全体を削除
@CacheEvict({ name: 'users', allEntries: true })
async deleteAllUsers() { ... }

// 複数ネームスペースを削除
@CacheEvict({ name: ['users', 'profiles', 'sessions'], allEntries: true })
async clearAll() { ... }

// メソッド実行前に削除
@CacheEvict({ name: 'users', allEntries: true, beforeInvocation: true })
async refreshUsers() { ... }

// debounce削除 — 短時間に同一キーへの無効化リクエストが集中する場合に有効
@CacheEvict({ name: 'reports', allEntries: true, debounceMs: 3000 })
async onDataChanged() { ... }
```

### 組み合わせ使用

```typescript
@Cacheable({ ttl: 60, name: 'user-detail', key: (id: string) => id })
@CacheEvict({ name: 'user-list', allEntries: true })
async getUser(id: string) { ... }
```

---

## API

### @Cacheable

| オプション | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `ttl` | `number` | `defaults.ttl` | キャッシュ有効時間（秒） |
| `staleTtl` | `number` | `ttl × staleMultiplier` | TTL失効後のstale維持時間（秒） |
| `swr` | `boolean` | モジュール設定 | SWR有効化override |
| `name` | `string \| (...args) => string` | 自動生成 | キャッシュネームスペース |
| `key` | `string \| (...args) => string` | 自動ハッシュ | キャッシュキー |
| `cacheManager` | `CacheManager` | `REDIS` | `REDIS` \| `MEMORY` \| `MULTI` |
| `condition` | `(...args) => boolean` | — | `false`ならキャッシュ取得/保存をスキップ |
| `unless` | `(result, ...args) => boolean` | — | `true`なら保存をスキップ |
| `compression` | `boolean \| { threshold?, level? }` | モジュール設定 | 圧縮設定override |

### @CacheEvict

| オプション | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `name` | `string \| string[] \| (...args) => string \| string[]` | 自動生成 | 削除するネームスペース |
| `key` | `string \| (...args) => string` | 自動ハッシュ | 削除するキー。`allEntries: true`なら無視 |
| `cacheManager` | `CacheManager` | `REDIS` | 削除対象バックエンド |
| `allEntries` | `boolean` | `false` | ネームスペース全体を削除 |
| `beforeInvocation` | `boolean` | `false` | メソッド実行前に削除 |
| `condition` | `(...args) => boolean` | — | `false`なら削除をスキップ |
| `debounceMs` | `number` | — | 指定した時間（ms）以内の同一キーへの重複削除リクエストを1回にまとめる |

---

## 内部動作

### SWR + Single-flight

```
Request
   │
   ├─[Fresh]───────────────────────────────────────────► 即座に返す
   │
   ├─[Stale]───► staleデータを即座に返す
   │              └─ Background:
   │                  tryLock ──[取得]──► fetch → store → Pub/Sub notify
   │                           └[失敗]── skip (他のインスタンスが処理中)
   │
   └─[Miss]────► tryLock ──[取得]──► fetch → store ──────────────► 返す
                           └[失敗]── Pub/Sub待機
                                      ├─[通知受信]──► cache取得 ──► 返す
                                      └─[タイムアウト]► ポーリング (指数バックオフ)
                                                          └─[最大リトライ]─► 直接fetch
```

### キャッシュキーフォーマット

```
{name}::{key}          キャッシュデータ
lock:{name}::{key}     分散ロック
pending:{name}::{key}  Pub/Subチャンネル
```

---

## ライセンス

MIT