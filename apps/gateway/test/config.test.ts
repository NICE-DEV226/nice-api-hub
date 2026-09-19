import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  KEY_PEPPER: 'k'.repeat(32),
  ADMIN_TOKEN: 'a'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults and converts types', () => {
    const c = loadConfig({ ...base, PORT: '8080', TRUST_PROXY: 'true' });
    expect(c.PORT).toBe(8080);
    expect(c.TRUST_PROXY).toBe(true);
    expect(c.CACHE_TTL_SECONDS).toBe(600);
    expect(c.RATE_LIMIT_FAIL_MODE).toBe('open');
  });

  it('refuses to start without secrets and reports every problem at once', () => {
    try {
      loadConfig({ DATABASE_URL: 'x' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as Error).message;
      expect(msg).toContain('REDIS_URL');
      expect(msg).toContain('KEY_PEPPER');
      expect(msg).toContain('ADMIN_TOKEN');
    }
  });

  it('rejects short secrets instead of silently accepting them', () => {
    expect(() => loadConfig({ ...base, KEY_PEPPER: 'short' })).toThrow(/KEY_PEPPER/);
  });

  it('treats empty strings as unset (docker-compose ${VAR} expansion)', () => {
    expect(loadConfig({ ...base, PORT: '' }).PORT).toBe(3000);
    expect(() => loadConfig({ ...base, ADMIN_TOKEN: '' })).toThrow(/ADMIN_TOKEN/);
  });

  it('parses PROBE_URLS', () => {
    expect(loadConfig({ ...base, PROBE_URLS: '{"tiktok":"https://tiktok.com/x"}' }).probeUrls).toEqual({ tiktok: 'https://tiktok.com/x' });
    expect(() => loadConfig({ ...base, PROBE_URLS: 'nope' })).toThrow(/PROBE_URLS/);
  });
});
