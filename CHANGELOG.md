## [1.1.1](https://github.com/77hdumat/nestjs-cachex/compare/v1.1.0...v1.1.1) (2026-03-30)


### Bug Fixes

*  package.json의 main/types가 존재하지 않는 dist/cachex/index.*를 가리키고 있는 문제 조치 ([ab4a605](https://github.com/77hdumat/nestjs-cachex/commit/ab4a6054f51b21e291a82a9c7a7d5aea4df49fd8))

# [1.1.0](https://github.com/77hdumat/nestjs-cachex/compare/v1.0.0...v1.1.0) (2026-03-30)


### Features

* @CacheEvict에 debounceMs 옵션 추가 ([1543123](https://github.com/77hdumat/nestjs-cachex/commit/15431231811f31325a7fefbabad25800e5f84654))

# 1.0.0 (2026-03-30)


### Features

* @Cacheable/@CacheEvict 데코레이터 및 AOP 구현 ([687c087](https://github.com/77hdumat/nestjs-cachex/commit/687c0875eb497c1aa6bbc242ff7a9364b6804c32))
* SWR cache operations 및 모듈 구성 ([e957d77](https://github.com/77hdumat/nestjs-cachex/commit/e957d778e348c58a2f85482e28793efe30fe0646))
* 캐시 core 타입 및 인터페이스 정의 ([a25d7f2](https://github.com/77hdumat/nestjs-cachex/commit/a25d7f2555c70ed834d1c58cbc486a21e0360ec9))
* 캐시 유틸리티 구현 (압축, sleep) ([bfb3c52](https://github.com/77hdumat/nestjs-cachex/commit/bfb3c52773195f90fd4f59e0d87e422688094053))
* 캐시 프로바이더 구현 (Memory / Redis / Multi) ([3994831](https://github.com/77hdumat/nestjs-cachex/commit/399483130c5d411740bf79eb441d954b8aa9e46f))
