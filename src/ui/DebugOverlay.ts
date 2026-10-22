import type { AppConfig } from '../config';
import type { SimulationEngine } from '../sim/engine';
import { el, fmtUptime, setText } from './dom';

/** Diagnostics shown with ?debug=1: seed, simulated time, tick cost and resource counters. */
export class DebugOverlay {
  readonly el = el('div', 'debug');
  private lastUpdate = 0;
  private tickCost = 0;

  update(engine: SimulationEngine, cfg: AppConfig, tickMs: number): void {
    this.tickCost = this.tickCost * 0.9 + tickMs * 0.1;
    const now = performance.now();
    if (now - this.lastUpdate < 1000) return;
    this.lastUpdate = now;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    setText(
      this.el,
      [
        'seed ' + engine.cfg.seed + (cfg.fixedSeed ? ' (fixed)' : ''),
        'sim ' + fmtUptime(engine.now) + ' ×' + cfg.speed,
        'tick ' + this.tickCost.toFixed(2) + ' ms',
        'events ' + engine.pendingEvents(),
        'dom ' + document.getElementsByTagName('*').length,
        mem ? 'heap ' + (mem.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : '',
      ]
        .filter(Boolean)
        .join('  ·  '),
    );
  }
}
