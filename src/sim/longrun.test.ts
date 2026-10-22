import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './engine';

const MIN = 60_000;

/** A compact fingerprint of everything visible: logs, events, queue and stats. */
function trace(e: SimulationEngine): string {
  const logs = e.agents.map((a) => a.id + ':' + a.log.toArray().map((l) => `${l.t.toFixed(3)}|${l.tag}|${l.text}`).join('\n'));
  const events = e.events.toArray().map((x) => `${x.t.toFixed(3)}|${x.text}`);
  return JSON.stringify({ stats: e.stats, queue: e.queue.map((t) => t.key + t.title), logs, events, load: e.load });
}

describe('determinism', () => {
  it('replays identically for the same seed, regardless of step size', () => {
    const a = new SimulationEngine({ seed: 1234, agents: 40 });
    const b = new SimulationEngine({ seed: 1234, agents: 40 });
    for (let t = 0; t < 30 * MIN; t += 100) a.advance(100);
    for (let t = 0; t < 30 * MIN; t += 7_300) b.advance(Math.min(7_300, 30 * MIN - t));
    expect(b.now).toBe(a.now);
    expect(trace(b)).toBe(trace(a));
  });

  it('differs between seeds', () => {
    const a = new SimulationEngine({ seed: 1 });
    const b = new SimulationEngine({ seed: 2 });
    a.advance(5 * MIN);
    b.advance(5 * MIN);
    expect(trace(a)).not.toBe(trace(b));
  });
});

describe('24-hour soak (simulated)', () => {
  it('keeps every collection bounded and the KPIs consistent', () => {
    const e = new SimulationEngine({ seed: 99, agents: 50 });
    let maxHeap = 0;
    for (let hour = 0; hour < 24; hour++) {
      for (let m = 0; m < 60; m++) {
        e.advance(MIN);
        maxHeap = Math.max(maxHeap, e.pendingEvents());
      }
      expect(e.queue.length).toBeLessThanOrEqual(e.cfg.maxQueue);
      expect(e.running.size).toBeLessThanOrEqual(e.agents.length);
      expect(e.recent.length).toBeLessThanOrEqual(e.cfg.recentLimit);
      expect(e.history.length).toBeLessThanOrEqual(e.cfg.historySize);
      expect(e.events.length).toBeLessThanOrEqual(40);
      for (const a of e.agents) expect(a.log.length).toBeLessThanOrEqual(e.cfg.logBuffer);
      const { created, completed, failed } = e.stats;
      expect(created).toBe(e.queue.length + e.running.size + completed + failed);
    }
    // One live step per agent, at most one superseded timeout per agent (an early wake-up
    // leaves the old subtask timer in the heap until it pops), plus a few global timers.
    expect(maxHeap).toBeLessThanOrEqual(e.agents.length * 2 + 10);
    expect(e.transitionErrors).toBe(0);
    expect(e.stats.completed).toBeGreaterThan(50_000);
    expect(e.throughput()).toBeGreaterThan(0);
  }, 120_000);
});
