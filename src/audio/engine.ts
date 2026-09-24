/**
 * WebAudio engine: one AudioContext, created lazily on the first user gesture.
 *
 *   voices ─┬─► bgmBus ─┐
 *           │           ├─► master ─► compressor ─► destination
 *   sfx ────┴─► sfxBus ─┘
 *   (sends) ─► reverbIn ─► convolver ─► reverbOut ─► bgmBus / sfxBus
 */
import { signal } from '@preact/signals';

export interface Buses {
  ctx: AudioContext;
  master: GainNode;
  bgm: GainNode;
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

function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // slightly low-passed noise for a darker, "stone room" tail
      lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
      d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
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
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(ctx.destination);

    const bgm = ctx.createGain();
    const sfx = ctx.createGain();
    bgm.connect(master);
    sfx.connect(master);

    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 3.2, 2.6);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.9;
    conv.connect(verbOut);
    const bgmVerb = ctx.createGain();
    bgmVerb.connect(conv);
    verbOut.connect(bgm);

    const conv2 = ctx.createConvolver();
    conv2.buffer = makeImpulse(ctx, 1.6, 3.2);
    const sfxVerb = ctx.createGain();
    sfxVerb.connect(conv2);
    conv2.connect(sfx);

    buses = { ctx, master, bgm, sfx, bgmVerb, sfxVerb, noise: makeNoise(ctx) };
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
