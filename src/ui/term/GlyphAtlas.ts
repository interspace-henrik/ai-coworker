/** Prefix marking a glyph that should be drawn mirrored (Matrix code runs mirrored, as in the film). */
export const MIRROR = '\u0001';

/** Spare pixels around each slot so glow from one glyph never bleeds into its neighbour. */
const PAD = 4;

/** Line directions [up, right, down, left]: 1 = single, 2 = double. */
const SINGLE: Record<string, [number, number, number, number]> = {
  '─': [0, 1, 0, 1],
  '│': [1, 0, 1, 0],
  '┌': [0, 1, 1, 0],
  '┐': [0, 0, 1, 1],
  '└': [1, 1, 0, 0],
  '┘': [1, 0, 0, 1],
  '├': [1, 1, 1, 0],
  '┤': [1, 0, 1, 1],
  '┬': [0, 1, 1, 1],
  '┴': [1, 1, 0, 1],
  '┼': [1, 1, 1, 1],
};
const DOUBLE = '═║╔╗╚╝╠╣╦╩╬';
const BLOCKS = '█▀▄▌▐░▒▓';

/**
 * Pre-rendered glyphs on one offscreen canvas, keyed by colour and character. Drawing a cell
 * is then a single drawImage instead of fillText, which is much cheaper on a Raspberry Pi.
 *
 * CP437 box-drawing and block characters are drawn as shapes that fill the cell exactly, the
 * way terminal emulators do it, so frames and block letters join seamlessly regardless of the
 * font installed. The atlas is bounded: when it fills up it is cleared and refilled on demand.
 */
export class GlyphAtlas {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private slots = new Map<string, number>();
  private next = 0;
  private readonly perRow = 48;
  private readonly sw: number;
  private readonly sh: number;

  constructor(
    private font: string,
    readonly cw: number,
    readonly ch: number,
    private glow = 0,
    private capacity = 2048,
  ) {
    this.sw = cw + PAD * 2;
    this.sh = ch + PAD * 2;
    this.canvas.width = this.perRow * this.sw;
    this.canvas.height = Math.ceil(capacity / this.perRow) * this.sh;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.reset();
  }

  private reset(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.slots.clear();
    this.next = 0;
    this.ctx.font = this.font;
    this.ctx.textBaseline = 'middle';
  }

  private slot(glyph: string, color: string): number {
    const key = color + '|' + glyph;
    let i = this.slots.get(key);
    if (i !== undefined) return i;
    if (this.next >= this.capacity) this.reset();
    i = this.next++;
    this.slots.set(key, i);
    const x = (i % this.perRow) * this.sw + PAD;
    const y = Math.floor(i / this.perRow) * this.sh + PAD;
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(x, y, this.cw, this.ch);
    c.clip();
    c.fillStyle = color;
    if (this.glow) {
      c.shadowColor = color;
      c.shadowBlur = this.glow;
    }
    if (!this.drawShape(glyph, x, y)) {
      if (glyph.charAt(0) === MIRROR) {
        c.translate(x + this.cw, y);
        c.scale(-1, 1);
        c.fillText(glyph.slice(1), 0, this.ch / 2);
      } else {
        c.fillText(glyph, x, y + this.ch / 2);
      }
    }
    c.restore();
    return i;
  }

  /** Draws box-drawing and block characters as exact shapes. Returns false for anything else. */
  private drawShape(g: string, x: number, y: number): boolean {
    const c = this.ctx;
    const w = this.cw;
    const h = this.ch;
    const t = Math.max(1, Math.round(w / 9));
    const cx = x + Math.floor(w / 2) - Math.floor(t / 2);
    const cy = y + Math.floor(h / 2) - Math.floor(t / 2);
    const hl = (x0: number, x1: number, yy: number): void => c.fillRect(x0, yy, x1 - x0 + t, t);
    const vl = (xx: number, y0: number, y1: number): void => c.fillRect(xx, y0, t, y1 - y0 + t);
    const L = x;
    const R = x + w - t;
    const T = y;
    const B = y + h - t;

    const single = SINGLE[g];
    if (single) {
      const [u, r, d, l] = single;
      if (u) vl(cx, T, cy);
      if (d) vl(cx, cy, B);
      if (l) hl(L, cx, cy);
      if (r) hl(cx, R, cy);
      return true;
    }

    if (DOUBLE.indexOf(g) >= 0) {
      const gap = Math.max(t + 1, Math.round(w / 5));
      const xa = cx - gap;
      const xb = cx + gap;
      const ya = cy - gap;
      const yb = cy + gap;
      switch (g) {
        case '═': hl(L, R, ya); hl(L, R, yb); break;
        case '║': vl(xa, T, B); vl(xb, T, B); break;
        case '╔': hl(xa, R, ya); hl(xb, R, yb); vl(xa, ya, B); vl(xb, yb, B); break;
        case '╗': hl(L, xb, ya); hl(L, xa, yb); vl(xb, ya, B); vl(xa, yb, B); break;
        case '╚': vl(xa, T, yb); vl(xb, T, ya); hl(xa, R, yb); hl(xb, R, ya); break;
        case '╝': vl(xb, T, yb); vl(xa, T, ya); hl(L, xb, yb); hl(L, xa, ya); break;
        case '╠': vl(xa, T, B); vl(xb, T, ya); vl(xb, yb, B); hl(xb, R, ya); hl(xb, R, yb); break;
        case '╣': vl(xb, T, B); vl(xa, T, ya); vl(xa, yb, B); hl(L, xa, ya); hl(L, xa, yb); break;
        case '╦': hl(L, R, ya); hl(L, xa, yb); hl(xb, R, yb); vl(xa, yb, B); vl(xb, yb, B); break;
        case '╩': hl(L, R, yb); hl(L, xa, ya); hl(xb, R, ya); vl(xa, T, ya); vl(xb, T, ya); break;
        case '╬':
          hl(L, xa, ya); hl(xb, R, ya); hl(L, xa, yb); hl(xb, R, yb);
          vl(xa, T, ya); vl(xa, yb, B); vl(xb, T, ya); vl(xb, yb, B);
          break;
      }
      return true;
    }

    if (BLOCKS.indexOf(g) >= 0) {
      const hw = Math.round(w / 2);
      const hh = Math.round(h / 2);
      switch (g) {
        case '█': c.fillRect(x, y, w, h); break;
        case '▀': c.fillRect(x, y, w, hh); break;
        case '▄': c.fillRect(x, y + hh, w, h - hh); break;
        case '▌': c.fillRect(x, y, hw, h); break;
        case '▐': c.fillRect(x + hw, y, w - hw, h); break;
        default: {
          // Shades as a dot raster, like the CP437 originals: 25%, 50%, 75%.
          const p = Math.max(1, Math.round(w / 6));
          for (let j = 0, row = 0; j < h; j += p, row++) {
            for (let i = 0, col = 0; i < w; i += p, col++) {
              const quarter = (col + 2 * (row % 2)) % 4 === 0;
              const half = (col + row) % 2 === 0;
              const on = g === '░' ? quarter : g === '▒' ? half : !quarter;
              if (on) c.fillRect(x + i, y + j, p, p);
            }
          }
        }
      }
      return true;
    }
    return false;
  }

  blit(target: CanvasRenderingContext2D, glyph: string, color: string, x: number, y: number): void {
    const i = this.slot(glyph, color);
    target.drawImage(
      this.canvas,
      (i % this.perRow) * this.sw + PAD,
      Math.floor(i / this.perRow) * this.sh + PAD,
      this.cw,
      this.ch,
      x,
      y,
      this.cw,
      this.ch,
    );
  }
}
