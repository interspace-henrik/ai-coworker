import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './engine';
import { ACTIVE_STATES } from './types';

const MIN = 60_000;

describe('SimulationEngine', () => {
  it('has several agents working within 10 seconds', () => {
    const e = new SimulationEngine({ seed: 7, agents: 30 });
    e.advance(10_000);
    expect(e.activeAgents()).toBeGreaterThanOrEqual(10);
    const withLogs = e.agents.filter((a) => a.log.length > 0).length;
    expect(withLogs).toBeGreaterThanOrEqual(10);
  });

  it('only makes legal state transitions', () => {
    const e = new SimulationEngine({ seed: 11 });
    e.advance(30 * MIN);
    expect(e.transitionErrors).toBe(0);
  });

  it('keeps task accounting consistent with the KPIs', () => {
    const e = new SimulationEngine({ seed: 3 });
    for (let i = 0; i < 200; i++) {
      e.advance(5_000);
      const { created, completed, failed } = e.stats;
      expect(created).toBe(e.queue.length + e.running.size + completed + failed);
      // Every running task belongs to exactly one agent that holds it.
      const held = e.agents.filter((a) => a.task && a.task.status === 'running').length;
      expect(held).toBe(e.running.size);
      expect(e.activeAgents()).toBe(e.agents.filter((a) => ACTIVE_STATES.has(a.state)).length);
    }
    expect(e.stats.completed).toBeGreaterThan(100);
  });

  it('counts throughput over the last 60 simulated seconds only', () => {
    const e = new SimulationEngine({ seed: 5 });
    e.advance(10 * MIN);
    const tp = e.throughput();
    expect(tp).toBeGreaterThan(0);
    expect(tp).toBeLessThanOrEqual(e.stats.completed + e.stats.failed);
  });

  it('respects the queue cap and per-agent log buffer', () => {
    const e = new SimulationEngine({ seed: 9, maxQueue: 12, logBuffer: 20 });
    for (let i = 0; i < 120; i++) {
      e.advance(10_000);
      expect(e.queue.length).toBeLessThanOrEqual(12);
      for (const a of e.agents) expect(a.log.length).toBeLessThanOrEqual(20);
    }
  });
});

describe('Phase 2 behaviour', () => {
  it('produces occasional retries, failures and subtasks without them dominating', () => {
    const e = new SimulationEngine({ seed: 21 });
    e.advance(120 * MIN);
    const done = e.stats.completed + e.stats.failed;
    expect(e.transitionErrors).toBe(0);
    expect(e.stats.retries).toBeGreaterThan(0);
    expect(e.stats.subtasks).toBeGreaterThan(0);
    expect(e.stats.retries / done).toBeLessThan(0.2);
    expect(e.stats.failed / done).toBeLessThan(0.06);
    expect(e.successRate()).toBeGreaterThan(0.94);
  });

  it('keeps a rolling five-minute history', () => {
    const e = new SimulationEngine({ seed: 4 });
    e.advance(20 * MIN);
    expect(e.history.length).toBe(e.cfg.historySize);
    const first = e.history.get(0);
    const last = e.history.fromEnd(0);
    expect(last.t - first.t).toBeLessThanOrEqual(5 * MIN);
    expect(last.t - first.t).toBeGreaterThan(4.9 * MIN);
  });

  it('moves the load level over time', () => {
    const e = new SimulationEngine({ seed: 8 });
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      e.advance(MIN);
      seen.push(e.load);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.2);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });

  it('never leaves a parent waiting forever', () => {
    const e = new SimulationEngine({ seed: 13 });
    for (let i = 0; i < 240; i++) {
      e.advance(15_000);
      for (const a of e.agents) {
        if (a.waiting) expect(e.now - a.stateSince).toBeLessThan(10 * MIN);
      }
    }
  });
});
