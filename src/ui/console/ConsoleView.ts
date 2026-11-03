import { matrixLevel, type AppConfig } from '../../config';
import type { SimulationEngine } from '../../sim/engine';
import { formatInt } from '../../sim/template';
import { ACTIVE_STATES, type Agent, type LogLine, type Role } from '../../sim/types';
import { el, fmtClock, fmtElapsed, fmtUptime } from '../dom';
import { MatrixGrid } from '../term/MatrixGrid';
import { TermCanvas } from '../term/TermCanvas';
import { BIG_ROWS, bigText, bigWidth, box, drawMeter } from './ascii';
import { Egg } from './Egg';
import { defcon, HOST, P, pad } from './palette';
import { Session } from './Session';

const ROLE_SHORT: Record<Role, string> = {
  Code: 'CODE',
  QA: 'QA',
  Security: 'SEC',
  Data: 'DATA',
  Infrastructure: 'INFRA',
  Research: 'RSRCH',
  Documentation: 'DOCS',
  Deployment: 'DEPLOY',
};

const STATE_SHORT: Record<string, string> = {
  idle: 'IDLE',
  assigned: 'ASSN',
  analyzing: 'ANLZ',
  planning: 'PLAN',
  executing: 'EXEC',
  validating: 'VALD',
  retrying: 'RTRY',
  completed: 'DONE',
  failed: 'FAIL',
};

/** How long (simulated ms) a window lingers on a finished agent before switching. */
const LINGER_MS = 2500;
/** Characters per tick when a new log line prints, about 1200 baud. */
const BAUD_STEP = 11;
const GLITCH_MS = 900;
const HEADER_H = 6;
const SESSION_H = 7;

interface Window {
  agent: Agent | null;
  seq: number;
  shown: number;
}

/**
 * ?view=console: one green-phosphor character screen, WOPR style. Everything — the block
 * lettering, the frames, the big numbers — is made of characters of the same size, drawn on
 * a single canvas grid. ?matrix takes over individual cells in place; ?egg lets Joshua in.
 */
export class ConsoleView {
  readonly el = el('div', 'console');
  private term = new TermCanvas(P.bg, P.fg, 3);
  private session: Session;
  private egg: Egg;
  private grid: MatrixGrid | null = null;
  private windows: Window[] = [];
  private cycle = 0;
  private glitchUntil = 0;
  private lastStep = 0;
  private rosterOffset = 0;
  private lastRoll = 0;

  constructor(private engine: SimulationEngine, private cfg: AppConfig, private reducedMotion = false) {
    this.session = new Session(engine);
    this.egg = new Egg(cfg.eggMinutes * 60_000);
    for (let i = 0; i < cfg.panels; i++) this.windows.push({ agent: null, seq: -1, shown: 0 });
    this.el.append(this.term.el, el('div', 'crt'));
  }

  layout(): void {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.term.resize(window.innerWidth, window.innerHeight, Math.round(rootPx));
    this.grid = this.cfg.matrix ? new MatrixGrid(this.term.cols, this.term.rows) : null;
  }

  render(wallNow: number, uptimeMs: number): void {
    const t = this.term;
    this.session.tick(uptimeMs);
    t.clear();
    if (this.egg.active(uptimeMs)) {
      this.egg.draw(t, uptimeMs);
      t.flush();
      return;
    }
    const { cols, rows } = t;
    const mainTop = HEADER_H;
    const mainBot = rows - SESSION_H - 1;
    const rosterW = Math.max(30, Math.min(46, Math.round(cols * 0.22)));
    const boardW = Math.max(36, Math.min(52, Math.round(cols * 0.25)));

    this.drawHeader(wallNow, uptimeMs);
    this.drawRoster(0, mainTop, rosterW - 1, mainBot, uptimeMs);
    this.drawWindows(rosterW, mainTop, cols - boardW - 1, mainBot);
    this.drawBoard(cols - boardW, mainTop, cols - 1, mainBot);
    box(t, 0, rows - SESSION_H, cols - 1, rows - 1, P.dim, 'double', 'SESSION 01 - OPERATOR CONSOLE', P.fg);
    this.session.draw(t, 2, rows - SESSION_H + 1, cols - 3, rows - 2, uptimeMs);
    t.flush(this.matrix(uptimeMs));
  }

  // ---- header ----------------------------------------------------------------------------

