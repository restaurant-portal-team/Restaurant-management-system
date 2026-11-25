/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read from disk (relative to the frontend root, where Vitest runs): CSS processing is disabled in tests.
const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

/**
 * WCAG 2.x contrast checks for the theme tokens in index.css (light and dark), computed from the
 * OKLCH values with the standard OKLab -> linear sRGB transform. No dependencies.
 */

type Rgb = [number, number, number]; // gamma-encoded sRGB, 0..1

function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return linear.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composites fg over bg (as browsers do for e.g. bg-brand-900/40). */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => v * alpha + (bg[i] ?? 0) * (1 - alpha)) as Rgb;
}

function tokens(block: string): Record<string, Rgb> {
  const result: Record<string, Rgb> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)) {
    const [, name, l, c, h] = match;
    if (name && l && c && h) result[name] = oklchToSrgb(Number(l) / 100, Number(c), Number(h));
  }
  return result;
}

const theme = tokens(css.slice(css.indexOf('@theme'), css.indexOf('@layer base')));
const light = { ...theme, ...tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))) };
const dark = { ...theme, ...tokens(css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('html {'))) };
const WHITE: Rgb = [1, 1, 1];

function get(set: Record<string, Rgb>, name: string): Rgb {
  const value = set[name];
  if (!value) throw new Error(`token --${name} not found in index.css`);
  return value;
}

describe('theme contrast (WCAG AA, 4.5:1 for normal text)', () => {
  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('%s theme: body and muted text on every surface', (_name, t) => {
    for (const surface of ['surface', 'surface-raised', 'surface-sunken']) {
      expect(contrast(get(t, 'ink'), get(t, surface)), `ink on ${surface}`).toBeGreaterThanOrEqual(7);
      expect(contrast(get(t, 'ink-muted'), get(t, surface)), `ink-muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary button: white text on brand-600', () => {
    expect(contrast(WHITE, get(light, 'color-brand-600'))).toBeGreaterThanOrEqual(4.5);
  });

  it('eyebrow and link accents: brand-700 (light) and brand-300 (dark)', () => {
    expect(contrast(get(light, 'color-brand-700'), get(light, 'surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(get(dark, 'color-brand-300'), get(dark, 'surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('active navigation item in both themes', () => {
    expect(contrast(get(light, 'color-brand-800'), get(light, 'color-brand-50'))).toBeGreaterThanOrEqual(4.5);
    const darkActiveBg = over(get(dark, 'color-brand-900'), 0.4, get(dark, 'surface-raised'));
    expect(contrast(get(dark, 'color-brand-100'), darkActiveBg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('%s theme: danger text on raised surfaces and tinted error backgrounds', (_name, t) => {
    const raised = get(t, 'surface-raised');
    const danger = get(t, 'danger');
    expect(contrast(danger, raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(danger, over(danger, 0.08, raised))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('%s theme: status badge text (success, warning) on its 12 percent tint', (_name, t) => {
    const raised = get(t, 'surface-raised');
    for (const status of ['success', 'warning']) {
      const color = get(t, status);
      expect(contrast(color, over(color, 0.12, raised)), status).toBeGreaterThanOrEqual(4.5);
    }
  });
});
