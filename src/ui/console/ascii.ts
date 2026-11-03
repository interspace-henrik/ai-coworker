import type { TermCanvas } from '../term/TermCanvas';

/**
 * 5×7 bitmap font for BBS-style block lettering. Each glyph is seven rows of five bits;
 * rendered two pixel rows per text row with half blocks, so a letter is 4 rows tall.
 */
const FONT: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  ',': '00000 00000 00000 00000 01100 00100 01000',
  '%': '11000 11001 00010 00100 01000 10011 00011',
  '/': '00001 00001 00010 00100 01000 10000 10000',
};

const BITMAPS: Record<string, number[][]> = {};
for (const k in FONT) BITMAPS[k] = FONT[k].split(' ').map((row) => row.split('').map(Number));

export const BIG_ROWS = 4;
const BIG_ADVANCE = 6;

export function bigWidth(text: string): number {
  return text.length ? text.length * BIG_ADVANCE - 1 : 0;
}

/** Draws block lettering 4 rows tall. Returns the width used. */
export function bigText(t: TermCanvas, x: number, y: number, text: string, color: string, maxX = t.cols): number {
  const up = text.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const bmp = BITMAPS[up.charAt(i)] || BITMAPS[' '];
    const gx = x + i * BIG_ADVANCE;
    for (let r = 0; r < BIG_ROWS; r++) {
      for (let col = 0; col < 5; col++) {
        const top = bmp[r * 2][col];
        const bottom = r * 2 + 1 < 7 ? bmp[r * 2 + 1][col] : 0;
        const ch = top && bottom ? '█' : top ? '▀' : bottom ? '▄' : '';
        if (ch && gx + col < maxX) t.write(gx + col, y + r, ch, color);
      }
    }
  }
  return bigWidth(up);
}

export type Frame = 'single' | 'double';

const FRAMES: Record<Frame, string> = { single: '┌┐└┘─│', double: '╔╗╚╝═║' };

/** Draws a frame with corners at (x0, y0) and (x1, y1), inclusive, and an optional title. */
export function box(
  t: TermCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  frame: Frame = 'double',
  title?: string,
  titleColor = color,
): void {
  const [tl, tr, bl, br, hz, vt] = FRAMES[frame];
  const inner = Math.max(0, x1 - x0 - 1);
  t.write(x0, y0, tl + hz.repeat(inner) + tr, color);
  t.write(x0, y1, bl + hz.repeat(inner) + br, color);
  for (let y = y0 + 1; y < y1; y++) {
    t.write(x0, y, vt, color);
    t.write(x1, y, vt, color);
  }
  if (title && inner > 4) t.write(x0 + 2, y0, ' ' + title.toUpperCase().slice(0, inner - 4) + ' ', titleColor);
}

/** A bar like ██████░░░░ for a value 0..1. */
export function meter(value: number, width: number): string {
  const n = Math.max(0, Math.min(width, Math.round(value * width)));
  return '█'.repeat(n) + '░'.repeat(width - n);
}

/**
 * Draws a two-tone meter. `chars` is the filled and empty glyph: '█░' for a lone gauge,
 * '■·' for meters stacked in rows, where full blocks would merge into one solid shape.
 */
export function drawMeter(
  t: TermCanvas,
  x: number,
  y: number,
  value: number,
  width: number,
  on: string,
  off: string,
  maxX = t.cols,
  chars = '█░',
): number {
  const n = Math.max(0, Math.min(width, Math.round(value * width)));
  x = t.write(x, y, chars.charAt(0).repeat(n), on, '', maxX);
  return t.write(x, y, chars.charAt(1).repeat(width - n), off, '', maxX);
}
