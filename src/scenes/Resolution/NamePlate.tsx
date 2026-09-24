import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../../audio';
import { motionReduced } from '../../fx/motion';
import { rng } from '../../lib/rng';

const NOISE = Array.from('ジェーンドゥ＃０１２３４５６７８９▓▒░◆◇□■※／＼零番安置室名前記憶硝子破片');

export type NamePhase = 'codename' | 'resolving' | 'clear';

/**
 * The name plate: 「ジェーン・ドゥ #01」 glitches, decodes character by character into her
 * real name, then the kana, age and occupation are engraved underneath.
 */
export function NamePlate({
  codename,
  name,
  kana,
  meta,
  phase,
  onResolved,
  seed,
}: {
  codename: string;
  name: string;
  kana: string;
  meta: string[];
  phase: NamePhase;
  onResolved?: () => void;
  seed: string;
}) {
  const [text, setText] = useState(phase === 'clear' ? name : codename);
  const [done, setDone] = useState(phase === 'clear');
  const cb = useRef(onResolved);
  cb.current = onResolved;

  useEffect(() => {
    if (phase === 'codename') {
      setText(codename);
      setDone(false);
      return;
    }
    if (phase === 'clear') {
      setText(name);
      setDone(true);
      return;
    }
    // resolving
    if (motionReduced()) {
      setText(name);
      setDone(true);
      const t = setTimeout(() => cb.current?.(), 500);
      return () => clearTimeout(t);
    }
    const r = rng(`name:${seed}`);
    const target = Array.from(name);
    const from = Array.from(codename);
    const len = Math.max(target.length, from.length);
    const settle = Array.from({ length: len }, (_, i) => 420 + (i / Math.max(1, target.length)) * 900 + r() * 160);
    const drop = Array.from({ length: len }, () => 250 + r() * 400);
    const t0 = performance.now();
    let tick = 0;
    let finished = false;
    const iv = setInterval(() => {
      const t = performance.now() - t0;
      tick++;
      let out = '';
      let all = true;
      for (let i = 0; i < len; i++) {
        if (i < target.length) {
          if (t >= settle[i]) out += target[i];
          else {
            all = false;
            out += t < 160 && from[i] ? from[i] : NOISE[Math.floor(r() * NOISE.length)];
          }
        } else if (t < drop[i]) {
          all = false;
          out += NOISE[Math.floor(r() * NOISE.length)];
        }
      }
      setText(out);
      if (tick % 3 === 0 && !all) audio.blip('jane');
      if (all && !finished) {
        finished = true;
        clearInterval(iv);
        setDone(true);
        audio.sfx('reveal');
        setTimeout(() => cb.current?.(), 1500);
      }
    }, 45);
    return () => clearInterval(iv);
  }, [phase, name, codename]);

  const restored = phase !== 'codename';
  return (
    <div class={`nameplate ${restored ? 'is-restored' : 'is-codename'} ${done ? 'is-done' : ''}`}>
      <p class="nameplate__kicker t-mono" aria-hidden="true">
        {restored ? 'IDENTITY RESTORED' : 'UNIDENTIFIED'}
      </p>
      {restored && <p class="nameplate__was">{codename}</p>}
      <h1 class="nameplate__name" aria-live="polite">
        <span aria-hidden="true">{text}</span>
        <span class="sr-only">{done || !restored ? (restored ? name : codename) : ''}</span>
      </h1>
      <div class="nameplate__meta" aria-hidden={!done}>
        <p class="nameplate__kana">{kana}</p>
        {meta.map((m, i) => (
          <p key={i} class="nameplate__line" style={{ '--i': i }}>
            {m}
          </p>
        ))}
      </div>
    </div>
  );
}
