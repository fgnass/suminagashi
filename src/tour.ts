import type { ToolId } from './main';

// THE GUIDED DEMO: the app shows how it is used.
//
// It works the bath as a person would, through the same tool bar, the same
// swatches and the same touches, and says in the hint what it does. A dot
// shows where its finger is. It goes through the tools one by one, then
// skims the bath and begins again. A touch on the water or on the bar ends
// it (see main.ts).

/** What the tour may do: the user's own controls. Places are in the bath's
 *  uv (x to the right, y up, both 0 to 1 over the screen). */
export interface Hands {
  tool(t: ToolId): void;
  /** An ink by its index in the palette, or -1 for soap. */
  paint(i: number): void;
  /** Back to one ink, no soap in turn. */
  resetPaint(): void;
  inks(): number;
  press(id: number, x: number, y: number): void;
  drag(id: number, x: number, y: number): void;
  lift(id: number): void;
  hint(text: string): void;
  /** Draw the eye to the print button for a while. */
  showPrint(on: boolean): void;
  skim(): void;
}

const SOAP = -1;
/** The tour's touches have ids of their own, below the browser's. */
const FINGER = -1;

export class Tour {
  private clock = 0;
  private waits: { at: number; done: () => void }[] = [];
  private stopped = false;
  private rnd: () => number;

  constructor(private h: Hands, seed = Math.floor(Math.random() * 1e6)) {
    let s = seed >>> 0 || 1;
    this.rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296;
    void this.run();
  }

  /** Bring the tour on by `dt` seconds. */
  frame(dt: number) {
    this.clock += dt;
    const due = this.waits.filter(w => w.at <= this.clock);
    this.waits = this.waits.filter(w => w.at > this.clock);
    for (const w of due) w.done();
  }

  stop() {
    this.stopped = true;
    this.waits = [];
    this.h.lift(FINGER);
    this.h.showPrint(false);
  }

  // ── time and touches ────────────────────────────────────────────────
  /** Wait `s` seconds of the tour's time (at least one frame). After a
   *  stop, it never ends: the script stays where it is and is let go. */
  private wait(s = 0) {
    return new Promise<void>(done => {
      if (!this.stopped) this.waits.push({ at: this.clock + Math.max(s, 1e-6), done });
    });
  }
  private async say(text: string, s: number) {
    this.h.hint(text);
    await this.wait(s);
  }
  private async tap(x: number, y: number, hold = 0.08) {
    this.h.press(FINGER, x, y);
    await this.wait(hold);
    this.h.lift(FINGER);
  }
  /** A touch along a path `p(t)`, t from 0 to 1, over `s` seconds. */
  private async stroke(p: (t: number) => [number, number], s: number, hold = 0) {
    const t0 = this.clock;
    this.h.press(FINGER, ...p(0));
    while (this.clock - t0 < s) {
      await this.wait();
      this.h.drag(FINGER, ...p(Math.min(1, (this.clock - t0) / s)));
    }
    if (hold) await this.wait(hold);
    this.h.lift(FINGER);
  }
  /** A number between a and b. */
  private between(a: number, b: number) {
    return a + (b - a) * this.rnd();
  }

  // ── the script ──────────────────────────────────────────────────────
  private async run() {
    const h = this.h;
    await this.say('Demo: touch the water to take over.', 2.5);
    for (;;) {
      h.resetPaint();
      const n = h.inks();
      const ink = (k: number) => k % n;
      const k0 = Math.floor(this.rnd() * n);

      // drops
      h.tool('drop');
      h.paint(ink(k0));
      await this.say('Drop: tap the water to let ink spread.', 0.8);
      for (const [x, y, k] of [[0.25, 0.75, 0], [0.75, 0.7, 1], [0.3, 0.42, 2]] as const) {
        h.paint(ink(k0 + k));
        await this.tap(x + this.between(-0.04, 0.04), y + this.between(-0.03, 0.03), 0.15);
        await this.wait(0.7);
      }

      // rings: soap, then an ink
      await this.wait(0.5);
      h.paint(SOAP);
      await this.say('For rings, tap the soap first…', 2);
      h.paint(ink(k0 + 1));
      await this.say('…then an ink. Now ink and soap drop in turn.', 1.5);
      const rings: [number, number][] = [
        [this.between(0.42, 0.58), this.between(0.58, 0.64)],
        [this.between(0.68, 0.76), this.between(0.36, 0.42)],
      ];
      for (let r = 0; r < rings.length; r++) {
        const [x, y] = rings[r];
        for (let i = 0; i < 22; i++) {
          if (r === 0 && i === 3) h.hint('Tap the same place again and again.');
          // (a new ink comes after a soap drop, so the turn goes on)
          if (i === 10) {
            h.paint(ink(k0 + 2 + r));
            if (r === 0) h.hint('Tap another ink at any time.');
          }
          await this.tap(x, y, 0.07);
          await this.wait(0.2);
        }
        await this.wait(0.8);
      }
      await this.wait(1.2);

      // needle
      h.tool('needle');
      await this.say('Needle: drag through the ink to pull it into lines.', 1);
      for (const x0 of [this.between(0.35, 0.45), this.between(0.6, 0.7)]) {
        await this.stroke(t => [x0 + 0.08 * Math.sin(t * Math.PI * 3), 0.85 - t * 0.6], 2.6);
        await this.wait(0.4);
      }
      await this.wait(1.5);

      // whisker
      h.tool('whisker');
      await this.say('Whisker: comb fine lines without swirls.', 1);
      for (const y0 of [0.66, 0.5, 0.34]) {
        await this.stroke(t => [0.08 + t * 0.84, y0 + 0.02 * Math.sin(t * Math.PI * 2)], 1.3);
        await this.wait(0.25);
      }
      await this.wait(1.5);

      // breath
      h.tool('breath');
      await this.say('Breath: touch where the air comes from, then drag to aim.', 1.5);
      {
        const side = this.rnd() < 0.5 ? 0.1 : 0.9,
          y = this.between(0.45, 0.6);
        await this.stroke(t => [side + (0.5 - side) * 0.45 * t, y + 0.06 * t], 0.8, 1.6);
      }
      await this.wait(1.5);

      // straw
      h.tool('straw');
      await this.say('Straw: a narrow jet of air.', 1);
      await this.stroke(t => [0.5 + 0.08 * t, 0.2 + 0.22 * t], 0.6, 1.4);
      await this.wait(1.5);

      // spray
      h.tool('spray');
      h.paint(ink(k0 + 3));
      await this.say('Spray: hold and move to flick fine drops.', 0.8);
      await this.stroke(t => [0.3 + 0.4 * t, 0.72 + 0.05 * Math.sin(t * Math.PI)], 1.6);
      await this.wait(1.5);

      // alcohol
      h.tool('alcohol');
      await this.say('Alcohol: a tap tears the ink film open.', 1);
      for (const [x, y] of rings) {
        await this.tap(x + this.between(-0.05, 0.05), y + this.between(-0.05, 0.05));
        await this.wait(0.9);
      }
      await this.wait(1.5);

      // the print
      h.showPrint(true);
      await this.say('Done? The button at the top right takes a print.', 4);
      h.showPrint(false);

      // again
      h.skim();
      await this.say('A fresh bath.', 2);
    }
  }
}
