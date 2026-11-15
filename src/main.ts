import './style.css';
import { Artist } from './artist';
import { Bath, type Drop } from './bath';
import { mountIcons } from './icons';
import { initInstall } from './install';
import { CLEAR, inks, paint as role, PALETTES, rgb } from './palettes';
import { Tour } from './tour';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const store = {
  get(key: string) {
    try {
      return localStorage.getItem('suminagashi.' + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem('suminagashi.' + key, value);
    } catch {
      /* no storage */
    }
  },
};

mountIcons();

const canvas = $<HTMLCanvasElement>('#gl');
const startEl = $('#start');
const hintEl = $('#hint');
const paintsEl = $('#paints');
const sheet = $('#sheet');
const paletteSheet = $('#palettes');
const printView = $('#printView');
const printCanvas = $<HTMLCanvasElement>('#printCanvas');
const aimEl = document.querySelector<SVGSVGElement>('#aim')!;
const cursorEl = $('#cursor');
const fingerEl = $('#finger');
const coarse = matchMedia('(pointer: coarse)').matches;

function showError(msg: string) {
  $('#errorMsg').textContent = msg;
  $('#error').hidden = false;
  startEl.hidden = true;
}

let bath: Bath;
try {
  bath = new Bath(canvas);
} catch (e) {
  showError('Your browser could not set up the water. ' + (e as Error).message);
  throw e;
}

// ---------------------------------------------------------------- hint
let hintTimer = 0;
function hint(text: string, ms = 4000) {
  hintEl.innerHTML = '';
  const s = document.createElement('span');
  s.textContent = text;
  hintEl.append(s);
  hintEl.classList.add('show');
  clearTimeout(hintTimer);
  if (ms) hintTimer = window.setTimeout(() => hintEl.classList.remove('show'), ms);
}
function hideHint() {
  clearTimeout(hintTimer);
  hintEl.classList.remove('show');
}

// ---------------------------------------------------------------- tools
export type ToolId = 'drop' | 'needle' | 'whisker' | 'breath' | 'straw' | 'spray' | 'alcohol';
/** Each tool: what it does (the hint) and how big it is on the water, in
 *  heights of a landscape bath (for the cursor). */
const TOOLS: Record<ToolId, { hint: string; r: number; paint?: boolean }> = {
  drop: { hint: 'Tap for a drop. Hold for a bigger one.', r: 0.05, paint: true },
  needle: { hint: 'Drag through the ink.', r: 0.007 },
  whisker: { hint: 'Drag to comb fine lines.', r: 0.004 },
  breath: { hint: 'Touch and drag to blow.', r: 0.07 },
  straw: { hint: 'Touch and drag to aim a jet.', r: 0.012 },
  spray: { hint: 'Touch to spray fine drops.', r: 0.06, paint: true },
  alcohol: { hint: 'Tap to tear the film. Hold to push ink away.', r: 0.02, paint: true },
};
const toolsEl = $('#tools');
let tool: ToolId = (store.get('tool') as ToolId) in TOOLS ? (store.get('tool') as ToolId) : 'drop';
function setTool(t: ToolId, announce = true) {
  tool = t;
  store.set('tool', t);
  toolsEl.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.tool === t)));
  if (announce) hint(TOOLS[t].hint, 5000);
}
toolsEl.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]');
  if (b) setTool(b.dataset.tool as ToolId);
});

// ---------------------------------------------------------------- palettes and inks
let palette = Math.min(PALETTES.length - 1, Math.max(0, Number(store.get('palette') ?? 0) || 0));
/** The selected paint: an index into the palette's paints, or -1 for soap. */
let paint = 0;
const SOAP = -1;
/** Ink and soap in turn: every other drop is soap (with the Drop tool). On
 *  when an ink is picked while soap is selected; a tap on soap ends it. */
let alternate = false;
let nextSoap = false;
const inkNow = () => (paint === SOAP ? CLEAR : role(paint));

