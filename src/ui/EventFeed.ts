import type { SimulationEngine } from '../sim/engine';
import { el, fmtClock, setClass, setText } from './dom';

const SLOTS = 4;

export class EventFeed {
  readonly el = el('footer', 'ftr');
  private slots: { root: HTMLElement; ts: HTMLElement; text: HTMLElement }[] = [];
  private lastSeq = -1;

  constructor(private engine: SimulationEngine) {
    this.el.append(el('span', 'ftr-label', 'Events'));
    for (let i = 0; i < SLOTS; i++) {
      const root = el('span', 'ev');
      const ts = el('span', 'ev-ts');
      const text = el('span', 'ev-text');
      root.append(ts, text);
      this.el.append(root);
      this.slots.push({ root, ts, text });
    }
  }

  update(): void {
    const events = this.engine.events;
    const last = events.last();
    if (!last || last.seq === this.lastSeq) return;
    this.lastSeq = last.seq;
    for (let i = 0; i < SLOTS; i++) {
      const slot = this.slots[i];
      if (i < events.length) {
        const ev = events.fromEnd(i);
        setClass(slot.root, 'ev lv-' + ev.level + (i === 0 ? ' newest' : ''));
        setText(slot.ts, fmtClock(ev.ts));
        setText(slot.text, ev.text);
      } else {
        setClass(slot.root, 'ev empty');
        setText(slot.ts, '');
        setText(slot.text, '');
      }
    }
  }
}
