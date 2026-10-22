import type { SimulationEngine } from '../sim/engine';
import { el, setText } from './dom';

const NS = 'http://www.w3.org/2000/svg';
const W = 300;
const H = 100;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

/**
 * Rolling activity chart: active agents (area) and queue depth (line) over the history
 * window. One polyline per series, rewritten about once a second, so the DOM never grows.
 */
export class ActivityChart {
  readonly el = el('div', 'chart');
  private area = svg('polygon', { class: 'c-area' });
  private active = svg('polyline', { class: 'c-active', 'vector-effect': 'non-scaling-stroke' });
  private queue = svg('polyline', { class: 'c-queue', 'vector-effect': 'non-scaling-stroke' });
  private yMax = el('span', 'chart-ymax');
  private window = el('span', 'chart-x0');

  constructor(private engine: SimulationEngine) {
    const head = el('div', 'chart-head');
    const legend = el('div', 'chart-legend');
    legend.append(el('span', 'lg lg-active', 'Active agents'), el('span', 'lg lg-queue', 'Queue depth'));
    head.append(el('span', 'ph-title', 'Activity'), legend);

    const plot = el('div', 'chart-plot');
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
    for (const y of [25, 50, 75]) {
      root.append(svg('line', { x1: '0', x2: String(W), y1: String(y), y2: String(y), class: 'c-grid', 'vector-effect': 'non-scaling-stroke' }));
    }
    root.append(this.area, this.active, this.queue);
    const xNow = el('span', 'chart-xnow', 'now');
    plot.append(root, this.yMax, this.window, xNow);
    this.el.append(head, plot);
  }

  update(): void {
    const e = this.engine;
    const hist = e.history;
    const span = e.cfg.sampleMs * e.cfg.historySize;
    setText(this.window, '−' + Math.round(span / 60_000) + ' min');
    const top = Math.max(e.agents.length, e.cfg.maxQueue);
    setText(this.yMax, String(top));
    if (hist.length < 2) return;

    const t0 = e.now - span;
    let act = '';
    let que = '';
    let firstX = 0;
    let lastX = 0;
    for (let i = 0; i < hist.length; i++) {
      const p = hist.get(i);
      const x = Math.max(0, ((p.t - t0) / span) * W);
      if (i === 0) firstX = x;
      lastX = x;
      act += x.toFixed(1) + ',' + (H - (p.active / top) * H).toFixed(1) + ' ';
      que += x.toFixed(1) + ',' + (H - (p.queue / top) * H).toFixed(1) + ' ';
    }
    this.active.setAttribute('points', act);
    this.queue.setAttribute('points', que);
    this.area.setAttribute('points', firstX.toFixed(1) + ',' + H + ' ' + act + lastX.toFixed(1) + ',' + H);
  }
}
