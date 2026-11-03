import type { SimulationEngine } from '../../sim/engine';
import { RingBuffer } from '../../sim/ringbuffer';
import { formatInt } from '../../sim/template';
import { ACTIVE_STATES, type LogLevel } from '../../sim/types';
import { VOCAB } from '../../sim/vocab';
import { fmtClock } from '../dom';
import type { TermCanvas } from '../term/TermCanvas';
import { meter } from './ascii';
import { defcon, hash, P, pad } from './palette';

interface Line {
  text: string;
  color: string;
  inverse?: boolean;
}

/** System output prints at roughly 1200 baud; the operator types at human speed. */
const OUTPUT_CPS = 110;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * The operator console along the bottom: someone types short commands at a ">" prompt and
 * the system answers character by character, WOPR style. System events cut in as
 * "** … **" lines. Presentational only: nothing is executed.
 */
export class Session {
  private lines = new RingBuffer<Line>(60);
  private queue: Line[] = [];
  private revealing: Line | null = null;
  private revealed = 0;
  private state: 'idle' | 'typing' | 'output' = 'idle';
  private cmd = '';
  private typed = 0;
  private typeAcc = 0;
  private until = 3000;
  private lastTick = 0;
  private lastEvent: number;
  private lastCmd = '';

  constructor(private engine: SimulationEngine) {
    const last = engine.events.last();
    this.lastEvent = last ? last.seq : 0;
    this.queue.push({ text: 'CONNECTED TO ' + 'AGENT ORCHESTRATOR ON CTL-01', color: P.dim });
    this.queue.push({ text: 'LOGON: OPS', color: P.dim });
  }

  tick(now: number): void {
    const dt = this.lastTick ? now - this.lastTick : 100;
    this.lastTick = now;
    this.collectEvents();

    if (this.revealing) {
      this.revealed += (dt / 1000) * OUTPUT_CPS;
      if (this.revealed >= this.revealing.text.length) {
        this.lines.push(this.revealing);
        this.revealing = null;
      }
    }
    if (!this.revealing && this.queue.length && this.state !== 'typing') {
      this.revealing = this.queue.shift() as Line;
      this.revealed = 0;
    }

    if (this.state === 'idle' && !this.revealing && !this.queue.length && now >= this.until) {
      this.cmd = this.pickCommand();
      this.typed = 0;
      this.typeAcc = 0;
      this.state = 'typing';
    } else if (this.state === 'typing') {
      this.typeAcc += (dt / 1000) * rand(7, 13);
      const n = Math.floor(this.typeAcc);
      this.typeAcc -= n;
      this.typed = Math.min(this.cmd.length, this.typed + n);
      if (this.typed >= this.cmd.length && Math.random() < 0.4) {
        this.lines.push({ text: '> ' + this.cmd, color: P.fg });
        for (const line of this.respond(this.cmd)) this.queue.push(line);
        this.state = 'output';
      }
    } else if (this.state === 'output' && !this.revealing && !this.queue.length) {
      this.state = 'idle';
      this.until = now + rand(2500, 6500);
    }
  }

  draw(t: TermCanvas, x0: number, y0: number, x1: number, y1: number, now: number): void {
    const height = y1 - y0 + 1;
    const rows: { line: Line; chars: number }[] = [];
    if (this.revealing) rows.push({ line: this.revealing, chars: Math.floor(this.revealed) });
    if (this.state === 'typing' || (this.state === 'idle' && !this.revealing && !this.queue.length)) {
      rows.push({ line: { text: '> ' + this.cmd.slice(0, this.state === 'typing' ? this.typed : 0), color: P.fg }, chars: -1 });
    }
    const history = Math.max(0, height - rows.length);
    const shown = Math.min(history, this.lines.length);
    const all: { line: Line; chars: number }[] = [];
    for (let i = shown - 1; i >= 0; i--) all.push({ line: this.lines.fromEnd(i), chars: -1 });
    for (const r of rows) all.push(r);
    let y = y0 + Math.max(0, height - all.length);
    let endX = x0;
    for (const { line, chars } of all) {
      const text = chars < 0 ? line.text : line.text.slice(0, chars);
      endX = line.inverse ? t.write(x0, y, text, P.bg, line.color, x1 + 1) : t.write(x0, y, text, line.color, '', x1 + 1);
      y++;
    }
    if (Math.floor(now / 500) % 2 === 0) t.write(endX, y - 1, '█', P.fg, '', x1 + 1);
  }

