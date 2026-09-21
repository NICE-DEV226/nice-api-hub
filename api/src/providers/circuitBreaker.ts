export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  /** Outcomes older than this are forgotten. */
  windowMs?: number;
  /** Don't judge a provider on fewer samples than this. */
  minVolume?: number;
  /** Open when failures / total reaches this ratio. */
  failureRatio?: number;
  /** How long to stay open before letting one probe request through. */
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Rolling-window circuit breaker (per process).
 *
 *   closed ──(failure ratio ≥ threshold)──▶ open ──(cooldown)──▶ half_open
 *      ▲                                                             │
 *      └───────────────(probe succeeds)──────────────────────────────┘
 *                       (probe fails ⇒ open again)
 *
 * In half-open state exactly one request is admitted at a time, so a recovering
 * upstream is not stampeded.
 */
export class CircuitBreaker {
  private readonly windowMs: number;
  private readonly minVolume: number;
  private readonly failureRatio: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  private outcomes: Array<{ at: number; ok: boolean }> = [];
  private openedAt = 0;
  private current: BreakerState = 'closed';
  private probing = false;

  constructor(options: BreakerOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.minVolume = options.minVolume ?? 5;
    this.failureRatio = options.failureRatio ?? 0.5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.current === 'open' && this.now() - this.openedAt >= this.cooldownMs) {
      return 'half_open';
    }
    return this.current;
  }

  /** May a request go through right now? A `true` in half-open reserves the single probe slot. */
  tryAcquire(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.probing) return false;
    this.current = 'half_open';
    this.probing = true;
    return true;
  }

  onSuccess(): void {
    if (this.current === 'half_open' || this.state === 'half_open') {
      this.current = 'closed';
      this.probing = false;
      this.outcomes = [];
      return;
    }
    this.record(true);
  }

  onFailure(): void {
    if (this.current === 'half_open' || this.state === 'half_open') {
      this.trip();
      return;
    }
    this.record(false);
    const { failures, total } = this.tally();
    if (total >= this.minVolume && failures / total >= this.failureRatio) this.trip();
  }

  /** The attempt ended without saying anything about provider health (e.g. content gone). */
  onNeutral(): void {
    this.probing = false;
  }

  private trip(): void {
    this.current = 'open';
    this.openedAt = this.now();
    this.probing = false;
  }

  private record(ok: boolean): void {
    const at = this.now();
    this.outcomes.push({ at, ok });
    const cutoff = at - this.windowMs;
    while (this.outcomes.length > 0 && this.outcomes[0]!.at < cutoff) this.outcomes.shift();
  }

  private tally(): { failures: number; total: number } {
    const cutoff = this.now() - this.windowMs;
    let failures = 0;
    let total = 0;
    for (const o of this.outcomes) {
      if (o.at < cutoff) continue;
      total++;
      if (!o.ok) failures++;
    }
    return { failures, total };
  }
}
