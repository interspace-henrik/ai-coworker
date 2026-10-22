import { randomSeed } from './sim/prng';

export type Density = 'low' | 'normal' | 'high';

export interface AppConfig {
  agents: number;
  seed: number;
  /** True when the seed came from the URL (reproducible run). */
  fixedSeed: boolean;
  /** Simulated seconds per real second. */
  speed: number;
  density: Density;
  panels: number;
  panelCols: number;
  /** Simulated time run before the first frame so panels open with content. */
  warmupMs: number;
  /** Show the diagnostics overlay. */
  debug: boolean;
  /** Reload the page after this many hours (0 = never). Optional extra safety for 24/7 screens. */
  reloadHours: number;
}

const PANELS: Record<Density, { panels: number; cols: number }> = {
  low: { panels: 4, cols: 2 },
  normal: { panels: 6, cols: 2 },
  high: { panels: 9, cols: 3 },
};

function num(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Reads configuration from the query string, e.g. ?agents=40&seed=1234&speed=1.5&density=high.
 * Invalid values fall back to defaults and out-of-range values are clamped, so a typo on the
 * kiosk never blanks the screen.
 */
export function parseConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const seedParam = num(params, 'seed', 0, 1, 0x7fffffff);
  const rawDensity = params.get('density');
  const density: Density = rawDensity === 'low' || rawDensity === 'high' ? rawDensity : 'normal';
  const flag = params.get('debug');
  return {
    agents: Math.round(num(params, 'agents', 30, 8, 100)),
    seed: seedParam ? Math.floor(seedParam) : randomSeed(),
    fixedSeed: seedParam > 0,
    speed: num(params, 'speed', 1, 0.1, 100),
    density,
    panels: PANELS[density].panels,
    panelCols: PANELS[density].cols,
    warmupMs: 20_000,
    debug: flag !== null && flag !== '0' && flag !== 'false',
    reloadHours: num(params, 'reload', 0, 0, 24 * 30),
  };
}
