import type { SimulationEngine } from '../../sim/engine';
import { RingBuffer } from '../../sim/ringbuffer';
import { formatInt } from '../../sim/template';
import { ACTIVE_STATES, type Agent, type LogLevel, type LogLine } from '../../sim/types';
import { fmtClock, fmtSecs } from '../dom';
import type { TermCanvas } from '../term/TermCanvas';
import { C, HOST, hash, pad } from './palette';

export interface Seg {
  t: string;
  c: string;
}
export type Line = Seg[];

const LEVEL_COLOR: Record<LogLevel, string> = { info: C.fg, ok: C.green, warn: C.yellow, err: C.red, dim: C.dim };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A running command. tick() returns true when it has finished. */
interface Runner {
  tick(now: number): boolean;
}

interface Command {
  weight: number;
  make(): { cmd: string; run: (now: number) => Runner };
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * The left tmux pane: a shell where an operator types commands and output streams from the
 * simulation. Purely presentational: commands are a script, nothing is executed.
 */
export class Shell {
  private lines = new RingBuffer<Line>(200);
  private state: 'prompt' | 'typing' | 'running' = 'prompt';
  private until = 0;
  private cmd = '';
  private typed = 0;
  private typeAcc = 0;
  private runner: Runner | null = null;
  private pending: { cmd: string; run: (now: number) => Runner } | null = null;
  private last = '';
  private lastTick = 0;
  private commands: Command[];

  constructor(private engine: SimulationEngine) {
    this.commands = [
      { weight: 3, make: () => ({ cmd: 'agentctl logs -f --all', run: (n) => this.logStream(null, n) }) },
      { weight: 3, make: () => this.tailAgent() },
      { weight: 1.5, make: () => ({ cmd: 'journalctl -u agent-orchestrator -f -n 6', run: (n) => this.journal(n) }) },
      { weight: 1.5, make: () => ({ cmd: 'agentctl queue', run: () => this.print(this.queueOut()) }) },
      { weight: 1.5, make: () => ({ cmd: 'agentctl status', run: () => this.print(this.statusOut()) }) },
      { weight: 1.3, make: () => ({ cmd: 'kubectl get pods -n agents', run: () => this.print(this.podsOut()) }) },
      { weight: 1, make: () => ({ cmd: 'uptime', run: () => this.print(this.uptimeOut()) }) },
      { weight: 0.6, make: () => ({ cmd: 'free -h', run: () => this.print(this.freeOut()) }) },
      { weight: 0.5, make: () => ({ cmd: 'df -h /srv', run: () => this.print(this.dfOut()) }) },
      { weight: 0.4, make: () => ({ cmd: 'clear', run: () => this.clearScreen() }) },
    ];
    this.until = 2500;
    this.banner();
  }

  /** What you see right after logging in over SSH. */
  private banner(): void {
    const e = this.engine;
    const login = new Date(e.clockBase + e.now - 3_600_000 * (2 + Math.random() * 20));
    const motd: Line[] = [
      [{ t: 'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-49-generic x86_64)', c: C.fg }],
      [],
      [{ t: '  System load:  ' + (e.load * 4).toFixed(2) + '              Processes:             ' + (380 + e.agents.length * 6), c: C.fg }],
      [{ t: '  Usage of /:   41.7% of 196GB     Users logged in:       2', c: C.fg }],
      [{ t: '  Memory usage: ' + Math.round(45 + e.load * 30) + '%               IPv4 address for eth0: <redacted>', c: C.fg }],
      [{ t: '  Swap usage:   0%', c: C.fg }],
      [],
      [{ t: '  agent-orchestrator: ' + e.agents.length + ' agents registered', c: C.fg }],
      [],
      [{ t: 'Last login: ' + login.toDateString() + ' ' + fmtClock(login.getTime()) + ' from bastion.internal', c: C.fg }],
    ];
    for (const line of motd) this.lines.push(line);
  }

  // ---- script ----------------------------------------------------------------------------

