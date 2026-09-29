/** Sound effects — all synthesized, routed to the sfx bus. */
import type { AnswerClass } from '../../shared/case-schema';
import { duckBgm, getBuses } from './engine';
import { GLOCK, bell, kick, mtof, pluck, snare, sweep, tick, type Out } from './synth';

export type SfxName =
  | 'hover'
  | 'confirm'
  | 'cancel'
  | 'error'
  | 'stamp'
  | 'finding'
  | 'findingCore'
  | 'shatter'
  | 'whoosh'
  | 'cutin'
  | 'gavel'
  | 'heartbeat'
  | 'page'
  | 'open'
  | 'close'
  | 'toggle'
  | 'refute'
  | 'reveal'
  | 'send'
  | 'dip'
  | 'reaction'
  | 'noReaction';

export type Speaker = 'holma' | 'jane' | 'narration' | 'system';

function out(): Out | null {
  const b = getBuses();
  if (!b || b.ctx.state !== 'running') return null;
  return { ctx: b.ctx, dry: b.sfx, wet: b.sfxVerb, noise: b.noise };
}

function tone(o: Out, t: number, freq: number, dur: number, type: OscillatorType, vel: number, bend = 1, wet = 0.1) {
  const { ctx } = o;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(o.dry);
  if (wet) {
    const w = ctx.createGain();
    w.gain.value = wet;
    g.connect(w);
    w.connect(o.wet);
  }
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let lastHover = 0;
let lastBlip = 0;

export function playSfx(name: SfxName, opts: { answerClass?: AnswerClass } = {}) {
  const o = out();
  if (!o) return;
  const t = o.ctx.currentTime + 0.005;
  switch (name) {
    // UI ticks: +8 dB over the first mix, which sat 15–40 dB under the BGM (inaudible)
    case 'hover': {
      if (t - lastHover < 0.045) return;
      lastHover = t;
      tick(o, t, { vel: 0.125, pitch: 3200 });
      break;
    }
    case 'toggle':
      tick(o, t, { vel: 0.3, pitch: 1800 });
      tick(o, t + 0.04, { vel: 0.2, pitch: 2600 });
      break;
    case 'confirm':
      pluck(o, t, 81, { vel: 0.16, decay: 0.16, type: 'square', cutoff: 5000 });
      pluck(o, t + 0.06, 88, { vel: 0.14, decay: 0.28, type: 'square', cutoff: 5000, wet: 0.25 });
      break;
    case 'send':
      pluck(o, t, 76, { vel: 0.12, decay: 0.1, type: 'triangle', cutoff: 6000 });
      sweep(o, t, 0.16, { vel: 0.08, from: 1200, to: 5000, shape: 'swell' });
      break;
    case 'cancel':
      pluck(o, t, 76, { vel: 0.13, decay: 0.14, type: 'square', cutoff: 3000 });
      pluck(o, t + 0.06, 69, { vel: 0.11, decay: 0.22, type: 'square', cutoff: 2400 });
      break;
    case 'open':
      sweep(o, t, 0.22, { vel: 0.25, from: 500, to: 3500, shape: 'swell' });
      pluck(o, t + 0.05, 84, { vel: 0.15, decay: 0.2, type: 'triangle', wet: 0.3 });
      break;
    case 'close':
      sweep(o, t, 0.18, { vel: 0.2, from: 3000, to: 500, shape: 'swell' });
      break;
    case 'page':
      sweep(o, t, 0.12, { vel: 0.25, from: 2500, to: 6000, q: 0.8, shape: 'swell' });
      break;
    case 'error':
      tone(o, t, 110, 0.26, 'square', 0.1, 0.9, 0);
      tone(o, t, 116.5, 0.26, 'square', 0.1, 0.9, 0);
      break;
    case 'stamp': {
      duckBgm(-3, 0.25);
      kick(o, t, { vel: 0.8, tone: 120 });
      sweep(o, t, 0.1, { vel: 0.35, from: 900, to: 300, q: 0.6, shape: 'fall', wet: 0.1 });
      sweep(o, t + 0.005, 0.05, { vel: 0.25, from: 4000, to: 2000, q: 0.5, shape: 'fall', wet: 0 });
      const cls = opts.answerClass;
      if (cls === 'yes') pluck(o, t + 0.04, 88, { vel: 0.1, decay: 0.3, type: 'square', wet: 0.3 });
      else if (cls === 'no') tone(o, t + 0.04, 180, 0.22, 'sawtooth', 0.07, 0.7, 0.1);
      else if (cls === 'partial') pluck(o, t + 0.04, 79, { vel: 0.08, decay: 0.25, type: 'triangle', wet: 0.3 });
      else if (cls === 'cannot') bell(o, t + 0.04, 66, { vel: 0.08, decay: 0.8, wet: 0.4 });
      break;
    }
    case 'finding':
      [76, 80, 83, 88].forEach((m, i) => bell(o, t + i * 0.055, m, { vel: 0.12, decay: 1.4, partials: GLOCK, wet: 0.4 }));
      sweep(o, t, 0.4, { vel: 0.05, from: 2000, to: 9000, shape: 'swell' });
      break;
    case 'findingCore':
      duckBgm(-4, 0.6);
      [64, 71, 76, 80, 83, 88, 92].forEach((m, i) => bell(o, t + i * 0.05, m, { vel: 0.11, decay: 1.8, partials: GLOCK, wet: 0.5 }));
      kick(o, t, { vel: 0.5, tone: 90 });
      sweep(o, t, 0.7, { vel: 0.08, from: 1500, to: 10000, shape: 'swell' });
      break;
    case 'shatter': {
      sweep(o, t, 0.5, { vel: 0.45, from: 6000, to: 2500, q: 0.4, shape: 'fall', wet: 0.3 });
      kick(o, t, { vel: 0.5, tone: 200 });
      for (let i = 0; i < 16; i++) {
        const f = 2600 + Math.random() * 5200;
        tone(o, t + Math.random() * 0.35, f, 0.05 + Math.random() * 0.12, 'sine', 0.05 + Math.random() * 0.05, 1, 0.3);
      }
      break;
    }
    case 'refute':
      duckBgm(-4, 0.4);
      kick(o, t, { vel: 1, tone: 170 });
      snare(o, t, { vel: 0.5 });
      sweep(o, t, 0.6, { vel: 0.4, from: 7000, to: 1500, q: 0.4, shape: 'fall', wet: 0.4 });
      [52, 59, 64, 71].forEach((m) => tone(o, t, mtof(m), 0.5, 'sawtooth', 0.04, 1, 0.3));
      break;
    case 'whoosh':
      sweep(o, t, 0.32, { vel: 0.22, from: 300, to: 3200, q: 1.2, shape: 'swell', wet: 0.1 });
      break;
    // --- the inquest's 反証 (litmus test): a paper glide, the colour change, no colour change ---
    case 'dip':
      // the finding card leaves the case: a papery glide and a soft touch
      sweep(o, t, 0.26, { vel: 0.14, from: 900, to: 4200, q: 0.9, shape: 'swell', wet: 0.05 });
      tick(o, t + 0.24, { vel: 0.22, pitch: 2200 });
      break;
    case 'reaction': {
      // 反応あり: a drop lands (a quick upward "plip"), then the colour develops — a rising
      // glassy chord that opens up, with a soft low bump for weight (no gunshot, no shatter)
      duckBgm(-4, 0.5);
      tone(o, t, 520, 0.12, 'sine', 0.3, 2.2, 0.2);
      tone(o, t + 0.01, 1040, 0.08, 'sine', 0.08, 1.6, 0.3);
      kick(o, t, { vel: 0.42, tone: 110 });
      [67, 71, 74, 79, 83, 86].forEach((m, i) => bell(o, t + 0.07 + i * 0.045, m, { vel: 0.1, decay: 1.6, partials: GLOCK, wet: 0.5 }));
      [55, 62, 67].forEach((m) => tone(o, t + 0.06, mtof(m), 0.7, 'triangle', 0.045, 1.0, 0.4));
      sweep(o, t + 0.05, 0.8, { vel: 0.07, from: 1200, to: 9000, shape: 'swell', wet: 0.5 });
      break;
    }
    case 'noReaction':
      // 反応なし: the paper touches and nothing happens — two dull, damped taps going down
      pluck(o, t, 57, { vel: 0.16, decay: 0.12, type: 'triangle', cutoff: 1400 });
      pluck(o, t + 0.13, 52, { vel: 0.14, decay: 0.2, type: 'triangle', cutoff: 1100 });
      sweep(o, t + 0.02, 0.22, { vel: 0.06, from: 1600, to: 500, q: 0.8, shape: 'fall', wet: 0 });
      break;
    case 'cutin':
      duckBgm(-4, 0.4);
      sweep(o, t, 0.28, { vel: 0.26, from: 400, to: 5000, q: 1, shape: 'swell' });
      kick(o, t + 0.2, { vel: 0.6, tone: 130 });
      snare(o, t + 0.2, { vel: 0.18 });
      break;
    case 'gavel': {
      tone(o, t, 620, 0.12, 'sine', 0.35, 0.8, 0.5);
      tone(o, t, 95, 0.3, 'sine', 0.6, 0.6, 0.4);
      sweep(o, t, 0.08, { vel: 0.3, from: 1200, to: 700, q: 2, shape: 'fall', wet: 0.5 });
      break;
    }
    case 'heartbeat':
      tone(o, t, 58, 0.18, 'sine', 0.55, 0.7, 0);
      tone(o, t + 0.2, 52, 0.22, 'sine', 0.42, 0.7, 0);
      break;
    case 'reveal':
      [60, 67, 72, 76, 79, 84].forEach((m, i) => bell(o, t + i * 0.09, m, { vel: 0.1, decay: 2.6, partials: GLOCK, wet: 0.6 }));
      sweep(o, t, 1.4, { vel: 0.08, from: 800, to: 8000, shape: 'swell', wet: 0.6 });
      break;
  }
}

/** Typewriter voice blip. Rate-limited so fast text doesn't turn into a buzz. */
export function playBlip(speaker: Speaker) {
  const o = out();
  if (!o) return;
  const t = o.ctx.currentTime + 0.002;
  if (t - lastBlip < 0.042) return;
  lastBlip = t;
  const r = Math.random();
  switch (speaker) {
    // voice blips: ~+8 dB so the typewriter voice is heard over the music (was 15–23 LU under)
    case 'holma': {
      const f = 740 * Math.pow(2, (Math.floor(r * 5) - 2) / 12);
      tone(o, t, f, 0.045, 'square', 0.11, 1.08, 0);
      break;
    }
    case 'jane': {
      const f = 1244 * Math.pow(2, (Math.floor(r * 3) * 2) / 12);
      tone(o, t, f, 0.12, 'sine', 0.12, 1, 0.5);
      tone(o, t, f * 2.01, 0.06, 'sine', 0.036, 1, 0.5);
      break;
    }
    case 'narration':
      tone(o, t, 330 + r * 30, 0.03, 'triangle', 0.09, 1, 0);
      break;
    default:
      tick(o, t, { vel: 0.1, pitch: 2800 });
  }
}
