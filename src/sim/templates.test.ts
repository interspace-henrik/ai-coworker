import { describe, expect, it } from 'vitest';
import { createRng } from './prng';
import { resolve } from './template';
import { TEMPLATES } from './templates';
import { ROLES } from './types';

describe('task templates', () => {
  it('has at least 60 unique templates covering every role', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.title)).size).toBe(TEMPLATES.length);
    for (const role of ROLES) expect(TEMPLATES.some((t) => t.role === role)).toBe(true);
  });

  it('only references existing subtask templates', () => {
    const ids = new Set(TEMPLATES.map((t) => t.id));
    for (const t of TEMPLATES) for (const s of t.subtasks ?? []) expect(ids.has(s), `${t.id} → ${s}`).toBe(true);
  });

  it('resolves every placeholder', () => {
    const rng = createRng(1);
    for (const t of TEMPLATES) {
      const vars: Record<string, string> = {};
      const lines = [t.title, ...t.analyze, ...t.plan, ...t.execute, ...t.validate, t.pass, ...(t.fail ?? []), ...(t.fix ?? [])];
      for (const line of lines) {
        const out = resolve(line, vars, rng);
        expect(out, `${t.id}: ${line}`).not.toMatch(/\{[a-z0-9#]+(:[0-9.]+-[0-9.]+)?\}/i);
      }
    }
  });
});
