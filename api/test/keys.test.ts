import { describe, expect, it } from 'vitest';
import { extractApiKey, generateApiKey, hashApiKey, isWellFormedKey, safeEqual } from '../src/gateway/keys.js';

describe('api keys', () => {
  it('generates well-formed, unique, high-entropy keys', () => {
    const a = generateApiKey('live').key;
    const b = generateApiKey('live').key;
    expect(isWellFormedKey(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith('nah_live_')).toBe(true);
    expect(generateApiKey('test').key.startsWith('nah_test_')).toBe(true);
  });

  it('rejects malformed keys before any lookup', () => {
    for (const bad of ['', 'nah_live_short', 'sk_live_' + 'a'.repeat(32), 'nah_prod_' + 'a'.repeat(32), 'nah_live_' + 'a'.repeat(33)]) {
      expect(isWellFormedKey(bad)).toBe(false);
    }
  });

  it('hashes deterministically and depends on the pepper', () => {
    const { key } = generateApiKey('live');
    const pepper = 'p'.repeat(32);
    expect(hashApiKey(key, pepper)).toBe(hashApiKey(key, pepper));
    expect(hashApiKey(key, pepper)).not.toBe(hashApiKey(key, 'q'.repeat(32)));
    expect(hashApiKey(key, pepper)).not.toContain(key);
  });

  it('extracts keys from Bearer or X-API-Key', () => {
    expect(extractApiKey({ authorization: 'Bearer abc' })).toBe('abc');
    expect(extractApiKey({ authorization: 'bearer abc' })).toBe('abc');
    expect(extractApiKey({ authorization: 'Basic abc' })).toBeNull();
    expect(extractApiKey({ 'x-api-key': 'xyz' })).toBe('xyz');
    expect(extractApiKey({})).toBeNull();
  });

  it('compares secrets without length-dependent early exit', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