function swatch(color: string | null, i: number) {
  const b = document.createElement('button');
  b.className = 'swatch' + (color ? '' : ' soap');
  b.setAttribute('role', 'radio');
  b.dataset.i = String(i);
  b.setAttribute('aria-label', color ? `Ink ${i + 1}` : 'Soap');
  const dot = document.createElement('i');
  if (color) dot.style.background = color;
  else {
    dot.innerHTML = '<span class="icon" data-icon="water_drop"></span>';
    mountIcons(dot);
  }
  b.append(dot);
  return b;
}
function renderPaints() {
  const p = PALETTES[palette];
  paintsEl.replaceChildren(swatch(null, SOAP), ...p.paints.map((c, i) => swatch(c, i)));
  markPaint();
}
function markPaint() {
  paintsEl.querySelectorAll<HTMLElement>('.swatch').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.i! === paint)));
  const soap = paintsEl.querySelector<HTMLElement>('.soap');
  soap?.classList.toggle('alt', alternate);
  soap?.setAttribute('aria-label', alternate ? 'Soap, in turn with the ink: tap to stop' : 'Soap');
}
function selectPaint(i: number, quiet = false) {
  if (!TOOLS[tool].paint) setTool('drop', false);
  nextSoap = false;
  const say = quiet ? () => {} : hint;
  if (i === SOAP) {
    if (alternate) {
      alternate = false;
      say('Ink only', 1500);
    } else {
      paint = SOAP;
      say('Soap. Tap an ink for both in turn.', 3500);
    }
  } else {
    if (paint === SOAP) alternate = true;
    paint = i;
    say(alternate ? 'Ink and soap in turn. Tap soap to stop.' : 'Ink', alternate ? 3500 : 1500);
  }
  markPaint();
}
function resetPaint() {
  alternate = nextSoap = false;
  if (paint === SOAP) paint = 0;
  markPaint();
}
paintsEl.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.swatch');
  if (b) selectPaint(+b.dataset.i!);
});

function applyPalette(i: number) {
  palette = i;
  store.set('palette', String(i));
  const p = PALETTES[i];
  bath.ground = rgb(p.ground);
  // the ink on the water keeps its roles and takes the new colours
  bath.inks = inks(p);
  if (paint >= p.paints.length) paint = 0;
  renderPaints();
  artist?.setPalette(p);
}
function renderPaletteSheet() {
  const panel = paletteSheet.querySelector('.sheet-panel')!;
  panel.replaceChildren(
    ...PALETTES.map((p, i) => {
      const b = document.createElement('button');
      b.className = 'pal';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === palette));
      b.dataset.i = String(i);
      const name = document.createElement('span');
      name.textContent = p.name;
      const dots = document.createElement('span');
      dots.className = 'dots';
      dots.style.background = p.ground;
      dots.style.setProperty('--paper', p.ground);
      for (const c of p.paints) {
        const d = document.createElement('i');
        d.style.background = c;
        dots.append(d);
      }
      b.append(name, dots);
      return b;
    }),
  );
}
$('#paletteBtn').addEventListener('click', () => {
  renderPaletteSheet();
  paletteSheet.hidden = false;
  paletteSheet.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'center' });
});
paletteSheet.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.pal');
  if (b) applyPalette(+b.dataset.i!);
  paletteSheet.hidden = true;
});

// ---------------------------------------------------------------- the water
let drift = store.get('drift') !== 'off';
const driftBtn = $('[data-act="drift"]');
const syncDrift = () => driftBtn.setAttribute('aria-checked', String(drift));
syncDrift();
/** The water as it is when the user works on it: ink stays until it is
 *  skimmed off, a faint current moves it (Drift). */
function handsOn() {
  bath.fade = 1;
  bath.vorticity = 9;
  bath.drift = drift ? 0.006 : 0;
}

