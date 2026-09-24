/**
 * Five procedural BGM tracks (bible §4-4). Each track is a 16-bar loop on a 16th-note grid:
 * bars 0–7 = section A, bars 8–15 = section B (variation every 8 bars).
 *
 * `step(api, bar, step, t)` is called for every 16th note slightly ahead of time.
 */
import { GLOCK, MUSIC_BOX, bell, clap, hat, kick, pad, piano, pizz, pluck, sawBass, snare, stab, sub, sweep, tick, vibes, type Out } from './synth';

export type BgmId = 'title' | 'investigation' | 'inquest' | 'truth' | 'science';

export interface TrackApi {
  out: Out;
  /** seconds per 16th note */
  s16: number;
  /** loop counter (0, 1, 2 …) — for slow evolution across loops */
  loop: number;
  rand: () => number;
}

export interface Track {
  id: BgmId;
  bpm: number;
  bars: number;
  swing?: number; // 0..0.3 of a 16th, applied to odd 16ths
  gain: number;
  /** delay send (seconds, feedback) */
  echo?: [number, number];
  step(api: TrackApi, bar: number, step: number, t: number): void;
}

const _ = null;
type N = number | null;

/* ================================================================== */
/* TITLE — music box + low drone, D minor, 74 BPM                      */
/* ================================================================== */
const TITLE_CHORDS: number[][] = [
  // A: Dm  Bb  Gm  A7  Dm  Bb  Gm6  A7
  [50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52, 55],
  [50, 53, 57], [46, 50, 53], [43, 46, 50, 52], [45, 49, 52, 55],
  // B: Dm  Gm  Bbmaj7  A7  Dm  Gm  Ebmaj7  A7
  [50, 53, 57], [43, 46, 50], [46, 50, 53, 57], [45, 49, 52, 55],
  [50, 53, 57], [43, 46, 50], [51, 55, 58, 62], [45, 49, 52, 55],
];
// music box melody, 8th notes (8 per bar)
const TITLE_MEL: N[][] = [
  [86, _, 81, _, 77, 81, 74, _],
  [82, _, 77, _, 74, 77, 70, _],
  [79, 82, 86, _, 84, 82, 79, _],
  [81, _, 76, 73, 76, _, 79, _],
  [86, _, 88, 89, 88, _, 86, _],
  [82, _, 86, _, 89, _, 86, 82],
  [79, _, 82, _, 76, _, 79, _],
  [81, 79, 76, 73, 69, _, _, _],
  [74, 77, 81, 86, _, 81, 77, _],
  [79, 82, 86, 91, _, 86, 82, _],
  [81, _, 77, _, 74, _, 70, _],
  [73, 76, 79, 81, _, 79, 76, _],
  [86, _, 81, _, 86, 89, 88, 86],
  [82, _, 79, _, 82, 86, 84, 82],
  [79, _, 75, _, 70, _, 74, _],
  [76, _, 74, _, 73, _, _, _],
];

const title: Track = {
  id: 'title',
  bpm: 74,
  bars: 16,
  gain: 0.9,
  echo: [0.405, 0.32],
  step(api, bar, s, t) {
    const { out, s16 } = api;
    const chord = TITLE_CHORDS[bar];
    const B = bar >= 8;
    if (s === 0 && bar % 4 === 0) {
      // low drone: D + A, 4 bars
      pad(out, t, [26, 38, 45], s16 * 64, { vel: 0.1, attack: 2.4, release: 3, cutoff: 420, wet: 0.5, type: 'triangle' });
      sub(out, t, 26, s16 * 60, { vel: 0.08, attack: 2, release: 3 });
    }
    if (s === 0) {
      pad(out, t, chord.map((m) => m + 12), s16 * 16, { vel: 0.05, attack: 1.2, release: 2, cutoff: 900, wet: 0.8 });
      if (bar % 8 === 0) bell(out, t, 38, { vel: 0.18, decay: 5, partials: GLOCK, wet: 0.6 });
    }
    if (s % 2 === 0) {
      const n = TITLE_MEL[bar][s / 2];
      if (n !== null) {
        const detune = (api.rand() - 0.5) * 10;
        bell(out, t + (api.rand() - 0.5) * 0.012, n, { vel: 0.19, decay: 1.6, partials: MUSIC_BOX, wet: 0.35, echo: 0.22, detune });
      }
    }
    if (B && (s === 3 || s === 7 || s === 11 || s === 15)) {
      const tone = chord[(s >> 2) % chord.length] + 24;
      bell(out, t, tone, { vel: 0.05, decay: 1.2, partials: MUSIC_BOX, wet: 0.5, echo: 0.3 });
    }
    if (s === 8 && bar % 2 === 1) {
      // distant heartbeat-like low knock
      tick(out, t, { vel: 0.05, pitch: 180 });
    }
  },
};

