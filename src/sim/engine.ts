import { MinHeap } from './heap';
import { createRng, type Rng } from './prng';
import { RingBuffer } from './ringbuffer';
import { parseLine, resolve, type TaskTemplate } from './template';
import { GENERIC_FAIL, GENERIC_FIX, RETRY_REASONS, TEMPLATES } from './templates';
import {
  ACTIVE_STATES,
  ROLES,
  TRANSITIONS,
  type Agent,
  type AgentState,
  type HistoryPoint,
  type LogLevel,
  type Role,
  type Step,
  type StepAction,
  type SystemEvent,
  type Task,
} from './types';
import { VOCAB } from './vocab';

export interface EngineConfig {
  seed: number;
  agents: number;
  /** Hard cap on waiting tasks. */
  maxQueue: number;
  /** Log lines kept per agent. */
  logBuffer: number;
  /** Finished tasks kept for the "recent" list. */
  recentLimit: number;
  /** Arrival rate as a share of agent capacity at the lowest load level. */
  minUtilization: number;
  /** Arrival rate as a share of agent capacity at the highest load level. */
  maxUtilization: number;
  /** Simulated ms between history samples. */
  sampleMs: number;
  /** History samples kept (sampleMs × historySize is the chart window). */
  historySize: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  seed: 1,
  agents: 30,
  maxQueue: 40,
  logBuffer: 30,
  recentLimit: 30,
  minUtilization: 0.55,
  maxUtilization: 1.1,
  sampleMs: 2000,
  historySize: 150,
};

export const MAX_ATTEMPTS = 3;
/** Longest a parent task waits for its subtasks before carrying on without them. */
const SUBTASK_TIMEOUT_MS = 90_000;

type MacroKind = 'batch' | 'surge' | 'incident';

type SimEvent =
  | { t: number; seq: number; kind: 'agent'; agent: Agent; token: number }
  | { t: number; seq: number; kind: 'arrival' }
  | { t: number; seq: number; kind: 'sample' }
  | { t: number; seq: number; kind: 'load' }
  | { t: number; seq: number; kind: 'macro' }
  | { t: number; seq: number; kind: 'macroEnd'; macro: MacroKind };
type NewEvent = SimEvent extends infer E ? (E extends SimEvent ? Omit<E, 'seq'> : never) : never;

const ROLE_WEIGHT: Record<Role, number> = {
  Code: 6,
  QA: 4,
  Security: 2,
  Data: 3,
  Infrastructure: 3,
  Research: 2,
  Documentation: 2,
  Deployment: 3,
};

/** Templates suited to bulk "batch window" events. */
const BATCH_TEMPLATES = ['doc-index', 'etl-nightly', 'smoke-tests', 'dep-audit', 'data-quality', 'container-scan'];

/**
 * Owns agents, tasks and the central scheduler. Purely simulated time: nothing here reads
 * the wall clock or touches the DOM, so a given seed and config replays identically.
 */
export class SimulationEngine {
  readonly cfg: EngineConfig;
  readonly rng: Rng;
  /** Simulated time in ms since start. */
  now = 0;
  /** Epoch ms that simulated time 0 maps to, for display timestamps. Set by the runtime. */
  clockBase = 0;

  readonly agents: Agent[] = [];
  /** Waiting tasks, highest priority first, then oldest first. */
  readonly queue: Task[] = [];
  readonly running = new Map<number, Task>();
  readonly recent: RingBuffer<Task>;
  readonly events = new RingBuffer<SystemEvent>(40);
  readonly history: RingBuffer<HistoryPoint>;
  readonly stats = { created: 0, completed: 0, failed: 0, retries: 0, subtasks: 0 };
  /** Demand level 0..1. Drifts slowly towards loadTarget. */
  load = 0.6;
  loadTarget = 0.6;
  /** Description of the ongoing incident, if any. */
  incident: string | null = null;
  /** Count of illegal state transitions; must stay 0. */
  transitionErrors = 0;
  queueRev = 0;
  recentRev = 0;

  private readonly heap = new MinHeap<SimEvent>();
  private readonly templates = new Map<string, TaskTemplate>();
  private readonly byId = new Map<string, Agent>();
  private readonly finishTimes: number[] = [];
  private seq = 0;
  private taskSeq = 0;
  private logSeq = 0;
  private eventSeq = 0;
  private readonly meanTaskMs: number;
  private surge = 1;
  private failBoost = 1;