// ---------------------------------------------------------------- the demo
// Behind the start dialog an artist works at the bath, the tool bar hidden
// (`demo`). "Watch demo" is the guided tour instead: it uses the tool bar
// and says what it does (`tour`).
let artist: Artist | null = null;
let demo = false;
let tour: Tour | null = null;
function startDemo(fresh: boolean) {
  stopTour();
  if (fresh) bath.clear();
  artist = new Artist(bath, PALETTES[palette]);
  demo = true;
  document.body.classList.add('demo');
  // the artist's water: old ink thins out over a few minutes, so the bath
  // never fills up; swirls die down sooner
  bath.fade = 0.994;
  bath.vorticity = 4;
  bath.drift = 0;
}
function stopDemo() {
  stopTour();
  if (!demo) return;
  demo = false;
  artist = null;
  document.body.classList.remove('demo');
  handsOn();
}
function startTour() {
  stopDemo();
  for (const id of touches.keys()) lift(id);
  bath.clear();
  tour = new Tour({
    tool: t => setTool(t, false),
    paint: i => selectPaint(i, true),
    resetPaint,
    inks: () => PALETTES[palette].paints.length,
    press,
    drag,
    lift,
    hint: text => hint(text, 0),
    showPrint: on => $('#printBtn').classList.toggle('pulse', on),
    skim: () => bath.skim(),
  });
}
function stopTour() {
  if (!tour) return;
  tour.stop();
  tour = null;
  hideHint();
}
/** A touch of the user's while a demo runs: the demo ends. */
function takeOver() {
  if (!demo && !tour) return false;
  stopDemo();
  hint('Your turn', 1500);
  return true;
}

// ---------------------------------------------------------------- touches
type Touch = {
  x: number;
  y: number;
  px: number;
  py: number;
  /** where the touch began: the origin of a breath or a straw */
  ox: number;
  oy: number;
  t0: number;
  tool: ToolId;
  ink: number[];
  drop?: Drop;
  lastSpray: number;
};
const touches = new Map<number, Touch>();
let clock = 0;
const toBath = (e: PointerEvent): [number, number] => [e.clientX / innerWidth, 1 - e.clientY / innerHeight];

canvas.addEventListener('contextmenu', e => e.preventDefault());
/** A touch begins at (x, y) in the bath's uv: the user's, or the tour's
 *  (ids below zero, shown by a dot). With `soap`, it drops clear water. */
function press(id: number, x: number, y: number, soap = false) {
  let ink = soap ? CLEAR : inkNow();
  if (tool === 'drop' && alternate && !soap) {
    if (nextSoap) ink = CLEAR;
    nextSoap = !nextSoap;
  }
  const t: Touch = { x, y, px: x, py: y, ox: x, oy: y, t0: clock, tool, ink, lastSpray: clock };
  touches.set(id, t);
  if (tool === 'drop') t.drop = bath.drop(x, y, 0.007, ink, { held: true, tau: 0.3, jag: 0.12 });
  else if (tool === 'spray') spray(t);
  if (id < 0) showFinger(x, y);
  else hideHint();
}
function drag(id: number, x: number, y: number) {
  const t = touches.get(id);
  if (!t) return;
  t.x = x;
  t.y = y;
  if (id < 0) showFinger(x, y);
}
function lift(id: number) {
  const t = touches.get(id);
  if (id < 0) fingerEl.hidden = true;
  if (!t) return;
  touches.delete(id);
  lastTouch = clock;
  if (t.tool === 'alcohol') {
    // a tap: isopropyl, a patch torn open at once
    if (!t.drop) bath.isoprop(t.x, t.y, 0.035, t.ink, t.ink !== CLEAR);
    else bath.let(t.drop);
  } else if (t.drop) bath.let(t.drop);
}
function showFinger(x: number, y: number) {
  fingerEl.hidden = false;
  fingerEl.style.transform = `translate(${x * innerWidth}px, ${(1 - y) * innerHeight}px)`;
}

