// Material Symbols (rounded, weight 400), inlined as SVG so they work offline.
import menu from '@material-symbols/svg-400/rounded/menu.svg?raw';
import waterDrop from '@material-symbols/svg-400/rounded/water_drop.svg?raw';
import waterDropFill from '@material-symbols/svg-400/rounded/water_drop-fill.svg?raw';
import keep from '@material-symbols/svg-400/rounded/keep.svg?raw';
import keepFill from '@material-symbols/svg-400/rounded/keep-fill.svg?raw';
import lineCurve from '@material-symbols/svg-400/rounded/line_curve.svg?raw';
import air from '@material-symbols/svg-400/rounded/air.svg?raw';
import airFill from '@material-symbols/svg-400/rounded/air-fill.svg?raw';
import airwave from '@material-symbols/svg-400/rounded/airwave.svg?raw';
import grain from '@material-symbols/svg-400/rounded/grain.svg?raw';
import grainFill from '@material-symbols/svg-400/rounded/grain-fill.svg?raw';
import science from '@material-symbols/svg-400/rounded/science.svg?raw';
import scienceFill from '@material-symbols/svg-400/rounded/science-fill.svg?raw';
import palette from '@material-symbols/svg-400/rounded/palette.svg?raw';
import layers from '@material-symbols/svg-400/rounded/layers.svg?raw';
import colorize from '@material-symbols/svg-400/rounded/colorize.svg?raw';
import colorizeFill from '@material-symbols/svg-400/rounded/colorize-fill.svg?raw';
import iosShare from '@material-symbols/svg-400/rounded/ios_share.svg?raw';
import water from '@material-symbols/svg-400/rounded/water.svg?raw';
import playCircle from '@material-symbols/svg-400/rounded/play_circle.svg?raw';
import cyclone from '@material-symbols/svg-400/rounded/cyclone.svg?raw';
import info from '@material-symbols/svg-400/rounded/info.svg?raw';
import download from '@material-symbols/svg-400/rounded/download.svg?raw';
import shieldPerson from '@material-symbols/svg-400/rounded/shield_person.svg?raw';

import apps from '@material-symbols/svg-400/rounded/apps.svg?raw';
import code from '@material-symbols/svg-400/rounded/code.svg?raw';

const ICONS: Record<string, [string, string?]> = {
  menu: [menu],
  water_drop: [waterDrop, waterDropFill],
  keep: [keep, keepFill],
  line_curve: [lineCurve],
  air: [air, airFill],
  airwave: [airwave],
  grain: [grain, grainFill],
  science: [science, scienceFill],
  palette: [palette],
  layers: [layers],
  colorize: [colorize, colorizeFill],
  ios_share: [iosShare],
  water: [water],
  play_circle: [playCircle],
  cyclone: [cyclone],
  info: [info],
  download: [download],
  shield_person: [shieldPerson],
  code: [code],
  apps: [apps],
};

const clean = (svg: string, cls: string) => svg.replace(/ width="\d+" height="\d+"/, '').replace('<svg ', `<svg class="${cls}" aria-hidden="true" `);

/** Fills every `<span class="icon" data-icon="…">`. With `data-fill`, the filled variant shows when active. */
export function mountIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.icon[data-icon]').forEach(el => {
    const [o, f] = ICONS[el.dataset.icon!] ?? [];
    if (!o) throw new Error('unknown icon ' + el.dataset.icon);
    el.innerHTML = clean(o, 'o') + (f && el.hasAttribute('data-fill') ? clean(f, 'f') : '');
  });
}
