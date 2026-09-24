/**
 * WebAudio engine: one AudioContext, created lazily on the first user gesture.
 *
 *   voices ─┬─► bgmBus ─► bgmDuck ─┐
 *           │                      ├─► master ─► compressor ─► limiter ─► destination
 *   sfx ────┴─► sfxBus ────────────┘
 *   (sends) ─► reverbIn ─► convolver ─► reverbOut ─► bgmBus / sfxBus
 *
 * Nothing here runs before a gesture: settings changes only touch buses that already exist
 * (peekBuses), and the reverb impulses are synthesised in small slices after the context is
 * running, so the gesture handler itself stays cheap.
 */
import { signal } from '@preact/signals';

export interface Buses {
  ctx: AudioContext;
  master: GainNode;
  bgm: GainNode;
  /** Short-term ducking of the music under big SFX moments (see duckBgm). */
  bgmDuck: GainNode;
  sfx: GainNode;
  /** Shared reverb send for music. */
  bgmVerb: GainNode;
  /** Shared reverb send for sound effects. */
  sfxVerb: GainNode;
  noise: AudioBuffer;
}

export const audioUnlocked = signal(false);

let buses: Buses | null = null;
let failed = false;
let convolvers: { node: ConvolverNode; seconds: number; decay: number }[] = [];
let impulsesStarted = false;

const nextSlice = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Slightly low-passed decaying noise for a darker "stone room" tail. Built in 20k-sample
 * slices, yielding to the event loop between them (the whole thing took ~160 ms in one go).
 */
async function makeImpulse(ctx: AudioContext, seconds: number, decay: number): Promise<AudioBuffer> {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  const attack = Math.floor(rate * 0.012);
  const SLICE = 20000;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let start = 0; start < len; start += SLICE) {
      const end = Math.min(len, start + SLICE);
      for (let i = start; i < end; i++) {
        const t = i / len;
        lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
        const env = Math.exp(decay * Math.log(Math.max(1e-6, 1 - t))); // (1 - t)^decay
        d[i] = lp * env * (i < attack ? i / attack : 1);
      }
      await nextSlice();
    }
  }
  return buf;
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Fill the reverb convolvers once the context runs (the dry signal plays meanwhile). */
function startImpulses() {
  if (impulsesStarted || !buses) return;
  impulsesStarted = true;
  const ctx = buses.ctx;
  void (async () => {
    for (const c of convolvers) {
      try {
        c.node.buffer = await makeImpulse(ctx, c.seconds, c.decay);
      } catch {
        /* reverb is decoration: a failure just leaves it dry */
      }
    }
  })();
}

/** The buses if the context already exists — never creates it (safe before a gesture). */
export function peekBuses(): Buses | null {
  return buses;
}

/** Returns the buses, creating the context if needed. Null if WebAudio is unavailable. */
export function getBuses(): Buses | null {
  if (buses || failed) return buses;
  try {
    const Ctx: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) {
      failed = true;
      return null;
    }
    const ctx = new Ctx({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    // brick-wall-ish safety limiter: a refute + shatter + cut-in over the inquest BGM used to
    // go over full scale (+0.3 dBFS) at the destination
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(limiter);
    limiter.connect(ctx.destination);

    const bgm = ctx.createGain();
    const bgmDuck = ctx.createGain();
    const sfx = ctx.createGain();
    bgm.connect(bgmDuck);
    bgmDuck.connect(master);
    sfx.connect(master);

    const conv = ctx.createConvolver();
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.9;
    conv.connect(verbOut);
    const bgmVerb = ctx.createGain();
    bgmVerb.connect(conv);
    verbOut.connect(bgm);

    const conv2 = ctx.createConvolver();
    const sfxVerb = ctx.createGain();
    sfxVerb.connect(conv2);
    conv2.connect(sfx);
    convolvers = [
      { node: conv2, seconds: 1.6, decay: 3.2 },
      { node: conv, seconds: 3.2, decay: 2.6 },
    ];

    buses = { ctx, master, bgm, bgmDuck, sfx, bgmVerb, sfxVerb, noise: makeNoise(ctx) };
    return buses;
  } catch {
    failed = true;
    return null;
  }
}

/** Resume the context. Must be called from a user gesture the first time. */
export async function unlockAudio(): Promise<boolean> {
  const b = getBuses();
  if (!b) return false;
  try {
    if (b.ctx.state !== 'running') await b.ctx.resume();
  } catch {
    /* ignore */
  }
  const ok = b.ctx.state === 'running';
  if (ok) startImpulses();
  if (ok && !audioUnlocked.peek()) audioUnlocked.value = true;
  return ok;
}

export function currentTime(): number {
  return buses ? buses.ctx.currentTime : 0;
}

/** Smoothly set a gain param. */
export function rampGain(g: GainNode, value: number, seconds = 0.08) {
  if (!buses) return;
  const t = buses.ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(value, t + seconds);
}

/**
 * Dip the music for a moment so a big SFX (refute, cut-in, core finding, stamp) reads
 * clearly and the sum stays under the limiter. `db` below unity, held `hold` seconds.
 */
export function duckBgm(db = -4, hold = 0.4) {
  if (!buses || buses.ctx.state !== 'running') return;
  const g = buses.bgmDuck.gain;
  const t = buses.ctx.currentTime;
  const low = Math.pow(10, db / 20);
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(Math.min(g.value, low), t + 0.03);
  g.setValueAtTime(Math.min(g.value, low), t + 0.03 + hold);
  g.linearRampToValueAtTime(1, t + 0.03 + hold + 0.35);
}
