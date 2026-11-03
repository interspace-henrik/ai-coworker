import { GlyphAtlas } from './GlyphAtlas';
import { SHADES, type MatrixGrid } from './MatrixGrid';

export const MONO_FONT = "ui-monospace, 'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, monospace";

/** How the Matrix code is composited over the cell buffer for one frame. */
export interface MatrixLayer {
  grid: MatrixGrid;
  /** 0..1: cells whose threshold is below this belong to the code. */
  level: number;
  /** Every cell belongs to the code (pure rain, no terminal underneath). */
  ownAll: boolean;
  /** Scramble frame shown when a cycle restarts. */
  glitch: boolean;
}

/**
 * A fixed character grid drawn on a canvas, like a real terminal. Views write characters and
 * colours into the buffer each frame; flush() draws only the cells that changed since the
 * previous frame, so a mostly static screen costs almost nothing.
 */
export class TermCanvas {
  readonly el = document.createElement('canvas');
  cols = 0;
  rows = 0;
  cw = 0;
  ch = 0;
  private ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas | null = null;
  private chars: string[] = [];
  private fg: string[] = [];
  private bg: string[] = [];
  private drawnChars: string[] = [];
  private drawnFg: string[] = [];
  private drawnBg: string[] = [];

  constructor(private background: string, private foreground: string) {
    this.ctx = this.el.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  }

  /** Sizes the grid to fill width × height CSS pixels at the given font size. */
  resize(width: number, height: number, fontPx: number): void {
    const font = fontPx + 'px ' + MONO_FONT;
    this.ctx.font = font;
    this.cw = Math.max(1, Math.ceil(this.ctx.measureText('M').width));
    this.ch = Math.max(1, Math.round(fontPx * 1.3));
    this.cols = Math.max(1, Math.floor(width / this.cw));
    this.rows = Math.max(1, Math.floor(height / this.ch));
    this.el.width = this.cols * this.cw;
    this.el.height = this.rows * this.ch;
    this.atlas = new GlyphAtlas(font, this.cw, this.ch);
    const n = this.cols * this.rows;
    this.chars = new Array(n).fill(' ');
    this.fg = new Array(n).fill(this.foreground);
    this.bg = new Array(n).fill('');
    this.drawnChars = new Array(n).fill('\0');
    this.drawnFg = new Array(n).fill('');
    this.drawnBg = new Array(n).fill('');
    this.ctx.fillStyle = this.background;
    this.ctx.fillRect(0, 0, this.el.width, this.el.height);
  }

  clear(): void {
    this.chars.fill(' ');
    this.fg.fill(this.foreground);
    this.bg.fill('');
  }

  /** Writes text at (x, y), clipped to `maxX` (exclusive) and the grid. Returns the next x. */
  write(x: number, y: number, text: string, fg = this.foreground, bg = '', maxX = this.cols): number {
    if (y < 0 || y >= this.rows) return x;
    const end = Math.min(maxX, this.cols);
    for (let k = 0; k < text.length && x < end; k++, x++) {
      if (x < 0) continue;
      const i = y * this.cols + x;
      this.chars[i] = text.charAt(k);
      this.fg[i] = fg;
      this.bg[i] = bg;
    }
    return x;
  }

  /** Paints a background over a span of cells without changing their text. */
  fillBg(x0: number, x1: number, y: number, bg: string): void {
    if (y < 0 || y >= this.rows) return;
    for (let x = Math.max(0, x0); x < Math.min(x1, this.cols); x++) this.bg[y * this.cols + x] = bg;
  }

  flush(matrix?: MatrixLayer): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const { cols, rows, cw, ch, ctx } = this;
    // Passing drops tint terminal text: only the heads at first, longer trails as the level rises.
    const tintFrom = matrix ? Math.max(2, Math.min(8, 8 - Math.ceil(matrix.level * 12))) : 8;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let c = this.chars[i];
        let f = this.fg[i];
        let b = this.bg[i];
        if (matrix) {
          const g = matrix.grid;
          const lit = g.bright(x, y);
          if (matrix.glitch && Math.random() < 0.35) {
            c = g.randomGlyph();
            f = SHADES[5 + ((Math.random() * 3) | 0)];
            b = '';
          } else if (matrix.ownAll || g.threshold[i] < matrix.level) {
            c = lit ? g.glyph(x, y) : ' ';
            f = SHADES[lit];
            b = '';
          } else if (lit >= tintFrom && c !== ' ') {
            f = SHADES[Math.min(7, lit + 1)];
          }
        }
        if (c === this.drawnChars[i] && f === this.drawnFg[i] && b === this.drawnBg[i]) continue;
        this.drawnChars[i] = c;
        this.drawnFg[i] = f;
        this.drawnBg[i] = b;
        ctx.fillStyle = b || this.background;
        ctx.fillRect(x * cw, y * ch, cw, ch);
        if (c !== ' ') atlas.blit(ctx, c, f, x * cw, y * ch);
      }
    }
  }
}
