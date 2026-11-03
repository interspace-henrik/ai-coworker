/** Prefix marking a glyph that should be drawn mirrored (Matrix code runs mirrored, as in the film). */
export const MIRROR = '\u0001';

/**
 * Pre-rendered glyphs on one offscreen canvas, keyed by colour and character. Drawing a cell
 * is then a single drawImage instead of fillText, which is much cheaper on a Raspberry Pi.
 * The atlas is bounded: when it fills up it is cleared and refilled on demand.
 */
export class GlyphAtlas {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private slots = new Map<string, number>();
  private next = 0;
  private readonly perRow = 64;

  constructor(private font: string, readonly cw: number, readonly ch: number, private capacity = 2048) {
    this.canvas.width = this.perRow * cw;
    this.canvas.height = Math.ceil(capacity / this.perRow) * ch;
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
    const x = (i % this.perRow) * this.cw;
    const y = Math.floor(i / this.perRow) * this.ch;
    const c = this.ctx;
    c.fillStyle = color;
    if (glyph.charAt(0) === MIRROR) {
      c.save();
      c.translate(x + this.cw, y);
      c.scale(-1, 1);
      c.fillText(glyph.slice(1), 0, this.ch / 2);
      c.restore();
    } else {
      c.fillText(glyph, x, y + this.ch / 2);
    }
    return i;
  }

  blit(target: CanvasRenderingContext2D, glyph: string, color: string, x: number, y: number): void {
    const i = this.slot(glyph, color);
    target.drawImage(
      this.canvas,
      (i % this.perRow) * this.cw,
      Math.floor(i / this.perRow) * this.ch,
      this.cw,
      this.ch,
      x,
      y,
      this.cw,
      this.ch,
    );
  }
}
