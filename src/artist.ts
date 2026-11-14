import { Bath, type Drop } from './bath';
import { CLEAR, ink, type Palette } from './palettes';

// THE DEMO: AN ARTIST AT THE BATH.
//
// She keeps her own time: a slow beat in four, phrases of
// four bars, a chord every two bars, a tune and a bass line that come and
// go. The picture is never finished: it keeps being made, pulled about,
// torn open and made again.
//
//   the hand   — where she touches the water. The beat is her two
//                brushes, two colours in turn: the kick one, the snare
//                the other. On the first beat of a phrase she touches
//                with soap instead, a clear island. Every chord touches
//                there too, a third colour and soap in turn.
//   two more hands — either side of the first: one for the tune, one for
//                the bass, a ring for every note, colour and soap in turn.
//   harmony    — at every chord her hand moves to where the bath is
//                emptiest, so new ring systems press into the old ones.
//   the breath — a slow, wide current that swells and ebbs and draws the
//                rings out all the time.
//   her tools  — every phrase she draws a needle through the bath: a
//                straight pass, a wave, a spiral round her hand, or a comb.
//   the fan    — now and then a stroke of the fan across the bath.
//   alcohol    — every sixteen bars a large drop of alcohol at her hand
//                tears everything open, and she begins again.
//   isopropyl  — in some phrases, bursts beside her hand like syllables.

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const hash = (n: number) => {
  let h = Math.imul(n ^ 0x5bd1e995, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** A needle's path through the bath over one gesture, t from 0 to 1, in
 *  short sides round her hand; `null` where the needle is lifted. */
type Path = (t: number) => [number, number] | null;
type Tool = { path: Path; from: number; beats: number; last: [number, number] | null; strength: number };
/** One of her hands: where it stands from the first (angle and distance
 *  in short sides; none for the first itself), its touches so far, the last. */
type Pen = { a: number; r: number; n: number; at: number; area: number; last?: Drop };
const pen = (a: number, r: number): Pen => ({ a, r, n: 0, at: -1, area: 0 });

const BPM = 92;
const STEPS = 4; // steps per beat: sixteenths

export class Artist {
  private brushes: number[][] = [];
  private seed: number;
  /** Which way she turns things. */
  private spin: number;
  private clock = 0;
  private step = -1;

  constructor(private bath: Bath, palette: Palette, seed = Math.floor(Math.random() * 1e6)) {
    this.seed = seed;
    this.setPalette(palette);
    this.spin = hash(seed * 47) < 0.5 ? -1 : 1;
    this.breath.angle = hash(seed * 53) * Math.PI * 2;
    this.handTurn = hash(seed * 59) * Math.PI * 2;
  }

  /** The paints she uses, in the order she uses them: the kick's, the
   *  snare's, the chords', the tune's, the bass's. */
  setPalette(p: Palette) {
    this.brushes = p.paints.map(h => ink(h));
  }
  private brush(i: number) {
    return this.brushes[i % this.brushes.length];
  }

  private get aspect() {
    return this.bath.aspect;
  }
  /** The short side of the bath, in heights: places round her hand are in
   *  short sides, so a phone held upright shows the same picture as a
   *  landscape screen (the bath scales the sizes itself, see Bath.scale). */
  private get unit() {
    return Math.min(1, this.aspect);
  }
  /** A point `r` short sides from (x, y) at angle `a`, in the bath's uv. */
  private around(x: number, y: number, a: number, r: number): [number, number] {
    r *= this.unit;
    return [x + (Math.cos(a) * r) / this.aspect, y + Math.sin(a) * r];
  }
  /** A random number for this step and a purpose. */
  private rnd(step: number, k: number) {
    return hash(this.seed * 7919 + step * 131 + k);
  }

  // ── the hand and the beat ───────────────────────────────────────────
  private hand = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  private hands = { beat: pen(0, 0), melody: pen(0, 0.26), bass: pen(Math.PI, 0.26) };
  private handTurn = 0;
  /** Where a hand stands now: never close to the edge of the bath, where
   *  half of what it does would be lost. */
  private where(p: Pen): [number, number] {
    const [x, y] = p.r ? this.around(this.hand.x, this.hand.y, this.handTurn + p.a, p.r) : [this.hand.x, this.hand.y];
    return [clamp(x, 0.15, 0.85), clamp(y, 0.2, 0.8)];
  }
  /** A drop at one of her hands that spreads and coasts to a stop. One
   *  still spreading when the next comes finishes quickly first. */
  private touch(p: Pen, area: number, paint: number[], length = 0.4) {
    const b = this.bath;
    if (p.last && Math.abs(this.clock - p.at) < 0.04) {
      if (p.last.total === 0 && area > p.area) {
        b.feed(p.last, area);
        p.area = area;
      }
      return;
    }
    let delay = 0;
    if (p.last && b.spreading(p.last)) {
      b.hurry(p.last, 0.03);
      delay = p.last.delay + 0.03;
    }
    const [x, y] = this.where(p);
    p.last = b.drop(x, y, area, paint, { jag: 0, length, delay });
    p.area = area;
    p.at = this.clock;
  }
  /** Every other touch of a hand is soap, so its rings read apart. */
  private turn(p: Pen, paint: number[]) {
    return ++p.n % 2 ? paint : CLEAR;
  }

  // ── where the bath is still empty ───────────────────────────────────
  private empty = { x: 0.5, y: 0.5, at: -10 };
  private look() {
    if (this.clock - this.empty.at < 1) return;
    this.empty.at = this.clock;
    const { cells, w, h } = this.bath.coverage();
    let best = Infinity;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const x = (i + 0.5) / w,
          y = (j + 0.5) / h;
        if (x < 0.15 || x > 0.85 || y < 0.2 || y > 0.8) continue;
        // The ink round a cell counts too: an empty spot inside a full
        // region is not empty space.
        let sum = 0,
          n = 0;
        for (let dj = -2; dj <= 2; dj++)
          for (let di = -2; di <= 2; di++) {
            const a = i + di,
              b = j + dj;
            if (a < 0 || b < 0 || a >= w || b >= h) continue;
            sum += cells[b * w + a];
            n++;
          }
        const score = sum / n + 0.02 * hash(this.seed + i * 31 + j * 7);
        if (score < best) {
          best = score;
          this.empty.x = x;
          this.empty.y = y;
        }
      }
  }
  /** A new chord moves her hand to where there is the least ink, a little
   *  off it by the chord's step round the circle of fifths. */
  private chord(root: number) {
    const fifths = (root * 7) % 12,
      a = this.seed * 1.7 + (fifths / 12) * Math.PI * 2;
    [this.hand.tx, this.hand.ty] = this.around(this.empty.x, this.empty.y, a, 0.05);
  }

  // ── the breath ──────────────────────────────────────────────────────
  private breath = { angle: 0 };
  /** A slow, wide current over the whole bath, coming from behind her
   *  hand, swelling and ebbing over a few bars, turning slowly towards
   *  where the bath is emptiest. */
  private breathe(dt: number) {
    const b = this.breath;
    const level = 0.5 + 0.5 * Math.sin(this.clock * 0.35 + this.seed) * Math.sin(this.clock * 0.13);
    const want = Math.atan2(this.empty.y - this.hand.y, (this.empty.x - this.hand.x) * this.aspect);
    b.angle += Math.atan2(Math.sin(want - b.angle), Math.cos(want - b.angle)) * clamp(dt * 0.3);
    const a = b.angle,
      [x, y] = this.around(this.hand.x, this.hand.y, a + Math.PI, 0.2);
    const pull = (0.03 + 0.1 * level) * dt;
    this.bath.push(x, y, Math.cos(a) * pull, Math.sin(a) * pull, 0.3);
  }

  // ── her tools ───────────────────────────────────────────────────────
  private tool?: Tool;
  private toolBeat = 0;
  /** A needle along one of a few paths round her hand. */
  private startTool(beat: number, phrase: number) {
    const n = this.seed * 131 + phrase,
      kind = Math.floor(hash(n) * 4),
      a = hash(n * 3) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a),
      side = (hash(n * 5) - 0.5) * 0.1;
    // Across the hand along a line, as a wave, as a spiral out from it,
    // or a comb of three passes back and forth.
    const along = (u: number, off: number): [number, number] => [(u - 0.5) * 0.7 * c - off * s, (u - 0.5) * 0.7 * s + off * c];
    const path: Path = [
      (t: number) => along(t, side),
      (t: number) => along(t, side + 0.08 * Math.sin(t * Math.PI * 3)),
      (t: number): [number, number] => {
        const r = 0.05 + 0.22 * t,
          w = a + this.spin * t * Math.PI * 3;
        return [Math.cos(w) * r, Math.sin(w) * r];
      },
      (t: number) => {
        const k = Math.min(2, Math.floor(t * 3)),
          u = t * 3 - k;
        if (u < 0.04) return null;
        return along(k % 2 ? 1 - u : u, (k - 1) * 0.09);
      },
    ][kind];
    this.tool = { path, from: beat, beats: hash(n * 7) < 0.5 ? 4 : 8, last: null, strength: 0.7 + 0.3 * hash(n * 11) };
  }
  private needle(beat: number) {
    const t = this.tool;
    if (!t) return;
    const u = (beat - t.from) / t.beats;
    if (u >= 1 || u < 0) {
      this.tool = undefined;
      return;
    }
    const p = t.path(u),
      h = this.hand,
      k = this.unit;
    if (p && t.last) {
      const x0 = h.x + (t.last[0] * k) / this.aspect,
        y0 = h.y + t.last[1] * k;
      const x1 = h.x + (p[0] * k) / this.aspect,
        y1 = h.y + p[1] * k;
      this.bath.pin(x0, y0, x1, y1, Math.max(1 / 120, ((beat - this.toolBeat) * 60) / BPM), 0.009, t.strength);
    }
    t.last = p;
    this.toolBeat = beat;
  }

  // ── fan and alcohol ─────────────────────────────────────────────────
  private gusts: { left: number; x: number; y: number; a: number }[] = [];
  /** A stroke of the fan: a short strong gust across the bath, through
   *  her hand from one side. */
  private fanStroke(n: number) {
    const a = hash(n * 13) * Math.PI * 2,
      [x, y] = this.around(this.hand.x, this.hand.y, a + Math.PI, 0.3);
    this.gusts.push({ left: 0.35, x, y, a });
  }

  // ── isopropyl beside her hand ───────────────────────────────────────
  private syllables = 0;
  /** A burst: a patch torn open, its fingers curling. Pure and with
   *  colour in turn, so what one tears the next fills. */
  private burst(loud: number, n: number) {
    const coloured = ++this.syllables % 2 === 0;
    const [x, y] = this.around(this.hand.x, this.hand.y, this.seed * 2.3, 0.12);
    const spread = 0.03 * this.unit;
    this.bath.isoprop(
      x + ((hash(n * 3) - 0.5) * spread) / this.aspect,
      y + (hash(n * 5) - 0.5) * spread,
      0.012 + 0.028 * loud,
      coloured ? this.brush(2) : CLEAR,
      coloured && loud < 0.55,
    );
  }
  /** The bursts still to come in this phrase, as clock times. */
  private bursts: { at: number; loud: number }[] = [];

  // ── the score ───────────────────────────────────────────────────────
  /** One sixteenth of her time: what happens on it. */
  private play(step: number) {
    const beat = step / STEPS,
      inBar = step % 16,
      bar = Math.floor(step / 16),
      phrase = Math.floor(bar / 4),
      r = (k: number) => this.rnd(step, k);
    const B = this.brushes;
    // a phrase: a needle, maybe a line of bursts, maybe no tune
    if (step % 64 === 0) {
      this.startTool(beat, phrase);
      if (this.rnd(phrase, 1) < 0.35) {
        let t = this.clock + 0.5 + this.rnd(phrase, 2) * 2;
        const n = 4 + Math.floor(this.rnd(phrase, 3) * 6);
        for (let i = 0; i < n; i++) {
          this.bursts.push({ at: t, loud: 0.3 + 0.6 * this.rnd(phrase * 17 + i, 4) });
          t += 0.14 + 0.18 * this.rnd(phrase * 17 + i, 5);
        }
      }
    }
    const tune = this.rnd(phrase, 6) < 0.6,
      bass = this.rnd(phrase, 7) < 0.75;
    // a chord every two bars, and its strike
    if (step % 32 === 0) this.chord(Math.floor(r(8) * 12));
    // the beat: kick on one and three, snare on two and four
    const kick = inBar === 0 || inBar === 8 || ((inBar === 10 || inBar === 6) && r(11) < 0.25);
    const snare = inBar === 4 || inBar === 12;
    if (kick || snare) {
      const v = 0.6 + 0.4 * r(12);
      const area = kick ? 0.0012 + 0.002 * v * v : 0.0008 + 0.0016 * v * v;
      const soap = step % 64 === 0;
      const paint = soap ? CLEAR : kick ? B[0] : this.brush(1);
      this.touch(this.hands.beat, area * (soap ? 2 : 1), paint);
    }
    // (after the beat: a strike landing with a kick is one touch, the kick's)
    if (step % 32 === 0 || (inBar === 6 && r(9) < 0.3)) {
      const p = this.hands.beat;
      this.touch(p, 0.001 + 0.0012 * (0.6 + 0.4 * r(10)), this.turn(p, this.brush(2)), 0.5);
    }
    // the tune: notes on the eighths, now and then
    if (tune && inBar % 2 === 0 && r(13) < 0.4) {
      const p = this.hands.melody;
      this.touch(p, 0.0004 + 0.0006 * r(14), this.turn(p, this.brush(3)), 0.3);
    }
    // the bass
    if (bass && (inBar === 0 || inBar === 7 || (inBar === 10 && r(15) < 0.5))) {
      const p = this.hands.bass;
      this.touch(p, 0.0008 + 0.0012 * (0.5 + 0.5 * r(16)), this.turn(p, this.brush(4)), 0.4);
    }
    // the fan, now and then on the first beat of a bar
    if (inBar === 0 && bar % 8 === 4 && r(17) < 0.6) this.fanStroke(step);
    // every sixteen bars, alcohol at her hand
    if (step % 256 === 255) this.bath.isoprop(this.hand.x, this.hand.y, 0.14);
  }

  /** Bring the bath on by `dt` seconds. */
  frame(dt: number) {
    if (dt <= 0) return;
    this.clock += dt;
    const beat = (this.clock * BPM) / 60,
      step = Math.floor(beat * STEPS);
    // (a long frame plays the steps it missed, but not more than a bar)
    for (let s = Math.max(this.step + 1, step - 16); s <= step; s++) this.play(s);
    this.step = step;
    const h = this.hand;
    h.x += (h.tx - h.x) * clamp(dt * 2);
    h.y += (h.ty - h.y) * clamp(dt * 2);
    this.look();
    this.breathe(dt);
    this.needle(beat);
    for (const g of this.gusts) {
      this.bath.blow(g.x, g.y, Math.cos(g.a), Math.sin(g.a), 1.5);
      g.left -= dt;
    }
    this.gusts = this.gusts.filter(g => g.left > 0);
    while (this.bursts.length && this.bursts[0].at <= this.clock) {
      const b = this.bursts.shift()!;
      this.burst(b.loud, Math.floor(b.at * 50));
    }
  }
}
