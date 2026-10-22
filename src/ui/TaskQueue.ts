import type { SimulationEngine } from '../sim/engine';
import type { Task } from '../sim/types';
import { el, fmtSecs, setClass, setText } from './dom';

const ROWS = 7;

interface Row {
  root: HTMLElement;
  mark: HTMLElement;
  key: HTMLElement;
  title: HTMLElement;
  meta: HTMLElement;
}

function makeList(title: string, count: HTMLElement): { box: HTMLElement; rows: Row[] } {
  const box = el('div', 'tq-list');
  const head = el('div', 'tq-head');
  head.append(el('span', 'ph-title', title), count);
  box.append(head);
  const rows: Row[] = [];
  for (let i = 0; i < ROWS; i++) {
    const root = el('div', 'tq-row');
    const mark = el('span', 'tq-mark');
    const key = el('span', 'tq-key');
    const titleEl = el('span', 'tq-title');
    const meta = el('span', 'tq-meta');
    root.append(mark, key, titleEl, meta);
    box.append(root);
    rows.push({ root, mark, key, title: titleEl, meta });
  }
  return { box, rows };
}

export class TaskQueue {
  readonly el = el('div', 'tq');
  private queued: Row[];
  private recent: Row[];
  private queuedCount = el('span', 'ph-count');
  private recentCount = el('span', 'ph-count');

  constructor(private engine: SimulationEngine) {
    const q = makeList('Queue', this.queuedCount);
    const r = makeList('Recently finished', this.recentCount);
    this.queued = q.rows;
    this.recent = r.rows;
    this.el.append(q.box, r.box);
  }

  update(): void {
    const e = this.engine;
    setText(this.queuedCount, e.queue.length + ' waiting');
    for (let i = 0; i < ROWS; i++) {
      const task = e.queue[i];
      const row = this.queued[i];
      if (!task) {
        clear(row);
        continue;
      }
      setClass(row.root, 'tq-row' + (task.priority >= 2 ? ' sub' : task.priority === 1 ? ' hi' : ''));
      setText(row.mark, task.priority >= 2 ? '↳' : task.priority === 1 ? '▲' : '·');
      fill(row, task, task.role + ' · ' + fmtSecs(e.now - task.createdAt));
    }

    setText(this.recentCount, e.stats.completed + e.stats.failed + ' total');
    for (let i = 0; i < ROWS; i++) {
      const row = this.recent[i];
      const task = i < e.recent.length ? e.recent.fromEnd(i) : undefined;
      if (!task) {
        clear(row);
        continue;
      }
      const ok = task.status === 'completed';
      setClass(row.root, 'tq-row ' + (ok ? 'done' : 'fail'));
      setText(row.mark, ok ? '✓' : '✗');
      fill(row, task, fmtSecs(task.endedAt - task.startedAt));
    }
  }
}

function fill(row: Row, task: Task, meta: string): void {
  setText(row.key, task.key);
  setText(row.title, task.title);
  setText(row.meta, meta);
}

function clear(row: Row): void {
  setClass(row.root, 'tq-row empty');
  setText(row.mark, '');
  setText(row.key, '');
  setText(row.title, '');
  setText(row.meta, '');
}
