/**
 * Monochrome green phosphor. Hierarchy comes only from brightness and inverse video,
 * as on a single-colour CRT terminal.
 */
export const P = {
  bg: '#020a04',
  faint: '#0f5222',
  dim: '#1f9a44',
  fg: '#3cff70',
  bright: '#d2ffda',
};

export const HOST = 'CTL-01';

/** Pads (or right-aligns) to a fixed width for monospace tables. Longer text is cut. */
export function pad(text: string, width: number, right = false, fill = ' '): string {
  if (text.length >= width) return text.slice(0, width);
  const space = fill.repeat(width - text.length);
  return right ? space + text : text + space;
}

/** Small stable string hash for synthetic values. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** DEFCON 5 when all is well, 4 when the queue is backing up, 3 during an incident. */
export function defcon(e: { incident: string | null; queue: unknown[]; cfg: { maxQueue: number } }): number {
  if (e.incident) return 3;
  if (e.queue.length >= e.cfg.maxQueue * 0.75) return 4;
  return 5;
}
