import type { AppConfig } from '../config';
import type { SimulationEngine } from '../sim/engine';
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

  constructor(private engine: SimulationEngine, cfg: AppConfig) {
    this.agents = new AgentList(engine);
    this.terms = new TerminalGrid(engine, cfg.panels, cfg.panelCols);
    this.metrics = new Metrics(engine);
    this.queue = new TaskQueue(engine);
    this.feed = new EventFeed(engine);

    const right = el('section', 'panel side');
    const head = el('div', 'ph');
    head.append(el('span', 'ph-title', 'Operations'));
    right.append(head, this.metrics.el, this.queue.el);

    this.el.append(this.header.el, this.agents.el, this.terms.el, right, this.feed.el);
  }

  /** Call once the dashboard is in the document, and again on resize. */
  layout(): void {
    this.agents.layout();
  }

  render(wallNow: number, uptimeMs: number): void {
    this.header.update(this.engine, wallNow, uptimeMs);
    this.agents.update();
    this.terms.update();
    this.metrics.update();
    this.queue.update();
    this.feed.update();
  }
}