/* ================================================================== */
/* INVESTIGATION — pizzicato, clock, vibes, A minor, 90 BPM            */
/* ================================================================== */
interface Ch { root: number; v: number[] }
const INV: Ch[] = [
  { root: 45, v: [60, 64, 67, 71] }, // Am9
  { root: 41, v: [57, 60, 64, 67] }, // Fmaj9
  { root: 38, v: [57, 60, 64, 65] }, // Dm9
  { root: 40, v: [56, 59, 62, 65] }, // E7b9
  { root: 45, v: [60, 64, 67, 71] }, // Am9
  { root: 41, v: [57, 60, 64, 67] }, // Fmaj9
  { root: 46, v: [62, 64, 65, 69] }, // Bbmaj7#11
  { root: 40, v: [56, 59, 62, 64] }, // E7
  { root: 45, v: [60, 64, 67, 71] }, // Am9
  { root: 48, v: [59, 60, 64, 67] }, // Cmaj7
  { root: 41, v: [57, 60, 64, 67] }, // Fmaj9
  { root: 40, v: [57, 62, 64, 71] }, // E7sus4
  { root: 45, v: [60, 64, 67, 71] }, // Am9
  { root: 38, v: [57, 60, 64, 65] }, // Dm9
  { root: 46, v: [62, 64, 65, 69] }, // Bbmaj7#11
  { root: 40, v: [56, 59, 62, 65] }, // E7b9
];
const INV_MEL: [number, number, number][] = [
  // [bar, step, midi] — section B only
  [8, 0, 76], [8, 6, 72], [8, 8, 71], [8, 12, 69],
  [9, 0, 67], [9, 6, 71], [9, 8, 72], [9, 12, 76],
  [10, 0, 81], [10, 6, 79], [10, 10, 76],
  [11, 0, 74], [11, 8, 71], [11, 12, 68],
  [12, 0, 72], [12, 4, 76], [12, 8, 83], [12, 12, 81],
  [13, 0, 77], [13, 6, 76], [13, 8, 72], [13, 12, 69],
  [14, 0, 74], [14, 4, 76], [14, 8, 77], [14, 12, 81],
  [15, 0, 80], [15, 6, 77], [15, 8, 74], [15, 12, 71],
];
const invMelAt = new Map(INV_MEL.map(([b, s, m]) => [`${b}:${s}`, m]));

const investigation: Track = {
  id: 'investigation',
  bpm: 90,
  bars: 16,
  swing: 0.12,
  gain: 1,
  echo: [0.5, 0.25],
  step(api, bar, s, t) {
    const { out, s16 } = api;
    const ch = INV[bar];
    const next = INV[(bar + 1) % INV.length];
    const B = bar >= 8;
    // clock: tick-tock on quarters
    if (s % 4 === 0) tick(out, t, { vel: 0.07, pitch: s % 8 === 0 ? 2400 : 1700 });
    // pizzicato bass line
    const bassPlan: Record<number, number> = { 0: ch.root, 6: ch.root + 7, 10: ch.root + 12, 14: next.root + (next.root > ch.root ? -1 : 1) };
    if (s in bassPlan) pizz(out, t, bassPlan[s], { vel: s === 0 ? 0.55 : 0.38 });
    if (B && s === 3 && bar % 2 === 1) pizz(out, t, ch.root + 12, { vel: 0.2, decay: 0.25 });
    // vibraphone comp (rolled)
    if (s === 0) ch.v.forEach((m, i) => vibes(out, t + i * 0.028, m, { vel: 0.11, decay: 2.8, echo: 0.1 }));
    if (s === 10 && bar % 2 === 1) ch.v.slice(1).forEach((m, i) => vibes(out, t + i * 0.02, m, { vel: 0.06, decay: 1.6 }));
    // melody (B)
    const m = invMelAt.get(`${bar}:${s}`);
    if (m) vibes(out, t, m, { vel: 0.16, decay: 2.2, echo: 0.28 });
    // brushes / shaker
    if (B ? s % 2 === 0 : bar >= 4 && s % 4 === 2) hat(out, t, { vel: s % 4 === 2 ? 0.05 : 0.025 });
    // low pad bed
    if (s === 0) pad(out, t, [ch.root + 12], s16 * 16, { vel: 0.05, cutoff: 500, attack: 0.6, release: 1, type: 'triangle' });
  },
};