  constructor(cfg: Partial<EngineConfig> = {}, clockBase = 0) {
    this.clockBase = clockBase;
    this.cfg = { ...DEFAULT_ENGINE_CONFIG, ...cfg };
    this.cfg.agents = Math.max(8, Math.min(120, Math.round(this.cfg.agents)));
    this.rng = createRng(this.cfg.seed);
    this.recent = new RingBuffer<Task>(this.cfg.recentLimit);
    this.history = new RingBuffer<HistoryPoint>(this.cfg.historySize);
    for (const tpl of TEMPLATES) this.templates.set(tpl.id, tpl);

    let totalWeight = 0;
    let weightedSecs = 0;
    for (const tpl of TEMPLATES) {
      const w = tpl.weight ?? 1;
      totalWeight += w;
      weightedSecs += w * ((tpl.base[0] + tpl.base[1]) / 2);
    }
    // Average work plus assignment, wrap-up and cooldown overhead.
    this.meanTaskMs = (weightedSecs / totalWeight) * 1100 + 5500;

    this.createAgents();
    this.load = this.loadTarget = this.rng.float(0.45, 0.8);
    this.systemEvent('info', `Orchestrator online — ${this.agents.length} agents registered`);
    const initial = Math.min(this.cfg.maxQueue, Math.round(this.agents.length * 0.8));
    for (let i = 0; i < initial; i++) this.createTask();
    for (const agent of this.agents) this.scheduleAgent(agent, this.rng.float(200, 2500));
    this.scheduleArrival();
    this.push({ t: this.cfg.sampleMs, kind: 'sample' });
    this.push({ t: this.rng.float(60_000, 180_000), kind: 'load' });
    this.push({ t: this.rng.float(90_000, 240_000), kind: 'macro' });
  }

  // ---- public read API -------------------------------------------------------------------

  advance(dtMs: number): void {
    this.advanceTo(this.now + dtMs);
  }

  advanceTo(target: number): void {
    for (;;) {
      const ev = this.heap.peek();
      if (!ev || ev.t > target) break;
      this.heap.pop();
      this.now = ev.t;
      this.handle(ev);
    }
    if (target > this.now) this.now = target;
    this.trimFinishTimes();
  }

  activeAgents(): number {
    let n = 0;
    for (const a of this.agents) if (ACTIVE_STATES.has(a.state)) n++;
    return n;
  }

  /** Tasks finished (completed or failed) in the last 60 simulated seconds. */
  throughput(): number {
    this.trimFinishTimes();
    return this.finishTimes.length;
  }

  /** Share of finished tasks that completed, or null before anything has finished. */
  successRate(): number | null {
    const done = this.stats.completed + this.stats.failed;
    return done ? this.stats.completed / done : null;
  }

  /** Progress of the agent's current attempt, 0..1. */
  progress(agent: Agent): number {
    if (!agent.task || !agent.stepTotal) return 0;
    return Math.min(1, agent.stepIndex / agent.stepTotal);
  }

  pendingEvents(): number {
    return this.heap.size;
  }

  // ---- setup -----------------------------------------------------------------------------

