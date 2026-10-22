import type { SimulationEngine } from '../sim/engine';
import { ACTIVE_STATES, type Agent } from '../sim/types';
import { el, fmtClock, fmtElapsed, setClass, setScaleX, setText, STATE_LABEL } from './dom';

/** Line elements per panel. The panel shows as many as fit; the rest are clipped at the top. */
const POOL = 25;
/** How long (simulated ms) a panel lingers on a finished agent before switching. */
const LINGER_MS = 2500;

interface LineRefs {
  root: HTMLElement;
  ts: HTMLElement;
  tag: HTMLElement;
  text: HTMLElement;
}

class TerminalPanel {
  readonly el = el('div', 'term');
  agent: Agent | null = null;
  private lastSeq = -1;
  private id = el('span', 'term-id');
  private role = el('span', 'term-role');
  private state = el('span', 'term-state');
  private elapsed = el('span', 'term-elapsed');
  private task = el('div', 'term-task');
  private body = el('div', 'term-body');
  private bar = el('i');
  private lines: LineRefs[] = [];

  constructor() {
    const head = el('div', 'term-head');
    const left = el('div', 'term-head-l');
    left.append(el('span', 'term-dot'), this.id, this.role);
    const right = el('div', 'term-head-r');
    right.append(this.state, this.elapsed);
    head.append(left, right);
    for (let i = 0; i < POOL; i++) {
      const root = el('div', 'tl');
      const ts = el('span', 'tl-ts');
      const tag = el('span', 'tl-tag');
      const text = el('span', 'tl-text');
      root.append(ts, tag, text);
      this.body.append(root);
      this.lines.push({ root, ts, tag, text });
    }
    this.body.append(el('div', 'tl cursor-line'));
    const barWrap = el('div', 'term-bar');
    barWrap.append(this.bar);
    this.el.append(head, this.task, this.body, barWrap);
  }

  show(agent: Agent): void {
    this.agent = agent;
    this.lastSeq = -1;
  }

  render(engine: SimulationEngine): void {
    const agent = this.agent;
    if (!agent) return;
    setText(this.id, agent.id);
    setText(this.role, agent.role);
    setText(this.state, STATE_LABEL[agent.state]);
    setClass(this.el, 'term st-' + agent.state);
    const task = agent.task;
    setText(this.task, task ? task.key + '  ' + task.title : 'Waiting for work');
    setText(this.elapsed, task ? fmtElapsed(engine.now - agent.assignedAt) : '');
    setScaleX(this.bar, engine.progress(agent));

    const last = agent.log.last();
    const seq = last ? last.seq : 0;
    if (seq === this.lastSeq) return;
    this.lastSeq = seq;
    // Fill the pool bottom-up with the newest lines; unused slots stay empty at the top.
    const n = agent.log.length;
    for (let i = 0; i < POOL; i++) {
      const refs = this.lines[POOL - 1 - i];
      if (i < n) {
        const line = agent.log.fromEnd(i);
        setText(refs.ts, fmtClock(line.ts));
        setText(refs.tag, '[' + line.tag + ']');
        setText(refs.text, line.text);
        setClass(refs.root, 'tl lv-' + line.level + (line.tag === agent.id ? ' tl-assign' : ''));
      } else {
        setText(refs.ts, '');
        setText(refs.tag, '');
        setText(refs.text, '');
        setClass(refs.root, 'tl');
      }
    }
  }
}

export class TerminalGrid {
  readonly el = el('section', 'terms');
  private panels: TerminalPanel[] = [];

  constructor(private engine: SimulationEngine, count: number, cols: number) {
    this.el.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    this.el.style.gridTemplateRows = 'repeat(' + Math.ceil(count / cols) + ', minmax(0, 1fr))';
    for (let i = 0; i < count; i++) {
      const panel = new TerminalPanel();
      this.panels.push(panel);
      this.el.append(panel.el);
    }
  }

  update(): void {
    const shown = new Set<Agent>();
    for (const p of this.panels) if (p.agent) shown.add(p.agent);
    for (const panel of this.panels) {
      const a = panel.agent;
      const stale = !a || (!ACTIVE_STATES.has(a.state) && this.engine.now - a.stateSince > LINGER_MS);
      if (stale) {
        const next = this.candidate(shown);
        if (next) {
          if (a) shown.delete(a);
          shown.add(next);
          panel.show(next);
        }
      }
      panel.render(this.engine);
    }
  }

  /** The busy agent not already on screen that most recently picked up work. */
  private candidate(shown: Set<Agent>): Agent | null {
    let best: Agent | null = null;
    for (const a of this.engine.agents) {
      if (shown.has(a) || !ACTIVE_STATES.has(a.state)) continue;
      if (!best || a.assignedAt > best.assignedAt) best = a;
    }
    return best;
  }
}