  private collectEvents(): void {
    const events = this.engine.events;
    const fresh = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events.fromEnd(i);
      if (ev.seq <= this.lastEvent) break;
      fresh.unshift(ev);
    }
    for (const ev of fresh) {
      this.lastEvent = ev.seq;
      const level: LogLevel = ev.level;
      this.queue.push({
        text: '** ' + fmtClock(ev.ts) + '  ' + ev.text.toUpperCase().replace(/—/g, '-') + ' **',
        color: level === 'err' ? P.fg : level === 'warn' || level === 'ok' ? P.bright : P.dim,
        inverse: level === 'err',
      });
    }
  }

  private pickCommand(): string {
    const e = this.engine;
    const busy = e.agents.filter((a) => ACTIVE_STATES.has(a.state));
    const options = [
      'STATUS',
      'LIST QUEUE',
      'LIST AGENTS IDLE',
      busy.length ? 'TRACE ' + busy[(Math.random() * busy.length) | 0].id.toUpperCase() : 'STATUS',
      'PING NODES',
      'SHOW THROUGHPUT',
      'SCAN THREAT LEVEL',
      'DISPATCH STATUS',
    ];
    for (;;) {
      const cmd = options[(Math.random() * options.length) | 0];
      const key = cmd.split(' ')[0] + cmd.split(' ')[1];
      if (key !== this.lastCmd) {
        this.lastCmd = key;
        return cmd;
      }
    }
  }

  private respond(cmd: string): Line[] {
    const e = this.engine;
    const out = (text: string, color = P.dim): Line => ({ text: text.toUpperCase(), color });
    const active = e.activeAgents();
    if (cmd === 'STATUS') {
      const rate = e.successRate();
      return [
        out(`AGENTS ${active}/${e.agents.length} ACTIVE   TASKS ${formatInt(e.stats.completed)} COMPLETE   ` +
          `SUCCESS ${rate === null ? '--' : (rate * 100).toFixed(1) + '%'}   QUEUE ${e.queue.length}`),
      ];
    }
    if (cmd === 'LIST QUEUE') {
      if (!e.queue.length) return [out('QUEUE EMPTY.')];
      const lines = e.queue.slice(0, 3).map((task) => out(`${pad(task.key, 11)}${pad(task.role, 16)}${task.title}`));
      if (e.queue.length > 3) lines.push(out(`... ${e.queue.length - 3} MORE`));
      return lines;
    }
    if (cmd === 'LIST AGENTS IDLE') {
      const idle = e.agents.filter((a) => a.state === 'idle');
      if (!idle.length) return [out('NO IDLE AGENTS. ALL UNITS COMMITTED.')];
      return [out(`${idle.length} IDLE: ` + idle.slice(0, 10).map((a) => a.id).join(' '))];
    }
    if (cmd.indexOf('TRACE ') === 0) {
      const agent = e.agents.find((a) => a.id.toUpperCase() === cmd.slice(6));
      if (!agent || !agent.task) return [out('AGENT NOT RESPONDING.')];
      const progress = e.progress(agent);
      return [
        out(`${agent.id}  ${agent.role}  ${agent.waiting ? 'WAITING' : agent.state}  ${agent.task.key}`),
        out(`${agent.task.title}  [${meter(progress, 20)}] ${Math.round(progress * 100)}%`),
      ];
    }
    if (cmd === 'PING NODES') {
      const parts = VOCAB.cluster.map((c) => {
        const down = e.incident !== null && e.incident.indexOf(c) >= 0;
        const ms = 6 + (hash(c + Math.floor(e.now / 4000)) % 30);
        return `${c} ${down ? '---- DEGRADED' : ms + 'MS OK'}`;
      });
      return [out(parts.join('   '))];
    }
    if (cmd === 'SHOW THROUGHPUT') {
      let peak = 0;
      for (let i = 0; i < e.history.length; i++) peak = Math.max(peak, e.history.get(i).throughput);
      return [out(`${e.throughput()} TASKS/MIN.  PEAK ${peak}.  RETRIES ${formatInt(e.stats.retries)}.`)];
    }
    if (cmd === 'SCAN THREAT LEVEL') {
      const level = defcon(e);
      const word = level === 5 ? 'LOW' : level === 4 ? 'GUARDED' : 'ELEVATED';
      return [out(`THREAT LEVEL ${word}.  DEFCON ${level}.`, level < 5 ? P.bright : P.dim)];
    }
    return [out(`SCHEDULER NOMINAL.  LOAD ${Math.round(e.load * 100)}%.  ${e.running.size} TASKS IN FLIGHT.`)];
  }
}
