/** Seedable PRNG (mulberry32). Deterministic across browsers and Node. */
export interface Rng {
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Exponentially distributed value with the given mean. */
  exp(mean: number): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: seed >>> 0,
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted(items, weight) {
      let total = 0;
      for (const item of items) total += weight(item);
      let r = next() * total;
      for (const item of items) {
        r -= weight(item);
        if (r < 0) return item;
      }
      return items[items.length - 1];
    },
    exp: (mean) => -Math.log(1 - next()) * mean,
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}
