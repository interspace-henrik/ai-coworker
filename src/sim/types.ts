import type { RingBuffer } from './ringbuffer';

export const ROLES = [
  'Code',
  'QA',
  'Security',
  'Data',
  'Infrastructure',
  'Research',
  'Documentation',
  'Deployment',
] as const;
export type Role = (typeof ROLES)[number];

export type AgentState =
  | 'idle'
  | 'assigned'
  | 'analyzing'
  | 'planning'
  | 'executing'
  | 'validating'
  | 'retrying'
  | 'completed'
  | 'failed';

export const ACTIVE_STATES: ReadonlySet<AgentState> = new Set<AgentState>([
  'assigned',
  'analyzing',
  'planning',
  'executing',
  'validating',
  'retrying',
]);

/** Legal agent state transitions. Used by the engine's own assertions and by tests. */
export const TRANSITIONS: Readonly<Record<AgentState, readonly AgentState[]>> = {
  idle: ['assigned'],
  assigned: ['analyzing'],
  analyzing: ['planning'],
  planning: ['executing'],
  executing: ['validating'],
  validating: ['completed', 'retrying', 'failed'],
  retrying: ['executing', 'failed'],
  completed: ['idle'],
  failed: ['idle'],
};

export type LogLevel = 'info' | 'ok' | 'warn' | 'err' | 'dim';

export interface LogLine {
  seq: number;
  /** Simulated time (ms since engine start). */
  t: number;
  /** Display timestamp (epoch ms), derived from the engine clock base when the line was written. */
  ts: number;
  tag: string;
  text: string;
  level: LogLevel;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface Task {
  id: number;
  key: string;
  title: string;
  templateId: string;
  role: Role;
  /** 0.5 (trivial) .. 2 (heavy). Scales duration. */
  complexity: number;
  priority: number;
  status: TaskStatus;
  createdAt: number;
  startedAt: number;
  endedAt: number;
  agentId: string | null;
  attempts: number;
  /** Resolved placeholder values shared by title and log lines. */
  vars: Record<string, string>;
  parentId: number | null;
  /** Outstanding subtasks the task is waiting on. */
  pendingSubtasks: number;
}

export type StepAction = 'outcome' | 'finish' | 'release' | 'spawn' | 'wait';

export interface Step {
  /** Delay (ms) after the previous step. */
  dt: number;
  state?: AgentState;
  tag?: string;
  text?: string;
  level?: LogLevel;
  action?: StepAction;
}

export interface Agent {
  id: string;
  num: number;
  role: Role;
  state: AgentState;
  stateSince: number;
  task: Task | null;
  steps: Step[];
  stepIndex: number;
  /** Total steps planned for the current attempt, for the progress indicator. */
  stepTotal: number;
  log: RingBuffer<LogLine>;
  /** Personal pace factor; some agents are a little quicker than others. */
  tempo: number;
  /** Planned working time (ms) of the current task, used to size retry attempts. */
  workMs: number;
  /** True while the agent is parked waiting for its subtasks. */
  waiting: boolean;
  completed: number;
  failed: number;
  /** Incremented to invalidate a pending scheduled step (e.g. on early wake-up). */
  token: number;
  assignedAt: number;
  /** Bumped on every visible change so the UI can skip untouched rows. */
  rev: number;
}

export interface SystemEvent {
  seq: number;
  t: number;
  ts: number;
  level: LogLevel;
  text: string;
}

export interface HistoryPoint {
  t: number;
  active: number;
  queue: number;
  throughput: number;
}