/* ================================================================== */
/* INQUEST — four-on-the-floor, rolling bass, stabs, E minor, 138 BPM  */
/* ================================================================== */
const INQ: { root: number; chord: number[] }[] = [
  { root: 40, chord: [64, 67, 71] }, // Em
  { root: 40, chord: [64, 67, 71] }, // Em
  { root: 36, chord: [64, 67, 72] }, // C
  { root: 38, chord: [62, 66, 69] }, // D
  { root: 40, chord: [64, 67, 71] }, // Em
  { root: 40, chord: [64, 67, 71] }, // Em
  { root: 36, chord: [64, 67, 72] }, // C
  { root: 35, chord: [63, 66, 69] }, // B7
  { root: 45, chord: [64, 69, 72] }, // Am
  { root: 36, chord: [64, 67, 72] }, // C
  { root: 38, chord: [62, 66, 69] }, // D
  { root: 40, chord: [64, 67, 71] }, // Em
  { root: 45, chord: [64, 69, 72] }, // Am
  { root: 36, chord: [64, 67, 72] }, // C
  { root: 35, chord: [63, 66, 69, 71] }, // B7
  { root: 35, chord: [63, 66, 69, 71] }, // B7 (break)
];
const ROLL = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 7, 10];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5];

const inquest: Track = {
  id: 'inquest',
  bpm: 138,
  bars: 16,
  gain: 0.82,
  echo: [0.326, 0.22],
  step(api, bar, s, t) {
    const { out, s16 } = api;
    const c = INQ[bar];
    const B = bar >= 8;
    const brk = bar >= 14; // 2-bar break before the loop
    // drums
    if (!brk && s % 4 === 0) kick(out, t, { vel: 0.95 });
    if (bar === 14 && s === 0) kick(out, t, { vel: 0.95 });
    if (!brk && (s === 4 || s === 12)) {
      clap(out, t, { vel: 0.38 });
      snare(out, t, { vel: 0.22 });
    }
    if (bar === 15) snare(out, t, { vel: 0.08 + (s / 16) * 0.35, decay: 0.1 });
    if (!brk && s % 4 === 2) hat(out, t, { vel: 0.14, open: s === 14 && bar % 2 === 1 });
    if (B && !brk && s % 2 === 1) hat(out, t, { vel: 0.05 });
    if (bar === 15 && s === 0) sweep(out, t, s16 * 16, { vel: 0.12, from: 300, to: 7000, shape: 'rise' });
    if (bar === 0 && s === 0) {
      bell(out, t, 28, { vel: 0.22, decay: 4, partials: GLOCK, wet: 0.7 });
      sweep(out, t, 1.2, { vel: 0.1, from: 5000, to: 300, shape: 'fall' });
    }
    // rolling bass (filter opens over each 2-bar phrase)
    if (!(bar === 15 && s >= 8)) {
      const phase = ((bar % 2) * 16 + s) / 32;
      const cutoff = 380 + 1500 * Math.sin(phase * Math.PI) ** 2;
      sawBass(out, t, c.root + ROLL[s], s16 * 0.8, { vel: s % 4 === 0 ? 0.3 : 0.22, cutoff, env: 2 });
    }
    // stabs
    const stabSteps = bar % 2 === 0 ? [0, 3, 6, 10] : [2, 8, 11];
    if (!brk && stabSteps.includes(s)) stab(out, t, c.chord, { vel: bar % 2 === 0 && s === 0 ? 0.2 : 0.15, decay: 0.2 });
    if (brk && s === 0) stab(out, t, c.chord.map((m) => m + 12), { vel: 0.2, decay: 0.6, cutoff: 5000 });
    // lead arpeggio in B
    if (B && bar < 14) {
      const tones = [...c.chord, ...c.chord.map((m) => m + 12)];
      pluck(out, t, tones[ARP[s] % tones.length] + 12, { vel: 0.07, decay: 0.14, cutoff: 4200, echo: 0.2, type: 'square' });
    }
    // tension pad (A section)
    if (!B && s === 0 && bar % 2 === 0) pad(out, t, c.chord.map((m) => m - 12), s16 * 32, { vel: 0.07, cutoff: 1100, attack: 0.4, release: 0.8 });
  },
};

