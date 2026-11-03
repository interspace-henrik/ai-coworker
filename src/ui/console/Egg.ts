import { el } from '../dom';
import { TermCanvas } from '../term/TermCanvas';
import { P } from './palette';

interface Beat {
  who: 'wopr' | 'user';
  text: string;
  /** Pause after the line is complete (ms). */
  after: number;
}

/** WarGames (1983). Joshua at 300-baud pace, the operator at typing pace. */
const SCRIPT: Beat[] = [
  { who: 'wopr', text: 'GREETINGS PROFESSOR FALKEN.', after: 2600 },
  { who: 'wopr', text: '', after: 0 },
  { who: 'wopr', text: 'SHALL WE PLAY A GAME?', after: 4800 },
  { who: 'wopr', text: '', after: 0 },
  { who: 'user', text: 'LOVE TO. HOW ABOUT GLOBAL THERMONUCLEAR WAR?', after: 1600 },
  { who: 'wopr', text: '', after: 0 },
  { who: 'wopr', text: "WOULDN'T YOU PREFER A GOOD GAME OF CHESS?", after: 3600 },
  { who: 'wopr', text: '', after: 0 },
  { who: 'user', text: "LATER. LET'S PLAY AGENT CONTROL.", after: 1400 },
  { who: 'wopr', text: '', after: 0 },
  { who: 'wopr', text: 'FINE.', after: 4000 },
];

const CPS = { wopr: 24, user: 9 };
const LEAD_IN = 2000;

interface Timed extends Beat {
  start: number;
  duration: number;
}

const TIMELINE: Timed[] = [];
let cursor = LEAD_IN;
for (const beat of SCRIPT) {
  const duration = (beat.text.length / CPS[beat.who]) * 1000;
  TIMELINE.push({ ...beat, start: cursor, duration });
  cursor += duration + beat.after;
}
const TOTAL = cursor;

/**
 * "Shall we play a game?" Every so often (?egg=MINUTES, default 60) the whole screen goes
 * dark and Joshua starts typing. About 40 seconds later normal service resumes.
 */
export class Egg {
  private start = -1;
  private nextAt: number;

  constructor(private intervalMs: number) {
    this.nextAt = intervalMs * (0.6 + Math.random() * 0.4);
  }

  active(now: number): boolean {
    if (this.intervalMs <= 0) return false;
    if (this.start < 0 && now >= this.nextAt) this.start = now;
    if (this.start >= 0 && now - this.start > TOTAL) {
      this.start = -1;
      this.nextAt = now + this.intervalMs * (0.75 + Math.random() * 0.5);
    }
    return this.start >= 0;
  }

  draw(t: TermCanvas, now: number): void {
    const elapsed = now - this.start;
    const x0 = Math.max(2, Math.floor(t.cols * 0.12));
    let y = Math.max(1, Math.floor(t.rows * 0.28));
    let endX = x0;
    let endY = y;
    for (const beat of TIMELINE) {
      if (elapsed < beat.start) break;
      const shown = beat.duration ? Math.min(beat.text.length, Math.floor(((elapsed - beat.start) / beat.duration) * beat.text.length)) : 0;
      endX = t.write(x0, y, beat.text.slice(0, shown), P.fg);
      endY = y;
      y++;
    }
    if (Math.floor(now / 500) % 2 === 0) t.write(endX, endY, '█', P.fg);
  }
}

/** Shows the egg on top of the dashboard view, which has no character grid of its own. */
export class EggOverlay {
  readonly el = el('div', 'egg');
  private term = new TermCanvas(P.bg, P.fg, 3);
  private egg: Egg;
  private shown = false;

  constructor(intervalMs: number) {
    this.egg = new Egg(intervalMs);
    this.el.append(this.term.el);
    this.el.style.display = 'none';
  }

  layout(): void {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.term.resize(window.innerWidth, window.innerHeight, Math.round(rootPx * 1.25));
  }

  update(now: number): void {
    const on = this.egg.active(now);
    if (on !== this.shown) {
      this.shown = on;
      this.el.style.display = on ? '' : 'none';
      if (on) this.layout();
    }
    if (!on) return;
    this.term.clear();
    this.egg.draw(this.term, now);
    this.term.flush();
  }
}