  private drawHeader(wallNow: number, uptimeMs: number): void {
    const t = this.term;
    const e = this.engine;
    const cols = t.cols;
    box(t, 0, 0, cols - 1, HEADER_H - 1, P.dim, 'double');
    const clock = fmtClock(wallNow);
    const clockX = cols - 2 - bigWidth(clock);
    bigText(t, clockX, 1, clock, P.fg);

    let title = 'AGENT CONTROL CENTER';
    if (bigWidth(title) > clockX - 26) title = 'AGENT CONTROL';
    if (bigWidth(title) > clockX - 26) title = 'ACC';
    const logoEnd = 3 + bigText(t, 3, 1, title, P.bright);

    const infoX = logoEnd + 4;
    const infoW = clockX - 4 - infoX;
    if (infoW < 18) return;
    const level = defcon(e);
    const row = (y: number, k: string, v: string, color = P.fg): void => {
      t.write(infoX, y, pad(k, 9), P.dim, '', infoX + infoW);
      t.write(infoX + 9, y, v, color, '', infoX + infoW);
    };
    row(1, 'NODE', HOST + '  ' + e.agents.length + ' AGENTS');
    t.write(infoX, 2, pad('DEFCON', 9), P.dim, '', infoX + infoW);
    if (level <= 3) t.write(infoX + 9, 2, ' ' + level + ' ', P.bg, P.fg, infoX + infoW);
    else t.write(infoX + 9, 2, String(level), level === 4 ? P.bright : P.fg, '', infoX + infoW);
    row(3, 'UPTIME', fmtUptime(uptimeMs));
    const mw = Math.max(4, Math.min(12, infoW - 15));
    t.write(infoX, 4, pad('LOAD', 9), P.dim, '', infoX + infoW);
    const mx = drawMeter(t, infoX + 9, 4, e.load, mw, P.fg, P.faint, infoX + infoW);
    t.write(mx + 1, 4, Math.round(e.load * 100) + '%', P.fg, '', infoX + infoW);
  }

  // ---- agent roster ----------------------------------------------------------------------

  private drawRoster(x0: number, y0: number, x1: number, y1: number, now: number): void {
    const t = this.term;
    const agents = this.engine.agents;
    box(t, x0, y0, x1, y1, P.dim, 'double', 'AGENT POOL  ' + agents.length, P.fg);
    const inner = y1 - y0 - 1;
    const width = x1 - x0 - 3;
    const barW = Math.max(3, Math.min(10, width - 23));
    if (agents.length > inner) {
      // Roll one line at a time, like a slow teletype listing.
      if (now - this.lastRoll >= 2500) {
        this.lastRoll = now;
        this.rosterOffset = (this.rosterOffset + 1) % agents.length;
      }
    } else this.rosterOffset = 0;
    for (let i = 0; i < Math.min(inner, agents.length); i++) {
      const a = agents[(i + this.rosterOffset) % agents.length];
      const y = y0 + 1 + i;
      const busy = a.task !== null;
      const state = a.waiting ? 'WAIT' : STATE_SHORT[a.state];
      let x = t.write(x0 + 2, y, pad(a.id.toUpperCase(), 10), busy ? P.fg : P.faint, '', x1);
      x = t.write(x, y, pad(ROLE_SHORT[a.role], 7), busy ? P.dim : P.faint, '', x1);
      if (a.state === 'failed') x = t.write(x, y, state, P.bg, P.fg, x1);
      else x = t.write(x, y, state, a.state === 'retrying' || a.state === 'completed' ? P.bright : busy ? P.fg : P.faint, '', x1);
      drawMeter(t, x + 2, y, this.engine.progress(a), barW, busy ? P.fg : P.faint, P.faint, x1, '■·');
    }
  }

  // ---- agent windows ---------------------------------------------------------------------

  private drawWindows(x0: number, y0: number, x1: number, y1: number): void {
    const cols = this.cfg.panelCols;
    const rowsN = Math.ceil(this.windows.length / cols);
    const w = Math.floor((x1 - x0 + 1) / cols);
    const h = Math.floor((y1 - y0 + 1) / rowsN);
    this.assignWindows();
    this.windows.forEach((win, i) => {
      const wx0 = x0 + (i % cols) * w;
      const wy0 = y0 + Math.floor(i / cols) * h;
      const wx1 = (i % cols) === cols - 1 ? x1 : wx0 + w - 1;
      const wy1 = Math.floor(i / cols) === rowsN - 1 ? y1 : wy0 + h - 1;
      this.drawWindow(win, wx0, wy0, wx1, wy1);
    });
  }

