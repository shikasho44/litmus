/**
 * Audio API (the only module scenes should import from src/audio).
 *
 *   audio.bgm('investigation')   crossfade to a track ('none' / null stops)
 *   audio.sfx('stamp', { answerClass: 'yes' })
 *   audio.blip('holma')          typewriter voice
 *   audio.unlock()               call from a user gesture (App does this globally)
 *
 * Settings (volumes, mute, voice blips) are applied live by `bindAudioSettings()`.
 * Requests made before the first gesture are remembered and played on unlock.
 */
import { effect } from '@preact/signals';
import { settings } from '../state/save';
import { audioUnlocked, peekBuses, rampGain, unlockAudio } from './engine';
import { currentTrack, playTrack } from './music';
import { playBlip, playSfx, type SfxName, type Speaker } from './sfx';
import type { BgmId } from './tracks';
import type { AnswerClass } from '../../shared/case-schema';

export type { BgmId, SfxName, Speaker };

let wantedBgm: BgmId | null = null;
let blipsOn = true;

function curve(v: number) {
  return Math.pow(Math.min(1, Math.max(0, v)), 1.6);
}

export const audio = {
  get unlocked() {
    return audioUnlocked.value;
  },
  async unlock() {
    const ok = await unlockAudio();
    if (ok) {
      applySettings();
      if (wantedBgm && currentTrack() !== wantedBgm) playTrack(wantedBgm);
    }
    return ok;
  },
  bgm(id: BgmId | 'none' | null, fade = 1.4) {
    wantedBgm = id === 'none' ? null : id;
    if (!audioUnlocked.peek()) return;
    playTrack(wantedBgm, fade);
  },
  get currentBgm(): BgmId | null {
    return wantedBgm;
  },
  sfx(name: SfxName, opts?: { answerClass?: AnswerClass }) {
    if (!audioUnlocked.peek()) return;
    playSfx(name, opts);
  },
  blip(speaker: Speaker) {
    if (!audioUnlocked.peek() || !blipsOn) return;
    playBlip(speaker);
  },
};

/** Sync bus gains with the settings. Never creates the AudioContext (that waits for a gesture). */
function applySettings() {
  const b = peekBuses();
  const s = settings.peek();
  blipsOn = s.voiceBlips;
  if (!b) return;
  rampGain(b.master, s.muted ? 0 : 0.9, 0.12);
  rampGain(b.bgm, curve(s.bgmVolume) * 0.85, 0.15);
  rampGain(b.sfx, curve(s.sfxVolume), 0.08);
}

let bound = false;
/** Keep bus gains in sync with settings; unlock on the first gesture; pause when hidden. */
export function bindAudioSettings() {
  if (bound) return;
  bound = true;
  effect(() => {
    void settings.value;
    applySettings();
  });
  const unlockOnce = () => {
    void audio.unlock().then((ok) => {
      if (ok) {
        window.removeEventListener('pointerdown', unlockOnce, true);
        window.removeEventListener('keydown', unlockOnce, true);
        window.removeEventListener('touchend', unlockOnce, true);
      }
    });
  };
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);
  window.addEventListener('touchend', unlockOnce, true);
  document.addEventListener('visibilitychange', () => {
    const b = peekBuses();
    if (!b || !audioUnlocked.peek()) return;
    if (document.visibilityState === 'hidden') void b.ctx.suspend().catch(() => {});
    else void b.ctx.resume().catch(() => {});
  });
}
