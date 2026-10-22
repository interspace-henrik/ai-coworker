import { MinHeap } from './heap';
import { createRng, type Rng } from './prng';
import { RingBuffer } from './ringbuffer';
import { parseLine, resolve, type TaskTemplate } from './template';
import { TEMPLATES } from './templates';
import {
  ACTIVE_STATES,
  ROLES,
  TRANSITIONS,
  type Agent,
  type AgentState,
  type LogLevel,
  type Role,
  type Step,
  type StepAction,
  type SystemEvent,
  type Task,
} from './types';

export interface EngineConfig {
  seed: number;
  agents: number;
  /** Hard cap on waiting tasks. */
  maxQueue: number;
  /** Log lines kept per agent. */
  logBuffer: number;
  /** Finished tasks kept for the "recent" list. */
  recentLimit: number;
  /** Long-run share of agent capacity the arrival process aims to fill. */
  utilization: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  seed: 1,
  agents: 30,
  maxQueue: 40,
  logBuffer: 30,
  recentLimit: 30,
  utilization: 0.88,
};

type SimEvent =
  | { t: number; seq: number; kind: 'agent'; agent: Agent; token: number }
  | { t: number; seq: number; kind: 'arrival' };
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
  readonly stats = { created: 0, completed: 0, failed: 0, retries: 0, subtasks: 0 };
  /** Count of illegal state transitions; must stay 0. */
  transitionErrors = 0;
  queueRev = 0;
  recentRev = 0;

  private readonly heap = new MinHeap<SimEvent>();
  private readonly templates = new Map<string, TaskTemplate>();
  private readonly finishTimes: number[] = [];
  private seq = 0;
  private taskSeq = 0;
  private logSeq = 0;
  private eventSeq = 0;
  private readonly meanTaskMs: number;

  constructor(cfg: Partial<EngineConfig> = {}, clockBase = 0) {
    this.clockBase = clockBase;
    this.cfg = { ...DEFAULT_ENGINE_CONFIG, ...cfg };
    this.cfg.agents = Math.max(8, Math.min(120, Math.round(this.cfg.agents)));
    this.rng = createRng(this.cfg.seed);
    this.recent = new RingBuffer<Task>(this.cfg.recentLimit);
    for (const tpl of TEMPLATES) this.templates.set(tpl.id, tpl);

    let totalWeight = 0;
    let weightedSecs = 0;
    for (const tpl of TEMPLATES) {
      const w = tpl.weight ?? 1;
      totalWeight += w;
      weightedSecs += w * ((tpl.base[0] + tpl.base[1]) / 2);
    }
    // Average work plus assignment, wrap-up and cooldown overhead.
    this.meanTaskMs = (weightedSecs / totalWeight) * 1050 + 5500;

    this.createAgents();
    this.systemEvent('info', `Orchestrator online — ${this.agents.length} agents registered`);
    const initial = Math.min(this.cfg.maxQueue, Math.round(this.agents.length * 0.8));
    for (let i = 0; i < initial; i++) this.createTask();
    for (const agent of this.agents) this.scheduleAgent(agent, this.rng.float(200, 2500));
    this.scheduleArrival();
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
      this.agents.push({
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
        completed: 0,
        failed: 0,
        token: 0,
        assignedAt: 0,
        rev: 0,
      });
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
    const mean = this.meanTaskMs / (this.agents.length * this.cfg.utilization);
    this.push({ t: this.now + Math.max(50, this.rng.exp(mean)), kind: 'arrival' });
  }

  private handle(ev: SimEvent): void {
    switch (ev.kind) {
      case 'agent':
        if (ev.token !== ev.agent.token) return;
        if (ev.agent.state === 'idle') this.poll(ev.agent);
        else this.runStep(ev.agent);
        return;
      case 'arrival':
        if (this.queue.length < this.cfg.maxQueue) this.createTask();
        if (this.queue.length < 2) this.createTask();
        this.scheduleArrival();
        return;
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
    const tpl = this.templates.get(task.templateId) as TaskTemplate;
    task.status = 'running';
    task.startedAt = this.now;
    task.agentId = agent.id;
    task.attempts = 1;
    this.running.set(task.id, task);
    agent.task = task;
    agent.assignedAt = this.now;

    const mismatch = task.role === agent.role ? 1 : 1.25;
    const duration = this.rng.float(tpl.base[0], tpl.base[1]) * 1000 * task.complexity * mismatch * agent.tempo;
    const steps: Step[] = [
      { dt: 0, state: 'assigned', tag: agent.id, text: `Assigned: ${task.title} (${task.key})` },
    ];
    this.phase(steps, task, 'analyzing', tpl.analyze, duration * 0.22, this.rng.float(600, 1600));
    this.phase(steps, task, 'planning', tpl.plan, duration * 0.12);
    this.phase(steps, task, 'executing', tpl.execute, duration * 0.42);
    this.phase(steps, task, 'validating', tpl.validate, duration * 0.24);
    steps.push({ dt: this.rng.float(800, 2400), action: 'outcome' });
    this.startSteps(agent, steps);
  }

  /** Appends one state's log lines, spread over roughly `duration` ms. */
  private phase(steps: Step[], task: Task, state: AgentState, lines: readonly string[], duration: number, firstDt?: number): void {
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
    if (step.action) this.act(agent, step.action);
    agent.rev++;
    const next = agent.steps[agent.stepIndex];
    if (next) this.scheduleAgent(agent, next.dt);
  }

  private act(agent: Agent, action: StepAction): void {
    const task = agent.task as Task;
    const tpl = this.templates.get(task.templateId) as TaskTemplate;
    switch (action) {
      case 'outcome': {
        const line = parseLine(resolve(tpl.pass, task.vars, this.rng));
        this.setState(agent, 'completed');
        this.log(agent, line.tag, line.text, line.level);
        agent.steps.push({ dt: this.rng.float(400, 900), action: 'finish' });
        agent.steps.push({ dt: this.rng.float(1500, 4000), action: 'release' });
        agent.stepTotal = agent.steps.length;
        return;
      }
      case 'finish': {
        const secs = ((this.now - task.startedAt) / 1000).toFixed(1);
        this.log(agent, 'done', `Completed in ${secs}s`, 'ok');
        this.finishTask(task, 'completed');
        agent.completed++;
        return;
      }
      case 'release':
        this.setState(agent, 'idle');
        agent.task = null;
        agent.steps = [];
        agent.stepIndex = 0;
        agent.stepTotal = 0;
        this.scheduleAgent(agent, this.rng.float(300, 1500));
        return;
      default:
        return;
    }
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
  }

  private trimFinishTimes(): void {
    const cutoff = this.now - 60_000;
    let drop = 0;
    while (drop < this.finishTimes.length && this.finishTimes[drop] <= cutoff) drop++;
    if (drop) this.finishTimes.splice(0, drop);
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
