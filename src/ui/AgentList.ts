import type { SimulationEngine } from '../sim/engine';
import type { Agent } from '../sim/types';
import { el, setClass, setScaleX, setText, STATE_LABEL } from './dom';

interface Row {
  root: HTMLElement;
  state: HTMLElement;
  task: HTMLElement;
  bar: HTMLElement;
}

/** The list glides up one row this often (ms). */
const ROW_MS = 2400;
/** Must match the .ag-track.scrolling transition duration in CSS. */
const GLIDE_MS = 700;
/** With reduced motion the list pages instead of gliding, this often (ms). */
const PAGE_MS = 8000;

/**
 * Agent pool. When the list is taller than its panel it rotates: the rows are rendered twice
 * and the track glides up one row at a time with a short transform transition. After a full
 * copy it snaps back invisibly. Gliding in steps rather than scrolling continuously keeps the
 * compositor idle most of the time, which matters on a Raspberry Pi. With
 * prefers-reduced-motion it pages instead.
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
  private overflow = false;
  private lastPage = 0;
  private offset = 0;
  private lastGlide = 0;
  /** Height of one copy of the list, measured in layout() so glide() never forces layout. */
  private copyHeight = 0;

  constructor(private engine: SimulationEngine, private reducedMotion = false) {
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
    this.offset = 0;
    this.track.style.transform = '';
    setClass(this.track, duplicate ? 'ag-track scrolling' : 'ag-track');
  }

  private glide(nowMs: number): void {
    const copyHeight = this.copyHeight;
    if (!copyHeight) return;
    if (this.offset >= copyHeight) {
      // Both copies are identical, so jumping back one copy height is invisible.
      if (nowMs - this.lastGlide < GLIDE_MS) return;
      this.offset -= copyHeight;
      setClass(this.track, 'ag-track scrolling snap');
      this.track.style.transform = 'translateY(' + -this.offset + 'px)';
      void this.track.offsetHeight;
      setClass(this.track, 'ag-track scrolling');
    }
    if (nowMs - this.lastGlide < ROW_MS) return;
    this.lastGlide = nowMs;
    this.offset += copyHeight / this.engine.agents.length;
    this.track.style.transform = 'translateY(' + -this.offset.toFixed(1) + 'px)';
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
    this.overflow = single.offsetHeight > this.viewport.clientHeight + 2;
    const scroll = this.overflow && !this.reducedMotion;
    if (scroll !== this.scrolling) this.build(scroll);
    this.copyHeight = this.copies[0].offsetHeight;
    if (!this.overflow) this.viewport.scrollTop = 0;
  }

  update(nowMs: number): void {
    if (this.reducedMotion && this.overflow && nowMs - this.lastPage >= PAGE_MS) {
      this.lastPage = nowMs;
      const v = this.viewport;
      const next = v.scrollTop + v.clientHeight;
      v.scrollTop = next >= v.scrollHeight - 2 ? 0 : next;
    }
    if (this.scrolling) this.glide(nowMs);
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
