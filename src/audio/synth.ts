/**
 * Synth voices. Every voice is fire-and-forget: it creates nodes, schedules envelopes at
 * `t` (AudioContext time) and lets them be garbage-collected after stop().
 *
 * `out.dry` is the direct path, `out.wet` a reverb send, `out.echo` an optional delay send.
 */
export interface Out {
  ctx: AudioContext;
  dry: AudioNode;
  wet: AudioNode;
  echo?: AudioNode;
  noise: AudioBuffer;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const EPS = 0.0001;

function gainNode(ctx: AudioContext, v = 0) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function route(out: Out, node: AudioNode, wet = 0.2, echo = 0) {
  node.connect(out.dry);
  if (wet > 0) {
    const s = gainNode(out.ctx, wet);
    node.connect(s);
    s.connect(out.wet);
  }
  if (echo > 0 && out.echo) {
    const e = gainNode(out.ctx, echo);
    node.connect(e);
    e.connect(out.echo);
  }
}

function noiseSrc(out: Out, t: number, dur: number) {
  const src = out.ctx.createBufferSource();
  src.buffer = out.noise;
  src.loop = true;
  src.loopStart = Math.random();
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
  return src;
}

/* ------------------------------------------------------------------ */
/* Tonal voices                                                        */
/* ------------------------------------------------------------------ */

/** Inharmonic bell / music box. */
export function bell(
  out: Out,
  t: number,
  midi: number,
  o: { vel?: number; decay?: number; wet?: number; echo?: number; partials?: [number, number, number][]; detune?: number } = {},
) {
  const { ctx } = out;
  const vel = o.vel ?? 0.4;
  const decay = o.decay ?? 1.8;
  const f = mtof(midi) * Math.pow(2, (o.detune ?? 0) / 1200);
  const partials = o.partials ?? [
    [1, 1, 1],
    [3.0, 0.22, 0.45],
    [5.43, 0.08, 0.25],
  ];
  const bus = gainNode(ctx, 1);
  route(out, bus, o.wet ?? 0.35, o.echo ?? 0);
  for (const [ratio, amp, dk] of partials) {
    const freq = f * ratio;
    if (freq > 16000) continue;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(EPS, t + decay * dk);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + decay * dk + 0.05);
  }
}

export const MUSIC_BOX: [number, number, number][] = [
  [1, 1, 1],
  [4.0, 0.18, 0.35],
  [6.27, 0.07, 0.2],
];
export const GLOCK: [number, number, number][] = [
  [1, 1, 1],
  [2.76, 0.4, 0.5],
  [5.4, 0.16, 0.3],
  [8.93, 0.06, 0.18],
];

/** Vibraphone: pure tone + 4th partial, motor tremolo. */
export function vibes(out: Out, t: number, midi: number, o: { vel?: number; decay?: number; wet?: number; echo?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.25;
  const decay = o.decay ?? 2.4;
  const f = mtof(midi);
  const bus = gainNode(ctx, 1);
  const trem = ctx.createOscillator();
  trem.frequency.value = 5.2;
  const tremDepth = gainNode(ctx, 0.28);
  trem.connect(tremDepth);
  tremDepth.connect(bus.gain);
  trem.start(t);
  trem.stop(t + decay + 0.1);
  route(out, bus, o.wet ?? 0.4, o.echo ?? 0);
  const parts: [number, number, number][] = [
    [1, 1, 1],
    [4, 0.2, 0.25],
    [10.1, 0.04, 0.08],
  ];
  for (const [r, a, d] of parts) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * r;
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * a, t + 0.006);
    g.gain.exponentialRampToValueAtTime(EPS, t + decay * d);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + decay * d + 0.05);
  }
}

/** Plucked synth (square/saw through a closing low-pass). */
export function pluck(
  out: Out,
  t: number,
  midi: number,
  o: { vel?: number; decay?: number; type?: OscillatorType; cutoff?: number; wet?: number; echo?: number; q?: number } = {},
) {
  const { ctx } = out;
  const vel = o.vel ?? 0.2;
  const decay = o.decay ?? 0.35;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'square';
  osc.frequency.value = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = o.q ?? 3;
  const c = o.cutoff ?? 3200;
  lp.frequency.setValueAtTime(c, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, c * 0.12), t + decay);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.003);
  g.gain.exponentialRampToValueAtTime(EPS, t + decay);
  osc.connect(lp);
  lp.connect(g);
  route(out, g, o.wet ?? 0.15, o.echo ?? 0);
  osc.start(t);
  osc.stop(t + decay + 0.05);
}

