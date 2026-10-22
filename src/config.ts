import { randomSeed } from './sim/prng';

export type Density = 'low' | 'normal' | 'high';

export interface AppConfig {
  agents: number;
  seed: number;
  /** Simulated seconds per real second. */
  speed: number;
  density: Density;
  panels: number;
  panelCols: number;
  /** Simulated time run before the first frame so panels open with content. */
  warmupMs: number;
}

const PANELS: Record<Density, { panels: number; cols: number }> = {
  low: { panels: 4, cols: 2 },
  normal: { panels: 6, cols: 2 },
  high: { panels: 9, cols: 3 },
};

export function defaultConfig(): AppConfig {
  return {
    agents: 30,
    seed: randomSeed(),
    speed: 1,
    density: 'normal',
    panels: PANELS.normal.panels,
    panelCols: PANELS.normal.cols,
    warmupMs: 20_000,
  };
}
