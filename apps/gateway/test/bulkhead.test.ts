import { describe, expect, it } from 'vitest';
import { Bulkhead, BulkheadRejected } from '../src/providers/bulkhead.js';

const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

describe('Bulkhead', () => {
  it('never exceeds max concurrency and queues the rest', async () => {
    const bh = new Bulkhead(2, 10);
    let running = 0;
    let peak = 0;
    const g = gate();
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await g.p;
      running--;
    };
    const all = Promise.all(Array.from({ length: 6 }, () => bh.run(task)));
    await new Promise((r) => setTimeout(r, 20));
    expect(bh.inFlight).toBe(2);
    expect(bh.queued).toBe(4);
    g.open();
    await all;
    expect(peak).toBe(2);
    expect(bh.inFlight).toBe(0);
  });

  it('rejects immediately when the queue is full', async () => {
    const bh = new Bulkhead(1, 1);
    const g = gate();
    const a = bh.run(() => g.p);
    const b = bh.run(() => g.p);
    await expect(bh.run(async () => 1)).rejects.toMatchObject({ reason: 'queue_full' });
    g.open();
    await Promise.all([a, b]);
  });

  it('rejects a waiter that waits too long', async () => {
    const bh = new Bulkhead(1, 5, 30);
    const g = gate();
    const a = bh.run(() => g.p);
    await expect(bh.run(async () => 1)).rejects.toBeInstanceOf(BulkheadRejected);
    g.open();
    await a;
  });

  it('releases the slot when a task throws', async () => {
    const bh = new Bulkhead(1, 0);
    await expect(bh.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(bh.run(async () => 'ok')).resolves.toBe('ok');
  });
});
