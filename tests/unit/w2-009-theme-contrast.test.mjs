// Unit tests — W2-009 Sunrise theme contrast (docs/design/ui/refresh/theme-tokens.md §12).
// WCAG 2.x contrast ratios computed from relative luminance; every token pair the UI relies on
// must stay AA (4.5 : 1 text, 3 : 1 non-text). Reads the real tokens from src/theme/palette.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brand, hero, palette, tile, tone } from '../../src/theme/palette.ts';

const WHITE = '#FFFFFF';
const CANVAS = '#F7F4FF';
const TEXT = '#1F1B3B';
const TEXT2 = '#5B5675';

/** Parse #RRGGBB or rgba(r,g,b,a) into [r, g, b, a] (0–255, alpha 0–1). */
function parse(c) {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`Unparseable colour ${c}`);
  const p = m[1].split(',').map((x) => Number(x.trim()));
  return [p[0], p[1], p[2], p[3] ?? 1];
}

/** Composite a (possibly translucent) colour over an opaque background. */
function over(fg, bg) {
  const [r, g, b, a] = parse(fg);
  const [R, G, B] = parse(bg);
  const mix = (x, y) => Math.round(x * a + y * (1 - a));
  return `#${[mix(r, R), mix(g, G), mix(b, B)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(c) {
  const [r, g, b] = parse(c).map((v, i) => (i < 3 ? v / 255 : v));
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function atLeast(fg, bg, min, what) {
  const r = contrast(fg, bg);
  assert.ok(r >= min, `${what}: ${fg} on ${bg} = ${r.toFixed(2)} (needs ≥ ${min})`);
}

test('contrast helper matches known WCAG values', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(contrast('#FFFFFF', '#FFFFFF').toFixed(1), '1.0');
  assert.equal(contrast('#6D28D9', WHITE).toFixed(1), '7.1');
});

test('§12.1 tones: fg/bg, fg/white and solidFg/solid are all ≥ 4.5', () => {
  assert.deepEqual(Object.keys(tone).sort(), ['error', 'grey', 'info', 'pink', 'success', 'violet', 'warning']);
  for (const [name, t] of Object.entries(tone)) {
    atLeast(t.fg, t.bg, 4.5, `tone.${name} fg/bg`);
    atLeast(t.fg, WHITE, 4.5, `tone.${name} fg/white`);
    atLeast(t.solidFg, t.solid, 4.5, `tone.${name} solid`);
    atLeast(t.border, WHITE, 3, `tone.${name} outlined border`);
  }
});

test('§12.2 pastel tiles: ink, body text and secondary text ≥ 4.5; accent ≥ 3', () => {
  assert.deepEqual(Object.keys(tile).sort(), ['lavender', 'mint', 'peach', 'rose', 'sky']);
  for (const [name, t] of Object.entries(tile)) {
    atLeast(t.ink, t.bg, 4.5, `tile.${name} ink`);
    atLeast(TEXT, t.bg, 4.5, `tile.${name} text.primary`);
    atLeast(TEXT2, t.bg, 4.5, `tile.${name} text.secondary`);
    atLeast(t.accent, t.bg, 3, `tile.${name} accent`);
    // Quick-action icon sits in a 70 % white square on the tile.
    atLeast(t.ink, over('rgba(255,255,255,0.7)', t.bg), 4.5, `tile.${name} ink on icon plate`);
  }
});

test('§12.3 buttons: main vs contrastText ≥ 4.5 (primary ≥ 7); secondary button states ≥ 4.5', () => {
  for (const k of ['primary', 'secondary', 'success', 'warning', 'error', 'info']) {
    const c = palette[k];
    atLeast(c.contrastText, c.main, 4.5, `${k}.main`);
    atLeast(c.contrastText, c.dark, 4.5, `${k}.dark (hover)`);
  }
  atLeast(palette.primary.contrastText, palette.primary.main, 7, 'primary.main (AAA target)');
  atLeast('#5B21B6', '#EDE9FE', 4.5, 'secondary (lavender) button');
  atLeast('#5B21B6', '#DDD6FE', 4.5, 'secondary button hover');
  atLeast(palette.link, WHITE, 4.5, 'link on white');
  atLeast(palette.link, CANVAS, 4.5, 'link on canvas');
});

test('§12.4 hero (portal Home, soft lavender band): ink, subtext and links on both stops and under the decor', () => {
  for (const stop of hero.stops) {
    for (const [fg, what] of [[hero.ink, 'ink'], [hero.subtext, 'subtext'], [palette.link, 'All › link'], [palette.primary.dark, 'role chip text']]) {
      atLeast(fg, stop, 4.5, `hero ${what} on ${stop}`);
      atLeast(fg, over(hero.decor, stop), 4.5, `hero ${what} on ${stop} + decor`);
    }
  }
  assert.ok(hero.gradient.includes(hero.stops[0]) && hero.gradient.includes(hero.stops[1]), 'stops match the gradient');
  // Balance tiles on the band are white faces: tile ink label and body text on white.
  for (const [name, t] of Object.entries(tile)) {
    atLeast(t.ink, WHITE, 4.5, `tile.${name} ink on white balance tile`);
    atLeast(t.accent, WHITE, 3, `tile.${name} accent bar on white`);
  }
});

test('§12.4b sign-in brand panel (softened gradient): white and subtext on both stops and under the decor', () => {
  for (const stop of brand.stops) {
    for (const fg of [brand.ink, brand.subtext]) {
      atLeast(fg, stop, 4.5, `brand ${fg} on ${stop}`);
      atLeast(fg, over(brand.decor, stop), 4.5, `brand ${fg} on ${stop} + decor`);
    }
  }
  assert.ok(brand.gradient.includes(brand.stops[0]) && brand.gradient.includes(brand.stops[1]), 'stops match the gradient');
});

test('§12.5 non-text: control border and focus ring on white and canvas ≥ 3', () => {
  for (const bg of [WHITE, CANVAS]) {
    atLeast(palette.controlBorder, bg, 3, 'controlBorder');
    atLeast(palette.primary.main, bg, 3, 'focus ring');
  }
});

test('§12.6 shell: active nav (soft tint) and bottom-bar label', () => {
  atLeast('#5B21B6', tone.violet.bg, 4.5, 'active nav label on violet tint');
  atLeast('#5B21B6', palette.grey[300], 4.5, 'active nav label on hover');
  atLeast(WHITE, palette.primary.main, 4.5, 'white icon on the active (violet) nav tile');
  atLeast(palette.primary.main, tone.violet.bg, 3, 'active nav tile against the tint');
  atLeast('#5B21B6', WHITE, 4.5, 'active bottom-bar label');
  atLeast(TEXT2, WHITE, 4.5, 'inactive bottom-bar label');
  atLeast(WHITE, '#6D28D9', 4.5, 'selected bottom-bar icon pill');
});

test('text tokens on white and canvas', () => {
  for (const bg of [WHITE, CANVAS]) {
    atLeast(palette.text.primary, bg, 4.5, 'text.primary');
    atLeast(palette.text.secondary, bg, 4.5, 'text.secondary');
    atLeast(palette.error.main, bg, 4.5, 'error text');
    atLeast(palette.warning.main, bg, 4.5, 'warning text');
    atLeast(palette.success.main, bg, 4.5, 'success text');
  }
  // Negative balance on a pastel tile uses error.dark.
  for (const [name, t] of Object.entries(tile)) atLeast(palette.error.dark, t.bg, 4.5, `error.dark on tile.${name}`);
  // Toasts: white on neutral and success backgrounds.
  atLeast(WHITE, palette.grey[900], 4.5, 'neutral toast');
  atLeast(WHITE, palette.success.dark, 4.5, 'success toast');
});

test('leave-type legend colours are ≥ 3 : 1 on white (dots and bars only)', () => {
  for (const c of palette.leaveType) atLeast(c, WHITE, 3, `leaveType ${c}`);
});
