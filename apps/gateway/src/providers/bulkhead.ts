/** Thrown when the queue is full or a waiter timed out: shed load instead of piling up. */
export class BulkheadRejected extends Error {
  constructor(readonly reason: 'queue_full' | 'queue_timeout') {
    super(`bulkhead rejected: ${reason}`);
    this.name = 'BulkheadRejected';
  }
}

/**
 * Caps concurrent calls to one provider. Without it, a slow upstream soaks up every
 * socket and the whole gateway stalls; with it, only that provider degrades, and it
 * protects the upstream from being hammered (and banning us).
 */
export class Bulkhead {
  private active = 0;
  private readonly waiters: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
    private readonly queueTimeoutMs = 2_000,
  ) {}

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(new BulkheadRejected('queue_full'));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new BulkheadRejected('queue_timeout'));
        }, this.queueTimeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(); // hand the slot straight to the next waiter
    } else {
      this.active--;
    }
  }
}
