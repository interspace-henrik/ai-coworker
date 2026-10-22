import type { Rng } from './prng';
import type { LogLevel, Role } from './types';
import { VOCAB } from './vocab';

/**
 * A task template. Lines are written as "[tag] text" and may contain placeholders:
 *   {table}         a value from VOCAB.table, bound per task (later {table} gives the same value)
 *   {table#2}       a second, independently bound value from VOCAB.table
 *   {n:20-80}       an integer in [20, 80] bound to "n" (later {n} reuses it)
 *   {ms:1.5-9.0}    a float, formatted with as many decimals as the lower bound has
 * Integers >= 1000 are formatted with thousands separators.
 */
export interface TaskTemplate {
  id: string;
  role: Role;
  title: string;
  /** Typical duration range in seconds at complexity 1. */
  base: [number, number];
  weight?: number;
  analyze: string[];
  plan: string[];
  execute: string[];
  validate: string[];
  /** Line written when validation passes. */
  pass: string;
  /** Candidate lines written when validation fails (one is picked). */
  fail?: string[];
  /** Candidate fix lines written while retrying. */
  fix?: string[];
  /** Template ids this task may fan out into as subtasks. */
  subtasks?: string[];
}

const PLACEHOLDER = /\{([a-z0-9#]+)(?::([0-9.]+)-([0-9.]+))?\}/gi;

export function resolve(line: string, vars: Record<string, string>, rng: Rng): string {
  return line.replace(PLACEHOLDER, (whole, key: string, lo?: string, hi?: string) => {
    if (lo !== undefined && hi !== undefined) {
      if (!(key in vars)) vars[key] = randomNumber(lo, hi, rng);
      return vars[key];
    }
    if (key in vars) return vars[key];
    const list = VOCAB[key.split('#')[0]];
    if (!list) return whole;
    vars[key] = rng.pick(list);
    return vars[key];
  });
}

function randomNumber(lo: string, hi: string, rng: Rng): string {
  const dot = lo.indexOf('.');
  if (dot >= 0) {
    const decimals = lo.length - dot - 1;
    return rng.float(parseFloat(lo), parseFloat(hi)).toFixed(decimals);
  }
  return formatInt(rng.int(parseInt(lo, 10), parseInt(hi, 10)));
}

export function formatInt(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const grouped = s.length > 3 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
  return n < 0 ? '-' + grouped : grouped;
}

export interface ParsedLine {
  tag: string;
  text: string;
  level: LogLevel;
}

export function parseLine(line: string): ParsedLine {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
  const tag = m ? m[1] : 'log';
  const text = m ? m[2] : line;
  return { tag, text, level: levelFor(tag, text) };
}

function levelFor(tag: string, text: string): LogLevel {
  if (tag === 'error' || /\bFAIL(ED)?\b/.test(text)) return 'err';
  if (tag === 'warn' || tag === 'retry') return 'warn';
  if (tag === 'done' || /\bPASS\b|\bOK\b|✓/.test(text)) return 'ok';
  return 'info';
}
