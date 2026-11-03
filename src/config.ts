import { randomSeed } from './sim/prng';

export type Density = 'low' | 'normal' | 'high';
export type ViewKind = 'dashboard' | 'console';

/** ?matrix=RAMP[,HOLD][:MAX] — minutes to glide over, optional minutes to hold before restarting, max %. */
export interface MatrixSpec {
  rampMs: number;
  /** Time at full level before a glitch resets to the dashboard and the cycle restarts; null = stay. */
  holdMs: number | null;
  /** Level reached at the end of the ramp, 0..1. 1 means nothing but the rain. */
  max: number;
}

export interface AppConfig {
  view: ViewKind;
  matrix: MatrixSpec | null;
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
  /** Minutes between "Shall we play a game?" interludes (0 = never). */
  eggMinutes: number;
}

const PANELS: Record<Density, { panels: number; cols: number }> = {
  low: { panels: 4, cols: 2 },
  normal: { panels: 6, cols: 2 },
  high: { panels: 9, cols: 3 },
};

export function parseMatrix(raw: string | null): MatrixSpec | null {
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?(?::(\d+(?:\.\d+)?))?$/.exec(raw.trim());
  if (!m) return null;
  const max = m[3] === undefined ? 1 : Math.min(100, Number(m[3])) / 100;
  if (max <= 0) return null;
  return {
    rampMs: Number(m[1]) * 60_000,
    holdMs: m[2] === undefined ? null : Number(m[2]) * 60_000,
    max,
  };
}

/**
 * Matrix level at a given time since start, with smoothstep easing so the change creeps in
 * and settles gently. `cycle` increments each time a held cycle restarts.
 */
export function matrixLevel(spec: MatrixSpec, elapsedMs: number): { level: number; cycle: number } {
  let t = Math.max(0, elapsedMs);
  let cycle = 0;
  if (spec.holdMs !== null) {
    const period = spec.rampMs + spec.holdMs;
    if (period > 0) {
      cycle = Math.floor(t / period);
      t -= cycle * period;
    }
  }
  const p = spec.rampMs > 0 ? Math.min(1, t / spec.rampMs) : 1;
  return { level: p * p * (3 - 2 * p) * spec.max, cycle };
}

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
    view: params.get('view') === 'console' ? 'console' : 'dashboard',
    matrix: parseMatrix(params.get('matrix')),
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
    eggMinutes: num(params, 'egg', 60, 0, 24 * 60),
  };
}