canvas.addEventListener('pointerdown', e => {
  // touching the water takes over from a demo
  if (takeOver()) return;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* (a pointer the browser does not know, as in a scripted test) */
  }
  // with the mouse, the right button touches with soap
  press(e.pointerId, ...toBath(e), e.button === 2);
});
canvas.addEventListener('pointermove', e => {
  drag(e.pointerId, ...toBath(e));
  if (e.pointerType === 'mouse') showCursor(e.clientX, e.clientY);
});
canvas.addEventListener('pointerleave', () => (cursorEl.hidden = true));
canvas.addEventListener('pointerup', e => lift(e.pointerId));
canvas.addEventListener('pointercancel', e => lift(e.pointerId));
// a tap on the bar or the buttons ends the tour too, and does what it does
$('#hud').addEventListener('pointerdown', () => tour && takeOver(), true);

function spray(t: Touch) {
  bath.spray(t.x, t.y, t.ink, 30 + Math.floor(Math.random() * 25), 1, Math.random() * Math.PI);
  t.lastSpray = clock;
}

function showCursor(cx: number, cy: number) {
  const r = Math.max(3, TOOLS[tool].r * bath.scale * innerHeight);
  cursorEl.hidden = demo || !!document.querySelector('.sheet:not([hidden])');
  cursorEl.style.width = cursorEl.style.height = `${2 * r}px`;
  cursorEl.style.transform = `translate(${cx - r}px, ${cy - r}px)`;
}

/** What the touches do to the water in this frame. */
function work(dt: number) {
  let aim: Touch | undefined;
  for (const t of touches.values()) {
    const dx = t.x - t.px,
      dy = t.y - t.py;
    switch (t.tool) {
      case 'drop':
        if (t.drop) bath.move(t.drop, t.x, t.y);
        break;
      case 'needle':
        if (dx || dy) bath.pin(t.px, t.py, t.x, t.y, dt);
        break;
      case 'whisker':
        bath.whisker(t.px, t.py, dx, dy);
        break;
      case 'breath':
      case 'straw': {
        aim ??= t;
        const len = Math.hypot((t.x - t.ox) * bath.aspect, t.y - t.oy);
        if (len > 0.01) bath.blow(t.ox, t.oy, t.x - t.ox, t.y - t.oy, Math.min(len / 0.25, 1.5), t.tool);
        break;
      }
      case 'spray':
        if (clock - t.lastSpray > 0.2) spray(t);
        break;
      case 'alcohol':
        // held: alcohol keeps welling up and pushes the ink away
        if (!t.drop && clock - t.t0 > 0.22) t.drop = bath.alcohol(t.x, t.y, 0.035, t.ink.map(v => v * 0.9));
        break;
    }
    t.px = t.x;
    t.py = t.y;
  }
  aimEl.toggleAttribute('hidden', !aim);
  if (aim) {
    const line = aimEl.querySelector('line')!,
      dot = aimEl.querySelector('circle')!;
    const sx = (x: number) => String(x * innerWidth),
      sy = (y: number) => String((1 - y) * innerHeight);
    line.setAttribute('x1', sx(aim.ox));
    line.setAttribute('y1', sy(aim.oy));
    line.setAttribute('x2', sx(aim.x));
    line.setAttribute('y2', sy(aim.y));
    dot.setAttribute('cx', sx(aim.ox));
    dot.setAttribute('cy', sy(aim.oy));
  }
}