  tick(now: number): void {
    const dt = this.lastTick ? now - this.lastTick : 100;
    this.lastTick = now;
    if (this.state === 'prompt') {
      if (now < this.until) return;
      this.pending = this.pick();
      this.cmd = this.pending.cmd;
      this.typed = 0;
      this.typeAcc = 0;
      this.state = 'typing';
    } else if (this.state === 'typing') {
      // 9–15 characters per second, a little uneven like a person.
      this.typeAcc += (dt / 1000) * rand(9, 15);
      const n = Math.floor(this.typeAcc);
      this.typeAcc -= n;
      this.typed = Math.min(this.cmd.length, this.typed + n);
      if (this.typed >= this.cmd.length && Math.random() < 0.5) {
        this.lines.push(this.promptLine(this.cmd));
        this.runner = (this.pending as { run: (now: number) => Runner }).run(now);
        this.state = 'running';
      }
    } else if (this.runner && this.runner.tick(now)) {
      this.runner = null;
      this.state = 'prompt';
      this.until = now + rand(1200, 3500);
    }
  }

  private pick(): { cmd: string; run: (now: number) => Runner } {
    for (;;) {
      let total = 0;
      for (const c of this.commands) total += c.weight;
      let r = Math.random() * total;
      let chosen = this.commands[0];
      for (const c of this.commands) {
        r -= c.weight;
        if (r < 0) {
          chosen = c;
          break;
        }
      }
      const made = chosen.make();
      const key = made.cmd.split(' ').slice(0, 2).join(' ');
      if (key !== this.last) {
        this.last = key;
        return made;
      }
    }
  }

  // ---- drawing ---------------------------------------------------------------------------

  draw(term: TermCanvas, x0: number, y0: number, x1: number, y1: number, now: number): void {
    const height = y1 - y0;
    const cursorOn = Math.floor(now / 530) % 2 === 0;
    let current: Line;
    if (this.state === 'running') current = [];
    else current = this.promptLine(this.cmd.slice(0, this.state === 'typing' ? this.typed : 0));
    const shown = Math.min(this.lines.length, height - 1);
    // Like a real terminal: fill from the top; once the pane is full older lines scroll off.
    let y = y0;
    for (let i = shown - 1; i >= 0; i--, y++) this.drawLine(term, this.lines.fromEnd(i), x0, y, x1);
    const end = this.drawLine(term, current, x0, y, x1);
    if (cursorOn) term.write(end, y, '█', C.fg, '', x1);
  }

  private drawLine(term: TermCanvas, line: Line, x0: number, y: number, x1: number): number {
    let x = x0;
    for (const seg of line) x = term.write(x, y, seg.t, seg.c, '', x1);
    return x;
  }

  private promptLine(typed: string): Line {
    return [
      { t: 'ops@' + HOST, c: C.bgreen },
      { t: ':', c: C.fg },
      { t: '~', c: C.blue },
      { t: '$ ', c: C.fg },
      { t: typed, c: C.fg },
    ];
  }

  // ---- runners ---------------------------------------------------------------------------

  /** Emits prepared output a few lines per tick, like a command printing quickly. */
  private print(out: Line[]): Runner {
    let i = 0;
    return {
      tick: () => {
        for (let k = 0; k < 6 && i < out.length; k++) this.lines.push(out[i++]);
        return i >= out.length;
      },
    };
  }

  private clearScreen(): Runner {
    this.lines.clear();
    return { tick: () => true };
  }

  private tailAgent(): { cmd: string; run: (now: number) => Runner } {
    const busy = this.engine.agents.filter((a) => ACTIVE_STATES.has(a.state));
    const pool = busy.length ? busy : this.engine.agents;
    const agent = pool[(Math.random() * pool.length) | 0];
    return {
      cmd: 'tail -f /var/log/agents/' + agent.id + '.log',
      run: (now) => {
        const n = Math.min(10, agent.log.length);
        for (let i = n - 1; i >= 0; i--) this.lines.push(this.logLine(agent, agent.log.fromEnd(i), false));
        return this.logStream(agent, now);
      },
    };
  }

