export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

type Cached = HTMLElement & { _t?: string; _c?: string; _s?: string };

/** Writes text only when it changed, so steady-state frames touch no DOM. */
export function setText(node: HTMLElement, text: string): void {
  const n = node as Cached;
  if (n._t === text) return;
  n._t = text;
  n.textContent = text;
}

export function setClass(node: HTMLElement, cls: string): void {
  const n = node as Cached;
  if (n._c === cls) return;
  n._c = cls;
  n.className = cls;
}

/** Sets a horizontal scale (0..1) via transform, which the compositor handles cheaply. */
export function setScaleX(node: HTMLElement, value: number): void {
  const n = node as Cached;
  const v = 'scaleX(' + (Math.round(value * 100) / 100).toFixed(2) + ')';
  if (n._s === v) return;
  n._s = v;
  n.style.transform = v;
}

const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 75s -> "01:15", 3725s -> "1:02:05". */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? h + ':' + pad2(m) + ':' + pad2(sec) : pad2(m) + ':' + pad2(sec);
}

/** Uptime as "3d 04:12:09" or "04:12:09". */
export function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const rest = s % 86400;
  const hms = pad2(Math.floor(rest / 3600)) + ':' + pad2(Math.floor((rest % 3600) / 60)) + ':' + pad2(rest % 60);
  return d ? d + 'd ' + hms : hms;
}

export function fmtSecs(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? s.toFixed(1) + 's' : Math.floor(s / 60) + 'm ' + pad2(Math.round(s % 60)) + 's';
}

export const STATE_LABEL: Record<string, string> = {
  idle: 'IDLE',
  assigned: 'ASSIGNED',
  analyzing: 'ANALYZING',
  planning: 'PLANNING',
  executing: 'EXECUTING',
  validating: 'VALIDATING',
  retrying: 'RETRYING',
  completed: 'COMPLETED',
  failed: 'FAILED',
};