// ---------------------------------------------------------------- print
let printed: ImageData | null = null;
function print() {
  stopDemo();
  for (const t of touches.values()) if (t.drop) bath.let(t.drop);
  touches.clear();
  // a sheet of washi, a little warmer than the tray
  const paper = rgb(PALETTES[palette].ground).map((v, i) => v * [0.995, 0.985, 0.955][i]);
  printed = bath.print(paper);
  printCanvas.width = printed.width;
  printCanvas.height = printed.height;
  printCanvas.getContext('2d')!.putImageData(printed, 0, 0);
  printView.hidden = false;
}
$('#printBtn').addEventListener('click', print);
$('#printBack').addEventListener('click', () => (printView.hidden = true));
printView.addEventListener('click', e => {
  if (e.target === printView) printView.hidden = true;
});
$('#printSave').addEventListener('click', async () => {
  const blob = await new Promise<Blob | null>(r => printCanvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `suminagashi-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      /* cancelled: fall back to a download */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------- menu
const installHelp = $('#installHelp');
const install = initInstall([$('#installBtn'), $('[data-act="install"]')], text => {
  installHelp.textContent = text;
  installHelp.hidden = false;
  showStart();
});
$('#installBtn').addEventListener('click', install);

$('#menuBtn').addEventListener('click', () => (sheet.hidden = false));
sheet.addEventListener('click', e => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  // the switch stays in view to show its new state
  if (act !== 'drift') sheet.hidden = true;
  if (act === 'new') newBath();
  else if (act === 'demo') startTour(); else if (act === 'drift') {
    drift = !drift;
    store.set('drift', drift ? 'on' : 'off');
    syncDrift();
    if (!demo) handsOn();
  } else if (act === 'help') showStart();
  else if (act === 'install') install();
});
function newBath() {
  stopDemo();
  touches.clear();
  bath.skim();
  // a tool that leaves no ink is of no use on clear water
  if (!TOOLS[tool].paint) {
    setTool('drop', false);
    alternate = nextSoap = false;
    paint = 0;
    markPaint();
  }
  hint('A fresh bath', 1500);
}

addEventListener('keydown', e => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    sheet.hidden = paletteSheet.hidden = printView.hidden = true;
    return;
  }
  if (!startEl.hidden || !printView.hidden) return;
  if (tour) takeOver();
  const n = +e.key;
  const ids = Object.keys(TOOLS) as ToolId[];
  if (n >= 1 && n <= ids.length) setTool(ids[n - 1]);
  else if (e.key === 'c') selectPaint((paint + 1) % PALETTES[palette].paints.length);
  else if (e.key === 'x') selectPaint(SOAP);
  else if (e.key === 'p') print();
  else if (e.key === 'n') newBath();
});

// ---------------------------------------------------------------- start
let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake() {
  try {
    wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<typeof wakeLock> } }).wakeLock?.request('screen') ?? null;
  } catch {
    /* not allowed or not supported */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock) keepAwake();
});

function showStart() {
  // (the tour's hints would talk over the dialog)
  stopTour();
  startEl.hidden = false;
  startEl.classList.remove('gone');
}
function begin(withDemo: boolean) {
  startEl.classList.add('gone');
  setTimeout(() => (startEl.hidden = true), 400);
  keepAwake();
  if (withDemo) startTour();
  else {
    if (demo) {
      stopDemo();
      bath.skim();
    }
    setTool(tool);
  }
}
$('#startBtn').addEventListener('click', () => begin(false));
$('#demoBtn').addEventListener('click', () => begin(true));

// ---------------------------------------------------------------- loop
const qs = new URLSearchParams(location.search);
// The display's full rate only while a finger works on the water and a
// moment after: the rest of the time (and in the demo) the water moves
// slowly, and 30 frames a second look the same for half the GPU load.
// `?fps=` sets one rate for all.
const FIXED_FPS = +(qs.get('fps') ?? 0);
const CALM_FPS = 30;
let lastTouch = -Infinity;
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const busy = touches.size > 0 || clock - lastTouch < 1.5;
  const fps = FIXED_FPS || (busy && !demo ? 120 : CALM_FPS);
  // (with slack: a 60 Hz display's frames come every 16.7 ms, give or take,
  // and one a hair early must not wait for the next)
  if (now - last < 1000 / fps - 6) return;
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  clock += dt;
  bath.resize();
  if (demo && artist) {
    artist.frame(dt);
    // the artist's water runs a little slower: a calm tempo
    bath.step(dt * 0.75);
  } else {
    tour?.frame(dt);
    work(dt);
    bath.step(dt);
  }
  bath.render();
}

applyPalette(palette);
setTool(tool, false);
handsOn();
// behind the start dialog, the artist is already at work
startDemo(true);
requestAnimationFrame(frame);

if (import.meta.env.DEV) Object.assign(window, { dev: { bath, artist: () => artist, palettes: PALETTES, palette: applyPalette, startDemo, stopDemo, startTour, tour: () => tour } });
