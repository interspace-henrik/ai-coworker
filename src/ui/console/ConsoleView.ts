import { matrixLevel, type AppConfig } from '../../config';
import type { SimulationEngine } from '../../sim/engine';
import { formatInt } from '../../sim/template';
import { ACTIVE_STATES, type Agent, type Role } from '../../sim/types';
import { el, fmtClock, fmtElapsed } from '../dom';
import { MatrixGrid } from '../term/MatrixGrid';
import { TermCanvas } from '../term/TermCanvas';
import { C, HOST, pad } from './palette';
import { Shell } from './Shell';

const ROLE_SHORT: Record<Role, string> = {
  Code: 'code',
  QA: 'qa',
  Security: 'sec',
  Data: 'data',
  Infrastructure: 'infra',
  Research: 'rsrch',
  Documentation: 'docs',
  Deployment: 'deploy',
};

const STATE_COLOR: Record<string, string> = {
  idle: C.dim,
  assigned: C.blue,
  analyzing: C.cyan,
  planning: C.magenta,
  executing: C.blue,
  validating: C.green,
  retrying: C.yellow,
  completed: C.bgreen,
  failed: C.red,
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GLITCH_MS = 900;

/**
 * ?view=console: the same simulation as seen from a Linux server in tmux. Left pane is a
 * shell with an operator running commands, right pane is `watch agentctl top`, bottom is the
 * tmux status line. Everything is one character grid on a canvas, so ?matrix can take over
 * individual cells in place.
 */
export class ConsoleView {
  readonly el = el('div', 'console');
  private term = new TermCanvas(C.bg, C.fg);
  private shell: Shell;
  private grid: MatrixGrid | null = null;
  private cycle = 0;
  private glitchUntil = 0;
  private lastStep = 0;
  private topAt = -Infinity;
  private topAgents: Agent[] = [];

  constructor(private engine: SimulationEngine, private cfg: AppConfig, private reducedMotion = false) {
    this.shell = new Shell(engine);
    this.el.append(this.term.el);
  }

  layout(): void {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.term.resize(window.innerWidth, window.innerHeight, Math.round(rootPx));
    this.grid = this.cfg.matrix ? new MatrixGrid(this.term.cols, this.term.rows) : null;
  }

  render(wallNow: number, uptimeMs: number): void {
    const t = this.term;
    const { cols, rows } = t;
    this.shell.tick(uptimeMs);
    t.clear();
    const split = Math.floor(cols * 0.6);
    const bottom = rows - 1;
    this.shell.draw(t, 0, 0, split, bottom, uptimeMs);
    // tmux draws the border of the active pane in green.
    for (let y = 0; y < bottom; y++) t.write(split, y, '│', C.green);
    this.drawTop(split + 2, bottom, wallNow, uptimeMs);
    this.drawStatus(bottom, wallNow);
    t.flush(this.matrix(uptimeMs));
  }

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

  /** Right pane: `watch -n 1 agentctl top`. */
  private drawTop(x0: number, bottom: number, wallNow: number, uptimeMs: number): void {
    const t = this.term;
    const e = this.engine;
    const x1 = t.cols;
    // watch refreshes once a second; between refreshes the pane is static.
    if (uptimeMs - this.topAt >= 1000) {
      this.topAt = uptimeMs;
      this.topAgents = e.agents.slice();
    }
    const d = new Date(wallNow);
    const stamp = `${HOST}: ${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(String(d.getDate()), 2, true)} ${fmtClock(wallNow)} ${d.getFullYear()}`;
    t.write(x0, 0, 'Every 1.0s: agentctl top', C.fg, '', x1);
    t.write(Math.max(x0 + 26, x1 - stamp.length - 1), 0, stamp, C.fg, '', x1);

    const active = e.activeAgents();
    const rate = e.successRate();
    let x = t.write(x0, 2, 'Agents: ', C.white, '', x1);
    x = t.write(x, 2, `${e.agents.length} total, `, C.fg, '', x1);
    x = t.write(x, 2, `${active} active`, C.green, '', x1);
    t.write(x, 2, `, ${e.agents.length - active} idle    load ${Math.round(e.load * 100)}%`, C.fg, '', x1);
    x = t.write(x0, 3, 'Tasks:  ', C.white, '', x1);
    t.write(
      x,
      3,
      `${formatInt(e.stats.completed)} done, ${formatInt(e.stats.failed)} failed` +
        (rate === null ? '' : `, ${(rate * 100).toFixed(1)}% ok`) +
        `    queue ${e.queue.length}    ${e.throughput()}/min`,
      C.fg,
      '',
      x1,
    );
    x = t.write(x0, 4, 'State:  ', C.white, '', x1);
    if (e.incident) t.write(x, 4, 'DEGRADED — ' + e.incident, C.yellow, '', x1);
    else t.write(x, 4, 'OK', C.green, '', x1);

    const header = pad('AGENT', 11) + pad('ROLE', 8) + pad('STATE', 12) + pad('TIME', 8) + 'TASK';
    t.write(x0, 6, pad(header, x1 - x0), C.barFg, C.fg, x1);
    let y = 7;
    for (const a of this.topAgents) {
      if (y >= bottom) break;
      const waiting = a.waiting;
      const state = waiting ? 'waiting' : a.state;
      const busy = ACTIVE_STATES.has(a.state) || a.task !== null;
      let cx = t.write(x0, y, pad(a.id, 11), busy ? C.fg : C.dim, '', x1);
      cx = t.write(cx, y, pad(ROLE_SHORT[a.role], 8), C.dim, '', x1);
      cx = t.write(cx, y, pad(state, 12), waiting ? C.magenta : STATE_COLOR[a.state], '', x1);
      cx = t.write(cx, y, pad(a.task ? fmtElapsed(e.now - a.assignedAt) : '-', 8), C.fg, '', x1);
      t.write(cx, y, a.task ? a.task.title : '-', busy ? C.fg : C.dim, '', x1);
      y++;
    }
  }

  /** tmux status line. */
  private drawStatus(y: number, wallNow: number): void {
    const t = this.term;
    const d = new Date(wallNow);
    t.write(0, y, pad('', t.cols), C.barFg, C.barBg);
    t.write(0, y, '[agents] 0:agentctl* 1:logs- 2:k8s', C.barFg, C.barBg);
    const right = `"${HOST}.prod.internal" ${fmtClock(wallNow).slice(0, 5)} ${pad(String(d.getDate()), 2, true, '0')}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
    t.write(t.cols - right.length - 1, y, right, C.barFg, C.barBg);
  }
}
