import { Injectable } from '@nestjs/common';
import { pack } from 'msgpackr';
import * as XXH from 'xxhashjs';

import type { CacheableOption, CacheEvictOption, CacheKeyContext } from '../core';

@Injectable()
export class CacheKeyGenerator {
  /** Generates a cache key for @Cacheable. */
  generateCacheableKey(option: CacheableOption, context: CacheKeyContext): string {
    const { name } = option;

    const namespace = name
      ? typeof name === 'function'
        ? name(...context.args)
        : name
      : undefined;
    const key = this.resolveKey(option.key, context);

    return namespace ? `${namespace}::${key}` : key;
  }

  /** Generates cache keys for @CacheEvict. */
  generateEvictKeys(option: CacheEvictOption, context: CacheKeyContext): string[] {
    const { name } = option;

    const namespaces = name
      ? (() => {
          const resolved = typeof name === 'function' ? name(...context.args) : name;
          return Array.isArray(resolved) ? resolved.filter(Boolean) : [resolved];
        })()
      : [];

    if (option.allEntries) {
      return namespaces.map((ns) => `${ns}::`);
    }

    const key = this.resolveKey(option.key, context);

    return namespaces.length === 0 ? [key] : namespaces.map((ns) => `${ns}::${key}`);
  }

  private resolveKey(
    resolver: string | ((...args: any[]) => string) | undefined,
    context: CacheKeyContext,
  ): string {
    if (resolver) {
      const resolved = typeof resolver === 'function' ? resolver(...context.args) : resolver;

      if (resolved) {
        return resolved;
      }
    }

    return this.generateAutoKey(context);
  }

  /** Auto-generates a key as ClassName:methodName or ClassName:methodName:arg or ClassName:methodName:hash. */
  private generateAutoKey(context: CacheKeyContext): string {
    const { target, methodName, args } = context;
    const className = target?.constructor?.name;
    const prefix = className ? `${className}:${methodName}` : methodName;

    if (args.length === 0) {
      return prefix;
    }

    if (args.length === 1) {
      const arg = args[0];

      if (this.isPrimitive(arg)) {
        return `${prefix}:${arg}`;
      }
    }

    return this.generateHashedKey(prefix, args);
  }

  private isPrimitive(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  /** Serializes args with MessagePack then hashes with xxHash for a compact, fast key. */
  private generateHashedKey(prefix: string, args: any[]): string {
    const packedBuffer = pack(args);
    const hash = XXH.h32(packedBuffer, 0x654c6162).toString(16);

    return `${prefix}:${hash}`;
  }
}
