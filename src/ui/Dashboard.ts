import type { AppConfig } from '../config';
import type { SimulationEngine } from '../sim/engine';
import { ActivityChart } from './ActivityChart';
import { AgentList } from './AgentList';
import { el } from './dom';
import { EventFeed } from './EventFeed';
import { Header } from './Header';
import { Metrics } from './Metrics';
import { TaskQueue } from './TaskQueue';
import { TerminalGrid } from './TerminalGrid';

/** Composes the panels and renders them from engine state. Holds no simulation logic. */
export class Dashboard {
  readonly el = el('div', 'app');
  private header = new Header();
  private agents: AgentList;
  private terms: TerminalGrid;
  private metrics: Metrics;
  private queue: TaskQueue;
  private feed: EventFeed;
  private chart: ActivityChart;
  private lastChart = -Infinity;

  constructor(private engine: SimulationEngine, cfg: AppConfig, reducedMotion = false) {
    this.agents = new AgentList(engine, reducedMotion);
    this.terms = new TerminalGrid(engine, cfg.panels, cfg.panelCols, reducedMotion);
    this.metrics = new Metrics(engine);
    this.queue = new TaskQueue(engine);
    this.feed = new EventFeed(engine);
    this.chart = new ActivityChart(engine);

    const right = el('section', 'panel side');
    const head = el('div', 'ph');
    head.append(el('span', 'ph-title', 'Operations'));
    right.append(head, this.metrics.el, this.chart.el, this.queue.el);

    this.el.append(this.header.el, this.agents.el, this.terms.el, right, this.feed.el);
  }

  /** Call once the dashboard is in the document, and again on resize. */
  layout(): void {
    this.agents.layout();
  }

  render(wallNow: number, uptimeMs: number): void {
    this.header.update(this.engine, wallNow, uptimeMs);
    this.agents.update(uptimeMs);
    this.terms.update(uptimeMs);
    this.metrics.update();
    this.queue.update();
    this.feed.update();
    // The chart only gains a point every couple of seconds; redraw about once a second.
    if (uptimeMs - this.lastChart >= 1000) {
      this.lastChart = uptimeMs;
      this.chart.update();
    }
  }
}