/* ================================================================== */
/* TRUTH — slow felt piano + pad, C major, 64 BPM                      */
/* ================================================================== */
const TRUTH: { bass: number; tones: number[] }[] = [
  { bass: 41, tones: [53, 57, 60, 64] }, // Fmaj7
  { bass: 40, tones: [52, 55, 59, 62] }, // Em7
  { bass: 38, tones: [50, 53, 57, 60] }, // Dm7
  { bass: 36, tones: [48, 52, 55, 59] }, // Cmaj7
  { bass: 41, tones: [53, 57, 60, 64] }, // Fmaj7
  { bass: 43, tones: [55, 59, 62, 64] }, // G6
  { bass: 45, tones: [57, 60, 64, 67] }, // Am7
  { bass: 45, tones: [57, 59, 64, 67] }, // Am(add9)
  { bass: 38, tones: [53, 57, 60, 64] }, // Dm9
  { bass: 43, tones: [55, 60, 62, 65] }, // G7sus4
  { bass: 40, tones: [52, 55, 59, 62] }, // Em7
  { bass: 45, tones: [57, 60, 64, 67] }, // Am7
  { bass: 41, tones: [53, 57, 60, 64] }, // Fmaj7
  { bass: 41, tones: [53, 56, 60, 62] }, // Fm6
  { bass: 36, tones: [48, 52, 55, 59] }, // Cmaj7
  { bass: 36, tones: [48, 52, 55, 59] }, // Cmaj7
];
const TRUTH_ARP = [0, 2, 3, 1, 4, 2, 3, 1];
const TRUTH_MEL: [number, number, number][] = [
  [4, 0, 81], [4, 8, 79],
  [5, 0, 76], [5, 8, 74],
  [6, 0, 72], [6, 4, 74], [6, 8, 76],
  [7, 0, 76],
  [8, 0, 77], [8, 6, 76], [8, 8, 74], [8, 12, 72],
  [9, 0, 74], [9, 8, 72],
  [10, 0, 71], [10, 8, 79],
  [11, 0, 81], [11, 8, 76],
  [12, 0, 81], [12, 8, 84],
  [13, 0, 80], [13, 8, 77],
  [14, 0, 79], [14, 8, 76],
  [15, 0, 72],
];
const truthMelAt = new Map(TRUTH_MEL.map(([b, s, m]) => [`${b}:${s}`, m]));

