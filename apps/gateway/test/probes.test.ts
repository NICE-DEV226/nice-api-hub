import { describe, expect, it } from 'vitest';
import { platformStatus } from '../src/probes.js';

const ok = { ok: true, latencyMs: 1, error: null, at: '' };
const bad = { ok: false, latencyMs: 1, error: 'timeout', at: '' };

describe('platformStatus', () => {
  it('is unknown with nothing measured', () => {
    expect(platformStatus([{ circuit: 'closed', probe: null }])).toBe('unknown');
    expect(platformStatus([])).toBe('unknown');
  });
  it('is operational when providers are healthy', () => {
    expect(platformStatus([{ circuit: 'closed', probe: ok }])).toBe('operational');
  });
  it('is degraded when only some providers are usable', () => {
    expect(platformStatus([{ circuit: 'closed', probe: ok }, { circuit: 'open', probe: ok }])).toBe('degraded');
    expect(platformStatus([{ circuit: 'closed', probe: ok }, { circuit: 'closed', probe: bad }])).toBe('degraded');
  });
  it('is down when none is usable', () => {
    expect(platformStatus([{ circuit: 'open', probe: ok }, { circuit: 'closed', probe: bad }])).toBe('down');
  });
});
