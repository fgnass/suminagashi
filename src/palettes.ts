import { sampleCanvases } from './vendor/colors/canvas.ts';
import { fromHex, maxChroma, toGamut, toHex, type Lch } from './vendor/colors/color.ts';
import { createRng } from './vendor/colors/random.ts';

/** A palette: the tray under the water and the paints, display colours. */
export type Palette = { name: string; ground: string; paints: string[] };

const parse = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
/** A colour as an ink: what it takes out of the light (Beer–Lambert), so a
 *  film of it on the tray shows that colour, and films over each other
 *  darken. The darkest colours are capped, or they print black. */
export const ink = (hex: string, strength = 1) => parse(hex).map(v => -Math.log(Math.max(0.07, v)) * strength);
export const rgb = (hex: string) => parse(hex) as [number, number, number];
/** Clear water with a drop of soap: it pushes the ink aside and adds none. */
export const CLEAR = [0, 0, 0];

/** The traditional inks: sumi, diluted and strong, and a few
 *  colours, on a pale tray. */
const SUMI: Palette = {
  name: 'Sumi',
  ground: '#f7f5f3',
  paints: ['#33302e', '#80756b', '#5c73c2', '#94cfdb', '#e66661', '#fae073'],
};

/** The palette of a favourite marbling: high contrast,
 *  a near-black among clear, light colours. Each is lightness, chroma and
 *  hue in OKLCH. */
const MARBLE: Lch[] = [
  { l: 0.864, c: 0.172, h: 95 }, // yellow
  { l: 0.207, c: 0.008, h: 67 }, // near-black
  { l: 0.708, c: 0.131, h: 227 }, // cyan
  { l: 0.82, c: 0.07, h: 25 }, // pink
  { l: 0.877, c: 0.069, h: 173 }, // mint
  { l: 0.767, c: 0.158, h: 72 }, // ochre
];

/** The marbling's palette, its hues turned together by `turn` degrees: the
 *  same contrasts in other colours. A light colour keeps its share of the
 *  chroma its new hue can have, so a yellow turned blue stays as loud as
 *  a light blue can be. The paper and the black are the colors project's
 *  canvases for these colours, tinted in the palette's family. */
function marble(turn: number): Palette {
  const at = (c: Lch): Lch => {
    const h = (c.h + turn + 360) % 360;
    if (c.c < 0.02) return { ...c, h };
    const share = c.c / maxChroma(c.l, c.h);
    return toGamut({ l: c.l, h, c: maxChroma(c.l, h) * share });
  };
  const paints = MARBLE.map(at);
  const [main, black, companion, anchor] = paints;
  const { paper, ink: dark } = sampleCanvases(createRng(turn * 4099 + 17), { main, companion, anchor, light: anchor, dark: black });
  paints[1] = dark;
  return { name: `${hueName(paints[0].h)} & ${hueName(paints[2].h)}`, ground: toHex(paper), paints: paints.map(toHex) };
}

/** A rough name for an OKLCH hue. */
function hueName(h: number) {
  const names: [number, string][] = [
    [15, 'Pink'], [40, 'Red'], [80, 'Orange'], [110, 'Yellow'], [135, 'Lime'], [160, 'Green'],
    [195, 'Teal'], [235, 'Cyan'], [275, 'Blue'], [305, 'Violet'], [335, 'Purple'], [360, 'Pink'],
  ];
  return names.find(([max]) => h < max)![1];
}

/** Hand-picked palettes in the manner of bold gradient cards: a loud
 *  paint, an accent, a deep rich one and a clear light one, never brown. */
const CARDS: Record<string, [loud: string, accent: string, deep: string, light: string]> = {
  'Magenta & indigo': ['#f72585', '#7209b7', '#2b0a6e', '#fde2f3'],
  'Cerise & wine': ['#d10064', '#ff7a1a', '#4a0d2b', '#ffd6c2'],
  'Red & plum': ['#ee1d52', '#ff8fab', '#3f2462', '#e6ecff'],
  'Mint & teal': ['#14c08a', '#ffd23f', '#0b3b3f', '#effaf3'],
  'Lime & emerald': ['#9be22d', '#f5e900', '#06473a', '#f4ffe0'],
  'Coral & raspberry': ['#ff5e5b', '#ffb800', '#6b0f3a', '#ffe8d6'],
  'Tangerine & crimson': ['#ff6b00', '#ff2e63', '#7a0c2e', '#fff1e0'],
  'Jade & cyan': ['#00b386', '#00c2d1', '#00473c', '#e3fff4'],
  'Blue & lilac': ['#4d5cff', '#ff4fa3', '#1b1680', '#f0e6ff'],
  'Pink & purple': ['#ff2fa0', '#b04cff', '#3d0a5c', '#ffe6f6'],
  'Cyan & ultramarine': ['#00b4e6', '#7b5cff', '#0a1f6b', '#e3f8ff'],
};
function card(name: string, [loud, accent, deep, light]: string[]): Palette {
  // a near-white paper with a faint tint of the light paint, never cream
  const tint = fromHex(light);
  const paper = toGamut({ l: 0.975, c: Math.min(tint.c, 0.012), h: tint.h });
  return { name, ground: toHex(paper), paints: [loud, accent, deep, light] };
}

export const PALETTES: Palette[] = [
  ...[0, 150, 210, 270, 300, 330, 30, 60, 90, 120, 180, 240].map(marble),
  SUMI,
  ...Object.entries(CARDS).map(([name, c]) => card(name, c)),
];
