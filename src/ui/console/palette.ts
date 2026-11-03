/** xterm-like colours for the console view. */
export const C = {
  bg: '#0c0c0c',
  fg: '#c5c8c6',
  dim: '#707880',
  white: '#f2f2f2',
  green: '#5fd75f',
  bgreen: '#87ff5f',
  blue: '#5f87ff',
  cyan: '#5fd7d7',
  yellow: '#d7d75f',
  red: '#ff5f5f',
  magenta: '#d787d7',
  border: '#444444',
  barBg: '#2f9e44',
  barFg: '#000000',
};

export const HOST = 'ctl-01';

/** Pads (or right-aligns) to a fixed width for monospace tables. Longer text is left as is. */
export function pad(text: string, width: number, right = false, fill = ' '): string {
  if (text.length >= width) return text;
  const space = fill.repeat(width - text.length);
  return right ? space + text : text + space;
}

/** Small stable string hash for synthetic ids (pod suffixes, restart counts). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