  /** Streams new log lines from one agent, or all of them, until interrupted with ^C. */
  private logStream(only: Agent | null, now: number): Runner {
    const agents = only ? [only] : this.engine.agents;
    const seen = new Map<Agent, number>();
    for (const a of agents) seen.set(a, a.log.length ? (a.log.last() as LogLine).seq : 0);
    const end = now + rand(25_000, 60_000);
    const fresh: { agent: Agent; line: LogLine }[] = [];
    return {
      tick: (t) => {
        fresh.length = 0;
        for (const a of agents) {
          const last = seen.get(a) as number;
          for (let i = 0; i < a.log.length; i++) {
            const line = a.log.fromEnd(i);
            if (line.seq <= last) break;
            fresh.push({ agent: a, line });
          }
          if (a.log.length) seen.set(a, (a.log.last() as LogLine).seq);
        }
        fresh.sort((p, q) => p.line.seq - q.line.seq);
        for (const f of fresh) this.lines.push(this.logLine(f.agent, f.line, only === null));
        if (t < end) return false;
        this.lines.push([{ t: '^C', c: C.fg }]);
        return true;
      },
    };
  }

  private journal(now: number): Runner {
    const events = this.engine.events;
    const n = Math.min(6, events.length);
    for (let i = n - 1; i >= 0; i--) this.lines.push(this.journalLine(events.fromEnd(i)));
    let seen = events.length ? (events.last() as { seq: number }).seq : 0;
    const end = now + rand(20_000, 40_000);
    return {
      tick: (t) => {
        const fresh = [];
        for (let i = 0; i < events.length; i++) {
          const ev = events.fromEnd(i);
          if (ev.seq <= seen) break;
          fresh.unshift(ev);
        }
        if (fresh.length) seen = fresh[fresh.length - 1].seq;
        for (const ev of fresh) this.lines.push(this.journalLine(ev));
        if (t < end) return false;
        this.lines.push([{ t: '^C', c: C.fg }]);
        return true;
      },
    };
  }

  // ---- output formatting -----------------------------------------------------------------

  private logLine(agent: Agent, line: LogLine, withAgent: boolean): Line {
    const color = LEVEL_COLOR[line.level];
    const out: Line = [{ t: fmtClock(line.ts) + ' ', c: C.dim }];
    if (withAgent) out.push({ t: agent.id + ' ', c: C.cyan });
    out.push({ t: '[' + line.tag + '] ', c: line.level === 'info' ? C.blue : color });
    out.push({ t: line.text, c: color });
    return out;
  }

  private journalLine(ev: { ts: number; text: string; level: LogLevel }): Line {
    const d = new Date(ev.ts);
    const stamp = MONTHS[d.getMonth()] + ' ' + pad(String(d.getDate()), 2, true, '0') + ' ' + fmtClock(ev.ts);
    return [
      { t: stamp + ' ' + HOST + ' agent-orchestrator[1342]: ', c: C.dim },
      { t: ev.text, c: LEVEL_COLOR[ev.level] === C.fg ? C.fg : LEVEL_COLOR[ev.level] },
    ];
  }

  private queueOut(): Line[] {
    const e = this.engine;
    const out: Line[] = [[{ t: pad('TASK', 11) + pad('PRI', 5) + pad('ROLE', 16) + pad('WAIT', 9) + 'TITLE', c: C.white }]];
    for (const task of e.queue.slice(0, 14)) {
      const pri = task.priority >= 2 ? 'sub' : task.priority === 1 ? 'high' : '-';
      out.push([
        { t: pad(task.key, 11), c: C.cyan },
        { t: pad(pri, 5), c: task.priority ? C.yellow : C.dim },
        { t: pad(task.role, 16) + pad(fmtSecs(e.now - task.createdAt), 9), c: C.fg },
        { t: task.title, c: C.fg },
      ]);
    }
    out.push([{ t: e.queue.length + ' queued, ' + e.running.size + ' running', c: C.dim }]);
    return out;
  }

