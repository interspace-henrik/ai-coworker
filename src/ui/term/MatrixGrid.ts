import { MIRROR } from './GlyphAtlas';

/** Glyphs safe on a stock Linux player (no CJK font needed); drawn mirrored. */
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:.=*+-<>|¦'.split('').map((c) => MIRROR + c);

/** Brightness shades 1..7 (index 0 unused); 7 is the bright head of a drop. */
export const SHADES = ['', '#0a3314', '#0f4a1c', '#146325', '#1c8a33', '#2bbf4a', '#5cff82', '#d4ffde'];

/**
 * The Matrix code as in the film: a fixed grid of glyphs that occasionally change in place,
 * lit by drops of light that fall down the columns. Cells never move, only their brightness
 * and glyph change. Visual only, so it uses Math.random rather than the seeded PRNG.
 */
export class MatrixGrid {
  private head: Float32Array;
  private speed: Float32Array;
  private len: Uint8Array;
  private glyphs: string[];
  /** Per-cell takeover threshold; a cell belongs to the code once the level passes it. */
  readonly threshold: Float32Array;

  constructor(readonly cols: number, readonly rows: number) {
    this.head = new Float32Array(cols);
    this.speed = new Float32Array(cols);
    this.len = new Uint8Array(cols);
    this.glyphs = new Array(cols * rows);
    this.threshold = new Float32Array(cols * rows);
    for (let x = 0; x < cols; x++) {
      this.head[x] = -Math.random() * rows * 2;
      this.respeed(x);
      // Mostly column-wise so text dissolves in streaks, with some per-cell noise.
      const colBias = Math.random();
      for (let y = 0; y < rows; y++) {
        const i = y * cols + x;
        this.glyphs[i] = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        this.threshold[i] = Math.min(0.999, colBias * 0.65 + Math.random() * 0.35);
      }
    }
  }

  private respeed(x: number): void {
    this.speed[x] = 7 + Math.random() * 15;
    this.len[x] = 10 + ((Math.random() * 22) | 0);
  }

  /**
   * Advances the drops. `density` 0..1 is the share of columns that start new drops;
   * drops already falling always finish.
   */
  step(dtSec: number, density: number): void {
    const { cols, rows } = this;
    for (let x = 0; x < cols; x++) {
      const h = this.head[x];
      if (h - this.len[x] > rows) {
        // Off the bottom: wait a random gap, and only restart if this column is in play.
        this.head[x] = Math.random() < density ? -Math.random() * rows * 0.4 : -rows * (1 + Math.random() * 3);
        this.respeed(x);
      } else {
        this.head[x] = h + this.speed[x] * dtSec;
      }
    }
    // A few glyphs change in place each step.
    const n = Math.ceil(cols * rows * 0.004);
    for (let k = 0; k < n; k++) {
      this.glyphs[(Math.random() * this.glyphs.length) | 0] = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
  }

  /** Brightness 0..7 of a cell from the drop in its column (0 = unlit). */
  bright(x: number, y: number): number {
    const d = this.head[x] - y;
    if (d < 0) return 0;
    if (d < 1) return 7;
    const len = this.len[x];
    if (d > len) return 0;
    return Math.max(1, Math.round(6 * (1 - d / len)));
  }

  glyph(x: number, y: number): string {
    return this.glyphs[y * this.cols + x];
  }

  randomGlyph(): string {
    return GLYPHS[(Math.random() * GLYPHS.length) | 0];
  }
}
