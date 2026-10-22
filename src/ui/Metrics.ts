import type { SimulationEngine } from '../sim/engine';
import { formatInt } from '../sim/template';
import { el, setText } from './dom';

interface Tile {
  value: HTMLElement;
  sub: HTMLElement;
}

export class Metrics {
  readonly el = el('div', 'kpis');
  private tiles: Record<string, Tile> = {};

  constructor(private engine: SimulationEngine) {
    this.tile('active', 'Active agents');
    this.tile('completed', 'Tasks completed');
    this.tile('queue', 'Queue depth');
    this.tile('success', 'Success rate');
    this.tile('throughput', 'Throughput');
    this.tile('retries', 'Retries');
  }

  private tile(key: string, label: string): void {
    const root = el('div', 'kpi kpi-' + key);
    const value = el('div', 'kpi-v', '0');
    const sub = el('div', 'kpi-s');
    root.append(el('div', 'kpi-k', label), value, sub);
    this.el.append(root);
    this.tiles[key] = { value, sub };
  }

  update(): void {
    const e = this.engine;
    const t = this.tiles;
    setText(t.active.value, String(e.activeAgents()));
    setText(t.active.sub, 'of ' + e.agents.length + ' agents');
    setText(t.completed.value, formatInt(e.stats.completed));
    setText(t.completed.sub, formatInt(e.stats.failed) + ' failed');
    setText(t.queue.value, String(e.queue.length));
    setText(t.queue.sub, e.running.size + ' running');
    const rate = e.successRate();
    setText(t.success.value, rate === null ? '—' : (rate * 100).toFixed(1) + '%');
    setText(t.success.sub, formatInt(e.stats.completed + e.stats.failed) + ' finished');
    setText(t.throughput.value, String(e.throughput()));
    setText(t.throughput.sub, 'tasks / last 60s');
    setText(t.retries.value, formatInt(e.stats.retries));
    setText(t.retries.sub, 'this session');
  }
}