  private assignWindows(): void {
    const e = this.engine;
    const shown = new Set<Agent>();
    for (const w of this.windows) if (w.agent) shown.add(w.agent);
    for (const win of this.windows) {
      const a = win.agent;
      if (a && (ACTIVE_STATES.has(a.state) || e.now - a.stateSince <= LINGER_MS)) continue;
      let best: Agent | null = null;
      for (const c of e.agents) {
        if (shown.has(c) || !ACTIVE_STATES.has(c.state)) continue;
        if (!best || c.assignedAt > best.assignedAt) best = c;
      }
      if (!best) continue;
      if (a) shown.delete(a);
      shown.add(best);
      win.agent = best;
      win.seq = -1;
    }
  }

  private drawWindow(win: Window, x0: number, y0: number, x1: number, y1: number): void {
    const t = this.term;
    const e = this.engine;
    const agent = win.agent;
    if (!agent) {
      box(t, x0, y0, x1, y1, P.faint, 'double');
      t.write(Math.floor((x0 + x1) / 2) - 5, Math.floor((y0 + y1) / 2), 'NO CARRIER', P.dim);
      return;
    }
    box(t, x0, y0, x1, y1, P.dim, 'double', agent.id + ' / ' + ROLE_SHORT[agent.role], P.bright);
    const task = agent.task;
    const state = agent.waiting ? 'WAITING' : agent.state.toUpperCase();
    const right = ' ' + state + (task ? '  ' + fmtElapsed(e.now - agent.assignedAt) : '') + ' ';
    if (agent.state === 'failed') t.write(x1 - right.length - 1, y0, right, P.bg, P.fg);
    else t.write(x1 - right.length - 1, y0, right, agent.state === 'retrying' ? P.bright : P.fg);

    // Progress runs along the bottom frame in a brighter tone.
    const inner = x1 - x0 - 1;
    const n = Math.round(e.progress(agent) * inner);
    if (n > 0) t.write(x0 + 1, y1, '═'.repeat(n), P.bright);

    const cx0 = x0 + 2;
    const cx1 = x1 - 1;
    t.write(cx0, y0 + 1, task ? (task.key + '  ' + task.title).toUpperCase() : 'AWAITING ASSIGNMENT', task ? P.bright : P.faint, '', cx1);

    // Log lines, newest at the bottom; the newest one prints at baud speed.
    const logTop = y0 + 2;
    const logRows = y1 - logTop;
    const log = agent.log;
    const newest = log.last();
    if (newest && newest.seq !== win.seq) {
      win.seq = newest.seq;
      win.shown = 0;
    }
    win.shown += BAUD_STEP;
    const count = Math.min(logRows, log.length);
    for (let i = 0; i < count; i++) {
      const line = log.fromEnd(count - 1 - i);
      const y = logTop + (logRows - count) + i;
      this.drawLogLine(line, cx0, y, cx1, i === count - 1 ? win.shown : Infinity);
    }
  }

  private drawLogLine(line: LogLine, x0: number, y: number, x1: number, reveal: number): void {
    const t = this.term;
    let x = t.write(x0, y, fmtClock(line.ts) + ' ', P.faint, '', x1);
    const body = ('[' + line.tag + '] ' + line.text).toUpperCase().replace(/[—→✓↳]/g, (c) =>
      c === '—' ? '-' : c === '→' ? '->' : c === '✓' ? 'OK' : '>',
    );
    const text = reveal === Infinity ? body : body.slice(0, Math.max(0, reveal));
    const tagEnd = line.tag.length + 2;
    const tagPart = text.slice(0, tagEnd);
    const rest = text.slice(tagEnd);
    x = t.write(x, y, tagPart, P.dim, '', x1);
    if (line.level === 'err') x = t.write(x, y, rest, P.bg, P.fg, x1);
    else x = t.write(x, y, rest, line.level === 'ok' || line.level === 'warn' ? P.bright : line.level === 'dim' ? P.faint : P.fg, '', x1);
    if (reveal !== Infinity && reveal < body.length) t.write(x, y, '█', P.fg, '', x1);
  }

  // ---- status board ----------------------------------------------------------------------

