import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

describe('parseConfig', () => {
  it('uses defaults without parameters', () => {
    const c = parseConfig('');
    expect(c.agents).toBe(30);
    expect(c.speed).toBe(1);
    expect(c.density).toBe('normal');
    expect(c.panels).toBe(6);
    expect(c.fixedSeed).toBe(false);
    expect(c.seed).toBeGreaterThan(0);
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