/** Pizzicato upright-ish bass. */
export function pizz(out: Out, t: number, midi: number, o: { vel?: number; decay?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.5;
  const decay = o.decay ?? 0.42;
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(260, t + decay);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(EPS, t + decay);
  for (const [type, mul, amp] of [
    ['triangle', 1, 1],
    ['sine', 0.5, 0.6],
    ['sawtooth', 1, 0.12],
  ] as [OscillatorType, number, number][]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f * mul * 1.01, t);
    osc.frequency.exponentialRampToValueAtTime(f * mul, t + 0.03);
    const a = gainNode(ctx, amp);
    osc.connect(a);
    a.connect(lp);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
  lp.connect(g);
  route(out, g, 0.08);
}

/** Gated saw bass with filter envelope. */
export function sawBass(out: Out, t: number, midi: number, dur: number, o: { vel?: number; cutoff?: number; env?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.35;
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 6;
  const c = o.cutoff ?? 900;
  lp.frequency.setValueAtTime(c * (o.env ?? 2.4), t);
  lp.frequency.exponentialRampToValueAtTime(c, t + Math.min(0.12, dur));
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.setValueAtTime(vel, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  for (const det of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = det;
    osc.connect(lp);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f / 2;
  const sg = gainNode(ctx, 0.7);
  sub.connect(sg);
  sg.connect(g);
  sub.start(t);
  sub.stop(t + dur + 0.05);
  lp.connect(g);
  route(out, g, 0.03);
}

/** Warm pad chord. */
export function pad(
  out: Out,
  t: number,
  midis: number[],
  dur: number,
  o: { vel?: number; attack?: number; release?: number; cutoff?: number; wet?: number; type?: OscillatorType } = {},
) {
  const { ctx } = out;
  const vel = (o.vel ?? 0.12) / Math.sqrt(Math.max(1, midis.length));
  const attack = o.attack ?? 0.9;
  const release = o.release ?? 1.6;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  const c = o.cutoff ?? 1500;
  lp.frequency.setValueAtTime(c * 0.6, t);
  lp.frequency.linearRampToValueAtTime(c, t + attack + 0.2);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.setValueAtTime(vel, t + Math.max(attack, dur));
  g.gain.linearRampToValueAtTime(0, t + Math.max(attack, dur) + release);
  const end = t + Math.max(attack, dur) + release + 0.05;
  for (const m of midis) {
    for (const det of [-9, 9]) {
      const osc = ctx.createOscillator();
      osc.type = o.type ?? 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = det + (Math.random() * 4 - 2);
      osc.connect(lp);
      osc.start(t);
      osc.stop(end);
    }
  }
  lp.connect(g);
  route(out, g, o.wet ?? 0.6);
}

/** Soft felt-piano. */
export function piano(out: Out, t: number, midi: number, o: { vel?: number; decay?: number; wet?: number; echo?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.3;
  const decay = o.decay ?? 2.6;
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(Math.min(9000, f * 8), t);
  lp.frequency.exponentialRampToValueAtTime(Math.min(3000, f * 2.2), t + decay * 0.6);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.008);
  g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.35);
  g.gain.exponentialRampToValueAtTime(EPS, t + decay);
  for (const [type, mul, amp, det] of [
    ['triangle', 1, 1, 0],
    ['sine', 2, 0.35, 3],
    ['sine', 1, 0.5, -4],
    ['sine', 3, 0.08, 0],
  ] as [OscillatorType, number, number, number][]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * mul;
    osc.detune.value = det;
    const a = gainNode(ctx, amp);
    osc.connect(a);
    a.connect(lp);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
  lp.connect(g);
  route(out, g, o.wet ?? 0.45, o.echo ?? 0);
}

/** Short synth chord stab. */
export function stab(out: Out, t: number, midis: number[], o: { vel?: number; decay?: number; cutoff?: number } = {}) {
  const { ctx } = out;
  const vel = (o.vel ?? 0.22) / Math.sqrt(midis.length);
  const decay = o.decay ?? 0.22;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 4;
  const c = o.cutoff ?? 3600;
  lp.frequency.setValueAtTime(c, t);
  lp.frequency.exponentialRampToValueAtTime(420, t + decay);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.003);
  g.gain.exponentialRampToValueAtTime(EPS, t + decay);
  for (const m of midis) {
    for (const det of [-12, 12]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = det;
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
  }
  lp.connect(g);
  route(out, g, 0.25);
}

/** Sine sub / drone. */
export function sub(out: Out, t: number, midi: number, dur: number, o: { vel?: number; attack?: number; release?: number; type?: OscillatorType } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.2;
  const attack = o.attack ?? 0.4;
  const release = o.release ?? 0.8;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.value = mtof(midi);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.setValueAtTime(vel, t + Math.max(attack, dur));
  g.gain.linearRampToValueAtTime(0, t + Math.max(attack, dur) + release);
  osc.connect(g);
  route(out, g, 0.05);
  osc.start(t);
  osc.stop(t + Math.max(attack, dur) + release + 0.05);
}

/* ------------------------------------------------------------------ */
/* Percussion                                                          */
/* ------------------------------------------------------------------ */
export function kick(out: Out, t: number, o: { vel?: number; tone?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.9;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const top = o.tone ?? 150;
  osc.frequency.setValueAtTime(top, t);
  osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + 0.42);
  osc.connect(g);
  route(out, g, 0);
  osc.start(t);
  osc.stop(t + 0.45);
  // click
  const n = noiseSrc(out, t, 0.01);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.25, t);
  ng.gain.exponentialRampToValueAtTime(EPS, t + 0.012);
  n.connect(hp);
  hp.connect(ng);
  route(out, ng, 0);
}

export function snare(out: Out, t: number, o: { vel?: number; tone?: number; decay?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.5;
  const decay = o.decay ?? 0.18;
  const n = noiseSrc(out, t, decay);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 0.7;
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + decay);
  n.connect(bp);
  bp.connect(g);
  route(out, g, 0.18);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(o.tone ?? 210, t);
  osc.frequency.exponentialRampToValueAtTime((o.tone ?? 210) * 0.7, t + 0.08);
  const og = gainNode(ctx, 0);
  og.gain.setValueAtTime(vel * 0.7, t);
  og.gain.exponentialRampToValueAtTime(EPS, t + 0.09);
  osc.connect(og);
  route(out, og, 0.05);
  osc.start(t);
  osc.stop(t + 0.1);
}

export function clap(out: Out, t: number, o: { vel?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.45;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1300;
  bp.Q.value = 1.1;
  const g = gainNode(ctx, 0);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.011;
    g.gain.setValueAtTime(vel, tt);
    g.gain.exponentialRampToValueAtTime(vel * 0.2, tt + 0.01);
  }
  g.gain.setValueAtTime(vel * 0.8, t + 0.034);
  g.gain.exponentialRampToValueAtTime(EPS, t + 0.22);
  const n = noiseSrc(out, t, 0.24);
  n.connect(bp);
  bp.connect(g);
  route(out, g, 0.3);
}

export function hat(out: Out, t: number, o: { vel?: number; open?: boolean } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.2;
  const decay = o.open ? 0.22 : 0.04;
  const n = noiseSrc(out, t, decay);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7200;
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + decay);
  n.connect(hp);
  hp.connect(g);
  route(out, g, 0.05);
}

/** Clock tick / woodblock. */
export function tick(out: Out, t: number, o: { vel?: number; pitch?: number } = {}) {
  const { ctx } = out;
  const vel = o.vel ?? 0.15;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = o.pitch ?? 2200;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = o.pitch ?? 2200;
  bp.Q.value = 8;
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + 0.028);
  osc.connect(bp);
  bp.connect(g);
  route(out, g, 0.2);
  osc.start(t);
  osc.stop(t + 0.04);
}

/** Filtered-noise sweep (risers, whooshes). */
export function sweep(
  out: Out,
  t: number,
  dur: number,
  o: { vel?: number; from?: number; to?: number; q?: number; shape?: 'rise' | 'swell' | 'fall'; wet?: number } = {},
) {
  const { ctx } = out;
  const vel = o.vel ?? 0.2;
  const n = noiseSrc(out, t, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = o.q ?? 1.4;
  bp.frequency.setValueAtTime(o.from ?? 400, t);
  bp.frequency.exponentialRampToValueAtTime(o.to ?? 6000, t + dur);
  const g = gainNode(ctx, 0);
  const shape = o.shape ?? 'rise';
  if (shape === 'rise') {
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vel, t + dur * 0.95);
    g.gain.linearRampToValueAtTime(0, t + dur);
  } else if (shape === 'swell') {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  } else {
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  }
  n.connect(bp);
  bp.connect(g);
  route(out, g, o.wet ?? 0.2);
}
