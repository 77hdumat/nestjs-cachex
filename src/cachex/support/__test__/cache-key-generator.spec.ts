import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import type { CacheableOption, CacheEvictOption, CacheKeyContext } from '../../core';
import { CacheKeyGenerator } from '../cache-key-generator';

describe('CacheKeyGenerator', () => {
  let keyGenerator: CacheKeyGenerator;

  class TestService {
    testMethod() {}
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheKeyGenerator],
    }).compile();

    keyGenerator = module.get<CacheKeyGenerator>(CacheKeyGenerator);
  });

  it('init', () => {
    expect(keyGenerator).toBeDefined();
  });

  describe('generateCacheableKey', () => {
    let target: TestService;
    const methodName = 'testMethod';
    const className = 'TestService';

    beforeEach(() => {
      target = new TestService();
    });

    it('should return an auto-generated key when name and key are absent', () => {
      const option: CacheableOption = { ttl: 60 };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe(`${className}:${methodName}`);
    });

    it('should return "name::auto-key" when only name is set', () => {
      const option: CacheableOption = { ttl: 60, name: 'users' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe(`users::${className}:${methodName}`);
    });

    it('should return the explicit key when only key is set', () => {
      const option: CacheableOption = { ttl: 60, key: 'custom-key' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('custom-key');
    });

    it('should return "name::key" when both name and key are set', () => {
      const option: CacheableOption = { ttl: 60, name: 'users', key: 'user-123' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('users::user-123');
    });

    it('should evaluate the name function with args', () => {
      const option: CacheableOption = {
        ttl: 60,
        name: (id: string) => `user-${id}`,
        key: 'profile',
      };
      const context: CacheKeyContext = { target, methodName, args: ['123'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('user-123::profile');
    });

    it('should evaluate the key function with args', () => {
      const option: CacheableOption = {
        ttl: 60,
        name: 'users',
        key: (id: string) => `user-${id}`,
      };
      const context: CacheKeyContext = { target, methodName, args: ['456'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('users::user-456');
    });

    it('should return "ClassName:methodName:value" for a single primitive argument', () => {
      const option: CacheableOption = { ttl: 60 };
      const context: CacheKeyContext = { target, methodName, args: ['hello'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe(`${className}:${methodName}:hello`);
    });

    it('should return a hashed key for multiple arguments', () => {
      const option: CacheableOption = { ttl: 60 };
      const context: CacheKeyContext = { target, methodName, args: ['a', 'b', 'c'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toMatch(new RegExp(`^${className}:${methodName}:[a-f0-9]+$`));
    });

    it('should return the same key for identical arguments', () => {
      const option: CacheableOption = { ttl: 60 };
      const context1: CacheKeyContext = { target, methodName, args: [{ a: 1 }] };
      const context2: CacheKeyContext = { target, methodName, args: [{ a: 1 }] };

      const result1 = keyGenerator.generateCacheableKey(option, context1);
      const result2 = keyGenerator.generateCacheableKey(option, context2);

      expect(result1).toBe(result2);
    });
  });

  describe('generateEvictKeys', () => {
    let target: TestService;
    const methodName = 'testMethod';

    beforeEach(() => {
      target = new TestService();
    });

    it('should return the "name::" pattern when allEntries is true', () => {
      const option: CacheEvictOption = { name: 'users', allEntries: true };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::']);
    });

    it('should return multiple patterns when allEntries is true and name is an array', () => {
      const option: CacheEvictOption = { name: ['users', 'profiles'], allEntries: true };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::', 'profiles::']);
    });

    it('should return "name::key" when allEntries is false', () => {
      const option: CacheEvictOption = { name: 'users', key: 'user-123' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::user-123']);
    });

    it('should generate a key for each entry when name is an array', () => {
      const option: CacheEvictOption = { name: ['users', 'profiles'], key: 'id-123' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::id-123', 'profiles::id-123']);
    });

    it('should evaluate the name function with args', () => {
      const option: CacheEvictOption = {
        name: (id: string) => `user-${id}`,
        key: 'profile',
      };
      const context: CacheKeyContext = { target, methodName, args: ['789'] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['user-789::profile']);
    });

    it('should return only the key when name is absent and allEntries is false', () => {
      const option: CacheEvictOption = { key: 'standalone-key' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['standalone-key']);
    });
  });
});