  private drawBoard(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.term;
    const e = this.engine;
    box(t, x0, y0, x1, y1, P.dim, 'double', 'STATUS', P.fg);
    const cx = x0 + 2;
    const cw = x1 - x0 - 3;
    let y = y0 + 1;
    const big = (label: string, value: string): void => {
      t.write(cx, y, label, P.dim, '', x1);
      if (bigWidth(value) <= cw && y + BIG_ROWS < y1) {
        bigText(t, cx, y + 1, value, P.fg, x1);
        y += BIG_ROWS + 2;
      } else {
        t.write(cx + label.length + 2, y, value, P.bright, '', x1);
        y += 2;
      }
    };
    big('ACTIVE AGENTS', e.activeAgents() + '/' + e.agents.length);
    big('TASKS COMPLETED', formatInt(e.stats.completed));
    big('THROUGHPUT / MIN', String(e.throughput()));

    const mw = Math.max(4, Math.min(20, cw - 18));
    const rate = e.successRate();
    const small = (label: string, value: string, color = P.fg): void => {
      if (y >= y1) return;
      t.write(cx, y, pad(label, 10), P.dim, '', x1);
      t.write(cx + 10, y, value, color, '', x1);
      y++;
    };
    const gauge = (label: string, value: string, fill: number): void => {
      if (y >= y1) return;
      t.write(cx, y, pad(label, 10), P.dim, '', x1);
      t.write(cx + 10, y, pad(value, 7), P.fg, '', x1);
      drawMeter(t, cx + 17, y, fill, mw, P.fg, P.faint, x1, '■·');
      y++;
    };
    gauge('QUEUE', e.queue.length + '/' + e.cfg.maxQueue, e.queue.length / e.cfg.maxQueue);
    gauge('LOAD', Math.round(e.load * 100) + '%', e.load);
    small('SUCCESS', rate === null ? '--' : (rate * 100).toFixed(1) + '%');
    small('RETRIES', formatInt(e.stats.retries) + '   FAILED ' + formatInt(e.stats.failed), e.stats.failed ? P.fg : P.dim);
    y++;
    this.drawChart(cx, y, x1 - 2, y1 - 1);
  }

  /** Active agents as block bars (two levels per cell) with queue depth as ■ markers. */
  private drawChart(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.term;
    const e = this.engine;
    if (y1 - y0 < 4) return;
    t.write(x0, y0, 'ACTIVITY 5 MIN', P.dim, '', x1 + 1);
    t.write(x1 - 15, y0, '█ ACTIVE ■ QUEUE', P.faint, '', x1 + 1);
    const top = y0 + 1;
    const h = y1 - top + 1;
    const w = x1 - x0 + 1;
    const hist = e.history;
    if (hist.length < 2) return;
    const scale = Math.max(e.agents.length, e.cfg.maxQueue);
    for (let c = 0; c < w; c++) {
      // The right edge is now; the full width spans the whole history window.
      const idx = hist.length - 1 - Math.floor(((w - 1 - c) * e.cfg.historySize) / w);
      if (idx < 0) continue;
      const p = hist.get(idx);
      const halves = Math.round((p.active / scale) * h * 2);
      for (let r = 0; r < h; r++) {
        const fromBottom = (h - 1 - r) * 2;
        const ch = halves >= fromBottom + 2 ? '█' : halves === fromBottom + 1 ? '▄' : '';
        if (ch) t.write(x0 + c, top + r, ch, P.faint);
      }
      const qr = top + h - 1 - Math.min(h - 1, Math.round((p.queue / scale) * (h - 1)));
      t.write(x0 + c, qr, '■', P.bright);
    }
  }

  // ---- matrix ----------------------------------------------------------------------------

  private matrix(uptimeMs: number) {
    const spec = this.cfg.matrix;
    if (!spec || !this.grid) return undefined;
    const { level, cycle } = matrixLevel(spec, uptimeMs);
    if (cycle !== this.cycle) {
      this.cycle = cycle;
      this.glitchUntil = uptimeMs + GLITCH_MS;
    }
    const glitch = uptimeMs < this.glitchUntil;
    if (level <= 0.001 && !glitch) {
      this.lastStep = 0;
      return undefined;
    }
    if (!this.reducedMotion) {
      const dt = this.lastStep ? Math.min(0.25, (uptimeMs - this.lastStep) / 1000) : 0.1;
      this.lastStep = uptimeMs;
      this.grid.step(dt, 0.35 + 0.65 * level);
    }
    return { grid: this.grid, level, ownAll: false, glitch };
  }
}
