import { describe, expect, it } from 'vitest';
import { matrixLevel, parseConfig, parseMatrix } from './config';

describe('parseConfig', () => {
  it('uses defaults without parameters', () => {
    const c = parseConfig('');
    expect(c.agents).toBe(30);
    expect(c.speed).toBe(1);
    expect(c.density).toBe('normal');
    expect(c.panels).toBe(6);
    expect(c.fixedSeed).toBe(false);
    expect(c.seed).toBeGreaterThan(0);
    expect(c.eggMinutes).toBe(60);
    expect(parseConfig('?egg=0').eggMinutes).toBe(0);
  });

  it('reads the documented parameters', () => {
    const c = parseConfig('?agents=40&seed=1234&speed=1.5&density=high');
    expect(c).toMatchObject({ agents: 40, seed: 1234, fixedSeed: true, speed: 1.5, density: 'high', panels: 9 });
  });

  it('clamps and ignores bad values instead of failing', () => {
    const c = parseConfig('?agents=5000&speed=abc&density=huge&seed=-3');
    expect(c.agents).toBe(100);
    expect(c.speed).toBe(1);
    expect(c.density).toBe('normal');
    expect(c.seed).toBeGreaterThan(0);
  });
});

describe('matrix parameter', () => {
  const MIN = 60_000;

  it('parses RAMP[,HOLD][:MAX]', () => {
    expect(parseMatrix('5')).toEqual({ rampMs: 5 * MIN, holdMs: null, max: 1 });
    expect(parseMatrix('5,5')).toEqual({ rampMs: 5 * MIN, holdMs: 5 * MIN, max: 1 });
    expect(parseMatrix('5:90')).toEqual({ rampMs: 5 * MIN, holdMs: null, max: 0.9 });
    expect(parseMatrix('0.5,2:80')).toEqual({ rampMs: 0.5 * MIN, holdMs: 2 * MIN, max: 0.8 });
    expect(parseMatrix(null)).toBeNull();
    expect(parseMatrix('abc')).toBeNull();
    expect(parseMatrix('5:0')).toBeNull();
    expect(parseConfig('?matrix=5,5:90&view=console')).toMatchObject({ view: 'console', matrix: { max: 0.9 } });
  });

  it('ramps smoothly and stays at max without a hold', () => {
    const spec = parseMatrix('5:90')!;
    expect(matrixLevel(spec, 0).level).toBe(0);
    expect(matrixLevel(spec, 2.5 * MIN).level).toBeCloseTo(0.45);
    expect(matrixLevel(spec, 5 * MIN).level).toBeCloseTo(0.9);
    expect(matrixLevel(spec, 500 * MIN)).toEqual({ level: 0.9, cycle: 0 });
  });

  it('holds and then restarts the cycle', () => {
    const spec = parseMatrix('5,5')!;
    expect(matrixLevel(spec, 7 * MIN)).toEqual({ level: 1, cycle: 0 });
    const restarted = matrixLevel(spec, 10 * MIN + 1);
    expect(restarted.cycle).toBe(1);
    expect(restarted.level).toBeLessThan(0.001);
  });
});
