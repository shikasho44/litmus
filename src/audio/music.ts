/**
 * Step sequencer + BGM crossfader.
 * A single lookahead scheduler (25 ms tick, 120 ms horizon) drives every playing track.
 */
import { rng } from '../lib/rng';
import { getBuses } from './engine';
import type { Out } from './synth';
import { TRACKS, type BgmId, type Track } from './tracks';

class Player {
  readonly out: Out;
  readonly gain: GainNode;
  readonly wet: GainNode;
  private echoIn?: GainNode;
  private nodes: AudioNode[] = [];
  private nextTime: number;
  private step = 0;
  private bar = 0;
  private loop = 0;
  private rand = rng(1);
  stopped = false;
  stopAt = Infinity;

  constructor(
    readonly track: Track,
    ctx: AudioContext,
    dest: AudioNode,
    verb: AudioNode,
    noise: AudioBuffer,
    fadeIn: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.wet.connect(verb);
    const dry = ctx.createGain();
    dry.connect(this.gain);
    const wetIn = ctx.createGain();
    wetIn.connect(this.wet);
    this.nodes.push(dry, wetIn);
    if (track.echo) {
      const [time, fb] = track.echo;
      const d = ctx.createDelay(2);
      d.delayTime.value = time;
      const f = ctx.createGain();
      f.gain.value = fb;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      this.echoIn = ctx.createGain();
      this.echoIn.connect(d);
      d.connect(lp);
      lp.connect(f);
      f.connect(d);
      lp.connect(dry);
      lp.connect(wetIn);
      this.nodes.push(d, f, lp, this.echoIn);
    }
    this.out = { ctx, dry, wet: wetIn, echo: this.echoIn, noise };
    const now = ctx.currentTime;
    const target = track.gain;
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(target, now + fadeIn);
    this.wet.gain.setValueAtTime(0, now);
    this.wet.gain.linearRampToValueAtTime(target, now + fadeIn);
    this.nextTime = now + 0.08;
  }

  get s16() {
    return 60 / this.track.bpm / 4;
  }

  schedule(horizon: number) {
    if (this.stopped) return;
    while (this.nextTime < horizon && this.nextTime < this.stopAt) {
      const swing = this.step % 2 === 1 ? (this.track.swing ?? 0) * this.s16 : 0;
      try {
        this.track.step({ out: this.out, s16: this.s16, loop: this.loop, rand: this.rand }, this.bar, this.step, this.nextTime + swing);
      } catch {
        /* a bad note must never kill the scheduler */
      }
      this.nextTime += this.s16;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        if (this.bar >= this.track.bars) {
          this.bar = 0;
          this.loop++;
          this.rand = rng(this.loop + 1);
        }
      }
    }
  }

  fadeOut(seconds: number) {
    const ctx = this.out.ctx;
    const now = ctx.currentTime;
    for (const g of [this.gain, this.wet]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + seconds);
    }
    this.stopAt = now + seconds;
    setTimeout(() => this.dispose(), (seconds + 4) * 1000);
  }

  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.gain.disconnect();
      this.wet.disconnect();
      this.nodes.forEach((n) => n.disconnect());
    } catch {
      /* ignore */
    }
  }
}

let players: Player[] = [];
let current: Player | null = null;
let currentId: BgmId | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function tickAll() {
  const b = getBuses();
  if (!b) return;
  const horizon = b.ctx.currentTime + 0.12;
  players = players.filter((p) => !p.stopped);
  for (const p of players) p.schedule(horizon);
  if (!players.length && timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

function ensureTimer() {
  if (!timer) timer = setInterval(tickAll, 25);
}

export function playTrack(id: BgmId | null, fade = 1.4) {
  if (id === currentId && current && !current.stopped) return;
  const b = getBuses();
  if (!b) return;
  if (current) current.fadeOut(fade);
  current = null;
  currentId = id;
  if (!id) return;
  const track = TRACKS[id];
  if (!track) return;
  const p = new Player(track, b.ctx, b.bgm, b.bgmVerb, b.noise, Math.max(0.05, fade * 0.8));
  players.push(p);
  current = p;
  ensureTimer();
  tickAll();
}

export function currentTrack(): BgmId | null {
  return currentId;
}