  private statusOut(): Line[] {
    const e = this.engine;
    const active = e.activeAgents();
    const rate = e.successRate();
    const ok = e.incident === null;
    return [
      [{ t: '● ', c: ok ? C.green : C.yellow }, { t: 'agent-orchestrator — ' + (ok ? 'healthy' : 'degraded'), c: C.white }],
      [{ t: '    Agents: ', c: C.dim }, { t: `${e.agents.length} registered, ${active} active, ${e.agents.length - active} idle`, c: C.fg }],
      [
        { t: '     Tasks: ', c: C.dim },
        {
          t: `${formatInt(e.stats.completed)} completed, ${formatInt(e.stats.failed)} failed` +
            (rate === null ? '' : ` (${(rate * 100).toFixed(1)}% success)`) + `, ${formatInt(e.stats.retries)} retries`,
          c: C.fg,
        },
      ],
      [{ t: '     Queue: ', c: C.dim }, { t: `${e.queue.length} waiting, ${e.running.size} running, ${e.throughput()}/min`, c: C.fg }],
      [{ t: '      Load: ', c: C.dim }, { t: Math.round(e.load * 100) + '%', c: C.fg }],
      ok ? [] : [{ t: '  Incident: ', c: C.dim }, { t: e.incident as string, c: C.yellow }],
    ].filter((l) => l.length);
  }

  private podsOut(): Line[] {
    const out: Line[] = [[{ t: pad('NAME', 30) + pad('READY', 8) + pad('STATUS', 10) + pad('RESTARTS', 11) + 'AGE', c: C.white }]];
    for (const a of this.engine.agents.slice(0, 18)) {
      const h = hash(a.id);
      const name = a.id + '-' + (h % 0xfffff).toString(16).padStart(5, '0') + '-' + ((h >>> 7) % 46656).toString(36).padStart(3, '0');
      const status = a.state === 'failed' ? 'Error' : 'Running';
      out.push([
        { t: pad(name, 30) + pad('1/1', 8), c: C.fg },
        { t: pad(status, 10), c: status === 'Running' ? C.fg : C.red },
        { t: pad(String(h % 4), 11) + (30 + (h % 40)) + 'd', c: C.fg },
      ]);
    }
    return out;
  }

  private uptimeOut(): Line[] {
    const e = this.engine;
    const now = e.clockBase + e.now;
    const days = 41 + Math.floor(e.now / 86_400_000);
    const l1 = (e.activeAgents() / e.agents.length) * 6 + e.load;
    const fmt = (v: number): string => v.toFixed(2);
    return [[{ t: ` ${fmtClock(now)} up ${days} days,  4:12,  2 users,  load average: ${fmt(l1)}, ${fmt(l1 * 0.94)}, ${fmt(l1 * 0.88)}`, c: C.fg }]];
  }

  private freeOut(): Line[] {
    const used = 14 + this.engine.load * 9 + Math.random();
    const head = pad('', 15) + pad('total', 12, true) + pad('used', 12, true) + pad('free', 12, true) + pad('shared', 12, true) + pad('buff/cache', 12, true) + pad('available', 12, true);
    const mem = pad('Mem:', 15) + pad('31Gi', 12, true) + pad(used.toFixed(1) + 'Gi', 12, true) + pad((31 - used - 9.6).toFixed(1) + 'Gi', 12, true) + pad('412Mi', 12, true) + pad('9.6Gi', 12, true) + pad((31 - used).toFixed(1) + 'Gi', 12, true);
    const swap = pad('Swap:', 15) + pad('4.0Gi', 12, true) + pad('0B', 12, true) + pad('4.0Gi', 12, true);
    return [[{ t: head, c: C.fg }], [{ t: mem, c: C.fg }], [{ t: swap, c: C.fg }]];
  }

  private dfOut(): Line[] {
    return [
      [{ t: 'Filesystem      Size  Used Avail Use% Mounted on', c: C.fg }],
      [{ t: '/dev/nvme0n1p3  1.8T  1.1T  642G  64% /srv', c: C.fg }],
    ];
  }
}
