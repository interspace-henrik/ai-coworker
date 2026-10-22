import type { SimulationEngine } from '../sim/engine';
import type { Agent } from '../sim/types';
import { el, setClass, setScaleX, setText, STATE_LABEL } from './dom';

interface Row {
  root: HTMLElement;
  state: HTMLElement;
  task: HTMLElement;
  bar: HTMLElement;
}

/**
 * Agent pool. When the list is taller than its panel it scrolls continuously: the rows are
 * rendered twice and the track is translated by -50% in a CSS animation, so the loop is
 * seamless and runs on the compositor.
 */
export class AgentList {
  readonly el = el('section', 'panel agents');
  private count = el('span', 'ph-count');
  private viewport = el('div', 'ag-viewport');
  private track = el('div', 'ag-track');
  private copies: HTMLElement[] = [];
  private rows = new Map<string, Row[]>();
  private revs = new Map<string, number>();
  private scrolling = false;

  constructor(private engine: SimulationEngine) {
    const head = el('div', 'ph');
    head.append(el('span', 'ph-title', 'Agent pool'), this.count);
    this.viewport.append(this.track);
    this.el.append(head, this.viewport);
    this.build(false);
  }

  private build(duplicate: boolean): void {
    this.track.textContent = '';
    this.rows.clear();
    this.revs.clear();
    this.copies = [];
    for (let c = 0; c < (duplicate ? 2 : 1); c++) {
      const copy = el('div', 'ag-copy');
      for (const agent of this.engine.agents) {
        const row = this.makeRow(agent);
        copy.append(row.root);
        const list = this.rows.get(agent.id) ?? [];
        list.push(row);
        this.rows.set(agent.id, list);
      }
      this.copies.push(copy);
      this.track.append(copy);
    }
    this.scrolling = duplicate;
    setClass(this.track, duplicate ? 'ag-track scrolling' : 'ag-track');
    if (duplicate) {
      // Constant reading speed regardless of agent count.
      this.track.style.animationDuration = this.engine.agents.length * 2.4 + 's';
    }
  }

  private makeRow(agent: Agent): Row {
    const root = el('div', 'ag-row');
    const state = el('span', 'ag-state');
    const task = el('div', 'ag-task');
    const barWrap = el('div', 'ag-bar');
    const bar = el('i');
    barWrap.append(bar);
    root.append(
      el('span', 'ag-dot'),
      el('span', 'ag-id', agent.id),
      el('span', 'ag-role', agent.role.toUpperCase()),
      state,
      task,
      barWrap,
    );
    return { root, state, task, bar };
  }

  /** Re-evaluates whether the list needs to scroll (on start and on resize). */
  layout(): void {
    const single = this.copies[0];
    if (!single) return;
    const overflow = single.offsetHeight > this.viewport.clientHeight + 2;
    if (overflow !== this.scrolling) this.build(overflow);
  }

  update(): void {
    setText(this.count, this.engine.agents.length + ' agents');
    for (const agent of this.engine.agents) {
      if (this.revs.get(agent.id) === agent.rev) continue;
      this.revs.set(agent.id, agent.rev);
      const rows = this.rows.get(agent.id);
      if (!rows) continue;
      const task = agent.task;
      const taskText = task ? (task.parentId !== null ? '↳ ' : '') + task.title : 'Waiting for work';
      const label = agent.waiting ? 'WAITING' : STATE_LABEL[agent.state];
      const progress = this.engine.progress(agent);
      for (const row of rows) {
        setClass(row.root, 'ag-row st-' + agent.state + (agent.waiting ? ' waiting' : ''));
        setText(row.state, label);
        setText(row.task, taskText);
        setClass(row.task, task ? 'ag-task' : 'ag-task idle');
        setScaleX(row.bar, progress);
      }
    }
  }
}
