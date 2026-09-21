import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/providers/circuitBreaker.js';

function make() {
  let t = 1_000_000;
  const breaker = new CircuitBreaker({ minVolume: 4, failureRatio: 0.5, cooldownMs: 10_000, windowMs: 60_000, now: () => t });
  return { breaker, advance: (ms: number) => (t += ms) };
}

describe('CircuitBreaker', () => {
  it('stays closed below the minimum volume', () => {
    const { breaker } = make();
    for (let i = 0; i < 3; i++) breaker.onFailure();
    expect(breaker.state).toBe('closed');
  });

  it('opens once the failure ratio is reached with enough volume', () => {
    const { breaker } = make();
    breaker.onSuccess();
    breaker.onSuccess();
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.state).toBe('open');
    expect(breaker.tryAcquire()).toBe(false);
  });

  it('does not open when failures are a minority', () => {
    const { breaker } = make();
    for (let i = 0; i < 8; i++) breaker.onSuccess();
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.state).toBe('closed');
  });

  it('goes half-open after the cooldown and admits exactly one probe', () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 4; i++) breaker.onFailure();
    expect(breaker.state).toBe('open');
    advance(10_000);
    expect(breaker.state).toBe('half_open');
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(false); // second caller is turned away while the probe runs
  });

  it('closes again when the probe succeeds, and forgets old failures', () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 4; i++) breaker.onFailure();
    advance(10_000);
    breaker.tryAcquire();
    breaker.onSuccess();
    expect(breaker.state).toBe('closed');
    breaker.onFailure();
    expect(breaker.state).toBe('closed'); // history was cleared
  });

  it('re-opens (with a fresh cooldown) when the probe fails', () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 4; i++) breaker.onFailure();
    advance(10_000);
    breaker.tryAcquire();
    breaker.onFailure();
    expect(breaker.state).toBe('open');
    advance(5_000);
    expect(breaker.state).toBe('open');
    advance(5_000);
    expect(breaker.state).toBe('half_open');
  });

  it('a neutral outcome frees the probe slot without changing health', () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 4; i++) breaker.onFailure();
    advance(10_000);
    expect(breaker.tryAcquire()).toBe(true);
    breaker.onNeutral();
    expect(breaker.tryAcquire()).toBe(true);
  });

  it('forgets outcomes older than the window', () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 3; i++) breaker.onFailure();
    advance(61_000);
    breaker.onFailure(); // only 1 sample now, below minVolume
    expect(breaker.state).toBe('closed');
  });
});
