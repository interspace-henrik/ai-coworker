import { matrixLevel, type MatrixSpec } from '../config';
import { MatrixGrid } from './term/MatrixGrid';
import { TermCanvas } from './term/TermCanvas';

/** Colour tokens and the green each one ends at. */
const PALETTE: [string, string, string][] = [
  ['--text', '#c9d2dc', '#a6f5b8'],
  ['--muted', '#7d8897', '#4fae63'],
  ['--dim', '#4a5461', '#2a6136'],
  ['--blue', '#4c9dff', '#3be26a'],
  ['--cyan', '#4fb6c2', '#3be26a'],
  ['--violet', '#9a88e6', '#5ad67c'],
  ['--teal', '#5fc2a2', '#4af07a'],
  ['--green', '#3fb871', '#7dff9c'],
  ['--amber', '#d8a33c', '#b5f06a'],
  ['--red', '#e5574f', '#c8e05a'],
  ['--line', '#222a34', '#11351c'],
  ['--line-soft', '#1a2029', '#0c2614'],
  ['--term-text', '#aeb8c4', '#6fe08a'],
  ['--term-tag', '#6f8db3', '#3fb85a'],
];

const GLITCH_MS = 900;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',') + ')';
}

/**
 * ?matrix for the dashboard: Matrix code rains on a canvas behind the panels while the
 * palette drifts to green and the panels fade, until at 100% only the code is left.
 * Costs nothing while the level is 0.
 */
export class MatrixEffect {
  private term = new TermCanvas('#000', '#000');
  private grid: MatrixGrid | null = null;
  private applied = -1;
  private cycle = 0;
  private glitchUntil = 0;
  private lastStep = 0;

  constructor(private spec: MatrixSpec, private reducedMotion: boolean) {
    this.term.el.className = 'mx-rain';
    this.term.el.style.display = 'none';
    document.body.prepend(this.term.el);
    this.layout();
  }

  layout(): void {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.term.resize(window.innerWidth, window.innerHeight, Math.round(rootPx * 1.15));
    this.grid = new MatrixGrid(this.term.cols, this.term.rows);
  }

  update(uptimeMs: number): void {
    const { level, cycle } = matrixLevel(this.spec, uptimeMs);
    const root = document.documentElement;
    if (cycle !== this.cycle) {
      this.cycle = cycle;
      this.glitchUntil = uptimeMs + GLITCH_MS;
      root.classList.add('mx-glitch');
    }
    const glitch = uptimeMs < this.glitchUntil;
    if (!glitch) root.classList.remove('mx-glitch');
    if (Math.abs(level - this.applied) >= 0.002 || (level === 0 && this.applied !== 0)) this.apply(level);

    const show = level > 0.001 || glitch;
    root.classList.toggle('mx-on', show);
    // Fully covered: skip painting the invisible dashboard altogether.
    root.classList.toggle('mx-full', level >= 0.999 && !glitch);
    this.term.el.style.display = show ? '' : 'none';
    if (!show || this.reducedMotion || !this.grid) {
      this.lastStep = 0;
      return;
    }
    const dt = this.lastStep ? Math.min(0.25, (uptimeMs - this.lastStep) / 1000) : 0.1;
    this.lastStep = uptimeMs;
    this.grid.step(dt, 0.05 + 0.95 * level);
    this.term.flush({ grid: this.grid, level: 1, ownAll: true, glitch });
  }

  private apply(level: number): void {
    this.applied = level;
    const style = document.documentElement.style;
    style.setProperty('--mx', level.toFixed(3));
    // Colours go green well before the panels are gone.
    const t = Math.min(1, level * 1.6);
    for (const [name, from, to] of PALETTE) {
      if (t === 0) style.removeProperty(name);
      else style.setProperty(name, mix(from, to, t));
    }
  }
}