const truth: Track = {
  id: 'truth',
  bpm: 64,
  bars: 16,
  gain: 1,
  echo: [0.47, 0.25],
  step(api, bar, s, t) {
    const { out, s16 } = api;
    const c = TRUTH[bar];
    if (s === 0) {
      pad(out, t, c.tones.map((m) => m + 12), s16 * 16, { vel: 0.06, attack: 1.4, release: 2.4, cutoff: 1200, wet: 0.8 });
      sub(out, t, c.bass - 12, s16 * 15, { vel: 0.1, attack: 0.3, release: 1 });
      piano(out, t, c.bass, { vel: 0.18, decay: 3.2 });
    }
    if (s % 2 === 0) {
      const pool = [...c.tones, c.tones[1] + 12];
      const idx = TRUTH_ARP[(s / 2) % TRUTH_ARP.length];
      const human = (api.rand() - 0.5) * 0.02;
      piano(out, t + human, pool[idx], { vel: s === 0 ? 0.13 : 0.08 + api.rand() * 0.03, decay: 2.2, echo: 0.08 });
    }
    const m = truthMelAt.get(`${bar}:${s}`);
    if (m) piano(out, t + 0.01, m, { vel: 0.2, decay: 3.4, wet: 0.55, echo: 0.2 });
  },
};

/* ================================================================== */
/* SCIENCE — calm ambient, bell arps through echo, 80 BPM              */
/* ================================================================== */
const SCI: { root: number; pad: number[]; tones: number[] }[] = [
  { root: 36, pad: [55, 59, 62, 64], tones: [72, 74, 76, 79, 83] }, // Cmaj9
  { root: 45, pad: [55, 59, 60, 64], tones: [69, 71, 72, 76, 79] }, // Am9
  { root: 41, pad: [55, 57, 60, 64], tones: [69, 72, 76, 77, 79] }, // Fmaj9
  { root: 43, pad: [57, 59, 62, 64], tones: [71, 74, 76, 79, 81] }, // G6/9
  { root: 40, pad: [54, 55, 59, 62], tones: [66, 67, 71, 74, 78] }, // Em9
  { root: 45, pad: [55, 59, 60, 64], tones: [69, 71, 72, 76, 79] }, // Am9
  { root: 38, pad: [53, 57, 60, 64], tones: [69, 72, 74, 76, 77] }, // Dm9
  { root: 43, pad: [55, 60, 62, 65], tones: [67, 72, 74, 77, 79] }, // G7sus4
];
// fixed, musical rhythm for the bell arp (steps per 2 bars), varied by loop parity
const SCI_RHYTHM_A = [0, 3, 6, 10, 14, 16, 19, 22, 26, 28];
const SCI_RHYTHM_B = [0, 2, 6, 8, 11, 16, 18, 22, 24, 27, 30];

const science: Track = {
  id: 'science',
  bpm: 80,
  bars: 16,
  gain: 0.95,
  echo: [0.5625, 0.38],
  step(api, bar, s, t) {
    const { out, s16 } = api;
    const c = SCI[Math.floor(bar / 2)];
    const B = bar >= 8;
    const pos = (bar % 2) * 16 + s;
    if (pos === 0) {
      pad(out, t, c.pad, s16 * 32, { vel: 0.1, attack: 1.8, release: 2.6, cutoff: 1300, wet: 0.85, type: 'triangle' });
      pad(out, t, c.pad.map((m) => m + 12), s16 * 32, { vel: 0.035, attack: 2.4, release: 2.6, cutoff: 2400, wet: 0.9 });
      sub(out, t, c.root - 12, s16 * 30, { vel: 0.12, attack: 1, release: 2 });
    }
    const rhythm = (api.loop + (B ? 1 : 0)) % 2 === 0 ? SCI_RHYTHM_A : SCI_RHYTHM_B;
    const idx = rhythm.indexOf(pos);
    if (idx >= 0) {
      const tone = c.tones[(idx * 2 + bar) % c.tones.length];
      bell(out, t, tone, { vel: 0.09, decay: 1.8, partials: GLOCK, wet: 0.5, echo: 0.45 });
    }
    // B section: gentle pulse
    if (B && s % 4 === 0) pluck(out, t, c.root + 12 + (s === 8 ? 7 : 0), { vel: 0.06, decay: 0.3, type: 'triangle', cutoff: 1400, wet: 0.3 });
    // occasional "bubble"
    if (s === 13 && bar % 4 === 3) pluck(out, t, 84 + Math.floor(api.rand() * 5), { vel: 0.035, decay: 0.12, type: 'sine', cutoff: 6000, echo: 0.5 });
  },
};

export const TRACKS: Record<BgmId, Track> = { title, investigation, inquest, truth, science };