  private createAgents(): void {
    const used = new Set<number>();
    const nums: number[] = [];
    const span = Math.max(300, this.cfg.agents * 6);
    while (nums.length < this.cfg.agents) {
      const n = this.rng.int(1, span);
      if (!used.has(n)) {
        used.add(n);
        nums.push(n);
      }
    }
    nums.sort((a, b) => a - b);
    // Guarantee every role is staffed, then fill by weight.
    const roles: Role[] = [...ROLES];
    while (roles.length < nums.length) roles.push(this.rng.weighted(ROLES, (r) => ROLE_WEIGHT[r]));
    for (let i = roles.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    nums.forEach((num, i) => {
      const agent: Agent = {
        id: 'agent-' + String(num).padStart(3, '0'),
        num,
        role: roles[i],
        state: 'idle',
        stateSince: 0,
        task: null,
        steps: [],
        stepIndex: 0,
        stepTotal: 0,
        log: new RingBuffer(this.cfg.logBuffer),
        tempo: this.rng.float(0.82, 1.22),
        workMs: 0,
        waiting: false,
        completed: 0,
        failed: 0,
        token: 0,
        assignedAt: 0,
        rev: 0,
      };
      this.agents.push(agent);
      this.byId.set(agent.id, agent);
    });
  }

  // ---- scheduler -------------------------------------------------------------------------

  private push(ev: NewEvent): void {
    (ev as SimEvent).seq = ++this.seq;
    this.heap.push(ev as SimEvent);
  }

  private scheduleAgent(agent: Agent, dt: number): void {
    agent.token++;
    this.push({ t: this.now + Math.max(1, dt), kind: 'agent', agent, token: agent.token });
  }

  private scheduleArrival(): void {
    const c = this.cfg;
    const utilization = (c.minUtilization + (c.maxUtilization - c.minUtilization) * this.load) * this.surge;
    const mean = this.meanTaskMs / (this.agents.length * utilization);
    this.push({ t: this.now + Math.max(50, this.rng.exp(mean)), kind: 'arrival' });
  }

  private handle(ev: SimEvent): void {
    switch (ev.kind) {
      case 'agent': {
        const agent = ev.agent;
        if (ev.token !== agent.token) return;
        if (agent.state === 'idle') this.poll(agent);
        else if (agent.waiting) this.resume(agent);
        else this.runStep(agent);
        return;
      }
      case 'arrival':
        if (this.queue.length < this.cfg.maxQueue) this.createTask();
        if (this.queue.length < 2) this.createTask();
        this.scheduleArrival();
        return;
      case 'sample':
        this.sample();
        this.push({ t: this.now + this.cfg.sampleMs, kind: 'sample' });
        return;
      case 'load':
        this.shiftLoad();
        this.push({ t: this.now + this.rng.float(60_000, 180_000), kind: 'load' });
        return;
      case 'macro':
        this.startMacro();
        this.push({ t: this.now + this.rng.float(150_000, 420_000), kind: 'macro' });
        return;
      case 'macroEnd':
        this.endMacro(ev.macro);
        return;
    }
  }

  // ---- load & rare events ----------------------------------------------------------------

  private sample(): void {
    // Ease towards the target: noticeable over a minute, never a jump.
    this.load += (this.loadTarget - this.load) * 0.04;
    this.history.push({
      t: this.now,
      active: this.activeAgents(),
      queue: this.queue.length,
      throughput: this.throughput(),
    });
  }

  private shiftLoad(): void {
    const prev = this.loadTarget;
    this.loadTarget = this.rng.float(0.2, 1);
    const pct = Math.round(this.loadTarget * 100);
    if (this.loadTarget > prev + 0.15) this.systemEvent('info', `Demand rising — load target ${pct}%`);
    else if (this.loadTarget < prev - 0.15) this.systemEvent('info', `Demand easing — load target ${pct}%`);
  }

  private startMacro(): void {
    const kinds: MacroKind[] = ['batch', 'surge', 'incident'];
    const kind = this.rng.weighted(kinds, (k) => (k === 'batch' ? 0.45 : k === 'surge' ? 0.3 : 0.25));
    if (kind === 'batch') {
      const tpl = this.templates.get(this.rng.pick(BATCH_TEMPLATES)) as TaskTemplate;
      const k = Math.min(this.rng.int(6, 12), this.cfg.maxQueue - this.queue.length);
      if (k < 3) return;
      for (let i = 0; i < k; i++) this.createTask(tpl);
      this.systemEvent('info', `Batch window: ${k} × ${tpl.role} jobs (${tpl.id}) enqueued`);
    } else if (kind === 'surge') {
      if (this.surge > 1) return;
      this.surge = this.rng.float(1.6, 2.2);
      const source = this.rng.pick(VOCAB.service);
      this.systemEvent('warn', `Inbound surge from ${source} — arrival rate ×${this.surge.toFixed(1)}`);
      this.push({ t: this.now + this.rng.float(40_000, 90_000), kind: 'macroEnd', macro: 'surge' });
    } else {
      if (this.incident) return;
      this.failBoost = this.rng.float(3, 5);
      this.incident = `Elevated failure rate on ${this.rng.pick(VOCAB.cluster)} runners`;
      this.systemEvent('err', this.incident);
      this.push({ t: this.now + this.rng.float(45_000, 100_000), kind: 'macroEnd', macro: 'incident' });
    }
  }

  private endMacro(kind: MacroKind): void {
    if (kind === 'surge') {
      this.surge = 1;
      this.systemEvent('ok', 'Inbound rate back to normal');
    } else if (kind === 'incident' && this.incident) {
      this.systemEvent('ok', 'Recovered — ' + this.incident.replace('Elevated failure rate on', '').trim() + ' healthy');
      this.incident = null;
      this.failBoost = 1;
    }
  }

  // ---- tasks -----------------------------------------------------------------------------

  private createTask(template?: TaskTemplate, parent?: Task): Task {
    const tpl = template ?? this.rng.weighted(TEMPLATES, (t) => t.weight ?? 1);
    const vars: Record<string, string> = {};
    const id = ++this.taskSeq;
    const task: Task = {
      id,
      key: 'TSK-' + (10400 + id),
      title: resolve(tpl.title, vars, this.rng),
      templateId: tpl.id,
      role: tpl.role,
      complexity: this.rng.float(0.6, 1.5),
      priority: parent ? 2 : this.rng.chance(0.12) ? 1 : 0,
      status: 'queued',
      createdAt: this.now,
      startedAt: 0,
      endedAt: 0,
      agentId: null,
      attempts: 0,
      vars,
      parentId: parent ? parent.id : null,
      pendingSubtasks: 0,
    };
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].priority < task.priority) i--;
    this.queue.splice(i, 0, task);
    this.stats.created++;
    this.queueRev++;
    return task;
  }

  private pickTask(agent: Agent): number {
    for (let i = 0; i < this.queue.length; i++) if (this.queue[i].role === agent.role) return i;
    // Generalist fallback: help out with work that has been waiting a while.
    for (let i = 0; i < this.queue.length; i++) {
      if (this.now - this.queue[i].createdAt > 6000) return i;
    }
    return -1;
  }

  private poll(agent: Agent): void {
    const i = this.pickTask(agent);
    if (i < 0) {
      this.scheduleAgent(agent, this.rng.float(1500, 4000));
      return;
    }
    const task = this.queue.splice(i, 1)[0];
    this.queueRev++;
    this.assign(agent, task);
  }

  private assign(agent: Agent, task: Task): void {
    const tpl = this.tpl(task);
    task.status = 'running';
    task.startedAt = this.now;
    task.agentId = agent.id;
    task.attempts = 1;
    this.running.set(task.id, task);
    agent.task = task;
    agent.assignedAt = this.now;

    const mismatch = task.role === agent.role ? 1 : 1.25;
    // Busy periods slow everyone down a little (shared runners, contention).
    const pace = 0.9 + 0.25 * this.load;
    const duration = this.rng.float(tpl.base[0], tpl.base[1]) * 1000 * task.complexity * mismatch * agent.tempo * pace;
    agent.workMs = duration;
    const steps: Step[] = [
      { dt: 0, state: 'assigned', tag: agent.id, text: `Assigned: ${task.title} (${task.key})` },
    ];
    this.phase(steps, task, 'analyzing', tpl.analyze, duration * 0.22, this.rng.float(600, 1600));
    this.phase(steps, task, 'planning', tpl.plan, duration * 0.12);
    if (tpl.subtasks && task.parentId === null) steps.push({ dt: this.rng.float(300, 900), action: 'spawn' });
    this.phase(steps, task, 'executing', tpl.execute, duration * 0.42);
    if (tpl.subtasks && task.parentId === null) steps.push({ dt: this.rng.float(300, 900), action: 'wait' });
    this.phase(steps, task, 'validating', tpl.validate, duration * 0.24);
    steps.push({ dt: this.rng.float(800, 2400), action: 'outcome' });
    this.startSteps(agent, steps);
  }

  /** Appends one state's log lines, spread over roughly `duration` ms. */
  private phase(
    steps: Step[],
    task: Task,
    state: AgentState,
    lines: readonly string[],
    duration: number,
    firstDt?: number,
  ): void {
    const per = duration / Math.max(1, lines.length);
    lines.forEach((raw, i) => {
      const line = parseLine(resolve(raw, task.vars, this.rng));
      steps.push({
        dt: i === 0 && firstDt !== undefined ? firstDt : per * this.rng.float(0.55, 1.45),
        state: i === 0 ? state : undefined,
        ...line,
      });
    });
  }

  private startSteps(agent: Agent, steps: Step[]): void {
    agent.steps = steps;
    agent.stepIndex = 0;
    agent.stepTotal = steps.length;
    this.runStep(agent);
  }

  private runStep(agent: Agent): void {
    const step = agent.steps[agent.stepIndex++];
    if (!step) return;
    if (step.state) this.setState(agent, step.state);
    if (step.text !== undefined) this.log(agent, step.tag ?? 'log', step.text, step.level ?? 'info');
    const held = step.action ? this.act(agent, step.action) : false;
    agent.rev++;
    if (held) return;
    const next = agent.steps[agent.stepIndex];
    if (next) this.scheduleAgent(agent, next.dt);
  }

  /** Performs a step action. Returns true when the action took over scheduling. */
  private act(agent: Agent, action: StepAction): boolean {
    const task = agent.task as Task;
    switch (action) {
      case 'spawn':
        this.spawnSubtasks(agent, task);
        return false;
      case 'wait':
        if (task.pendingSubtasks <= 0) return false;
        agent.waiting = true;
        this.log(agent, 'wait', `Waiting on ${task.pendingSubtasks} subtask(s)`, 'dim');
        this.scheduleAgent(agent, SUBTASK_TIMEOUT_MS);
        return true;
      case 'outcome':
        this.outcome(agent, task);
        return false;
      case 'finish': {
        const secs = ((this.now - task.startedAt) / 1000).toFixed(1);
        if (agent.state === 'failed') {
          this.log(agent, 'done', `Closed as failed after ${secs}s`, 'err');
          this.finishTask(task, 'failed');
          agent.failed++;
        } else {
          this.log(agent, 'done', `Completed in ${secs}s`, 'ok');
          this.finishTask(task, 'completed');
          agent.completed++;
        }
        return false;
      }
      case 'release':
        this.setState(agent, 'idle');
        agent.task = null;
        agent.steps = [];
        agent.stepIndex = 0;
        agent.stepTotal = 0;
        this.scheduleAgent(agent, this.rng.float(300, 1500));
        return true;
    }
  }

  private outcome(agent: Agent, task: Task): void {
    const tpl = this.tpl(task);
    const base = task.attempts === 1 ? 0.06 * task.complexity : 0.3;
    if (!this.rng.chance(Math.min(0.85, base * this.failBoost))) {
      const line = parseLine(resolve(tpl.pass, task.vars, this.rng));
      this.setState(agent, 'completed');
      this.log(agent, line.tag, line.text, line.level === 'info' ? 'ok' : line.level);
      this.wrapUp(agent);
      return;
    }

    const fail = parseLine(resolve(this.rng.pick(tpl.fail ?? GENERIC_FAIL), task.vars, this.rng));
    this.log(agent, fail.tag, fail.text, 'err');
    if (task.attempts >= MAX_ATTEMPTS) {
      this.setState(agent, 'failed');
      this.log(agent, 'error', `Giving up after ${MAX_ATTEMPTS} attempts — escalated for review`, 'err');
      this.systemEvent('warn', `${task.key} failed after ${MAX_ATTEMPTS} attempts on ${agent.id} — escalated`);
      this.wrapUp(agent);
      return;
    }

    task.attempts++;
    this.stats.retries++;
    this.setState(agent, 'retrying');
    this.log(agent, 'retry', `Attempt ${task.attempts}/${MAX_ATTEMPTS} — ${this.rng.pick(RETRY_REASONS)}`, 'warn');
    const fixes = [this.rng.pick(tpl.fix ?? GENERIC_FIX)];
    if (this.rng.chance(0.5)) {
      const extra = this.rng.pick(GENERIC_FIX);
      if (extra !== fixes[0]) fixes.push(extra);
    }
    const steps: Step[] = [];
    this.phase(steps, task, 'executing', fixes, agent.workMs * 0.2, this.rng.float(1500, 4000));
    this.phase(steps, task, 'validating', tpl.validate, agent.workMs * 0.2);
    steps.push({ dt: this.rng.float(800, 2000), action: 'outcome' });
    agent.steps = steps;
    agent.stepIndex = 0;
    agent.stepTotal = steps.length;
  }

  /** Queues the closing log line and the release back to idle. */
  private wrapUp(agent: Agent): void {
    agent.steps.push({ dt: this.rng.float(400, 900), action: 'finish' });
    agent.steps.push({ dt: this.rng.float(1500, 4000), action: 'release' });
    agent.stepTotal = agent.steps.length;
  }

  private spawnSubtasks(agent: Agent, task: Task): void {
    const tpl = this.tpl(task);
    if (!tpl.subtasks || !this.rng.chance(0.4)) return;
    let parents = 0;
    for (const t of this.running.values()) if (t.pendingSubtasks > 0) parents++;
    if (parents >= this.agents.length / 6) return;
    const k = Math.min(this.rng.int(2, 4), this.cfg.maxQueue - this.queue.length);
    if (k < 2) return;
    this.log(agent, 'dispatch', `Fan-out: ${k} subtasks to sub-agents`, 'info');
    for (let i = 0; i < k; i++) {
      const sub = this.createTask(this.templates.get(this.rng.pick(tpl.subtasks)), task);
      this.log(agent, 'dispatch', `${sub.key} ${sub.title} → queued`, 'dim');
    }
    task.pendingSubtasks = k;
    this.stats.subtasks += k;
  }

  /** Wakes a parent that was waiting for subtasks, either because they finished or on timeout. */
  private resume(agent: Agent): void {
    agent.waiting = false;
    const task = agent.task as Task;
    if (task.pendingSubtasks > 0) {
      this.log(agent, 'warn', `Proceeding without ${task.pendingSubtasks} pending subtask(s)`, 'warn');
      task.pendingSubtasks = 0;
    } else {
      this.log(agent, 'sub', 'All subtasks finished, resuming', 'ok');
    }
    this.runStep(agent);
  }

  private finishTask(task: Task, status: 'completed' | 'failed'): void {
    task.status = status;
    task.endedAt = this.now;
    this.running.delete(task.id);
    this.recent.push(task);
    this.recentRev++;
    this.finishTimes.push(this.now);
    this.stats[status]++;
    const total = this.stats.completed + this.stats.failed;
    if (total % 250 === 0) this.systemEvent('ok', `Milestone: ${total} tasks processed this session`);

    const parent = task.parentId !== null ? this.running.get(task.parentId) : undefined;
    if (parent && parent.pendingSubtasks > 0) {
      parent.pendingSubtasks--;
      const owner = this.byId.get(parent.agentId as string) as Agent;
      const by = task.agentId as string;
      if (status === 'completed') {
        this.log(owner, 'sub', `${task.key} done by ${by} (${parent.pendingSubtasks} left)`, 'info');
      } else {
        this.log(owner, 'sub', `${task.key} failed on ${by} — continuing with partial results`, 'warn');
      }
      owner.rev++;
      if (owner.waiting && parent.pendingSubtasks === 0) this.scheduleAgent(owner, this.rng.float(400, 1200));
    }
  }

  private trimFinishTimes(): void {
    const cutoff = this.now - 60_000;
    let drop = 0;
    while (drop < this.finishTimes.length && this.finishTimes[drop] <= cutoff) drop++;
    if (drop) this.finishTimes.splice(0, drop);
  }

  private tpl(task: Task): TaskTemplate {
    return this.templates.get(task.templateId) as TaskTemplate;
  }

  // ---- state & logging -------------------------------------------------------------------

  private setState(agent: Agent, state: AgentState): void {
    if (!TRANSITIONS[agent.state].includes(state)) this.transitionErrors++;
    agent.state = state;
    agent.stateSince = this.now;
  }

  private log(agent: Agent, tag: string, text: string, level: LogLevel): void {
    agent.log.push({ seq: ++this.logSeq, t: this.now, ts: this.clockBase + this.now, tag, text, level });
  }

  private systemEvent(level: LogLevel, text: string): void {
    this.events.push({ seq: ++this.eventSeq, t: this.now, ts: this.clockBase + this.now, level, text });
  }
}
