/**
 * ② 死因宣告 — the player's own words. A 宣告書 (declaration sheet) with an IME-safe
 * textarea, the element checklist from the last judgement (✔ matched / ？ missing — never
 * the answer), and the result stamp. The scene runs the suspense beat and Holma's lines.
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VerdictResult } from '../../../shared/api';
import { motionReduced } from '../../fx/motion';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { SUPPORT_URL, VERDICT_MAX, type InquestSession, type VerdictView } from './session';

export const VERDICT_PROMPT = '彼女に、何が起きたのか。なぜ死んだのか。あなたの言葉で。';

/** The submit shortcut as the player's keyboard names it (none on touch). */
function isMac(): boolean {
  try {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
  } catch {
    return false;
  }
}

export function verdictPlaceholder(touch: boolean): string {
  if (touch) return '例：何が起き、体に何が起こり、なぜ亡くなったのか。直接の死因・きっかけ・仕組みまで書くと、宣告が通りやすくなります。';
  return `例：何が起き、体に何が起こり、なぜ亡くなったのか。\n（${isMac() ? '⌘' : 'Ctrl'}＋Enter で宣告）`;
}

/**
 * Optional answer elements (not needed for a full solve). The server may send the required
 * ids; until it does, the bible's situational element 「決定的な状況」 is the optional one.
 */
function isOptional(view: VerdictView, id: string): boolean {
  if (view.required?.length) return !view.required.includes(id);
  return /^決定的な状況/.test(view.labels[id] ?? '');
}

export const RESULT_META: Record<VerdictResult, { jp: string; en: string; color: string; tone: string }> = {
  correct: { jp: '正解', en: 'CORRECT', color: 'var(--formalin)', tone: 'formalin' },
  almost: { jp: 'ほぼ正解', en: 'ALMOST', color: 'var(--amber)', tone: 'amber' },
  missing: { jp: '要素不足', en: 'INCOMPLETE', color: 'var(--cyan)', tone: 'cyan' },
  wrong: { jp: '再考', en: 'RECONSIDER', color: 'var(--alarm)', tone: 'alarm' },
};

/** The judgement stamp for a verdict (same ink language as the answer stamps). */
export function ResultStamp({ result, attempt, animate, onImpact }: { result: VerdictResult; attempt: number; animate?: boolean; onImpact?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const m = RESULT_META[result];
  const len = [...m.jp].length;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !animate) return;
    const frame = el.querySelector('.stamp__frame');
    const splat = el.querySelector('.stamp__splat');
    if (motionReduced()) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 });
      onImpact?.();
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo(frame, { scale: 3.2, opacity: 0, rotation: 8 }, { scale: 0.92, opacity: 1, rotation: -7, duration: 0.22, ease: 'power4.in' })
      .add(() => onImpact?.())
      .to(frame, { scale: 1, duration: 0.34, ease: 'elastic.out(1.2, 0.5)' })
      .fromTo(splat, { scale: 0.6, opacity: 0.9 }, { scale: 1.6, opacity: 0, duration: 0.5, ease: 'power2.out' }, '<');
    return () => tl.kill();
  }, [result, attempt, animate]);
  return (
    <div
      ref={ref}
      class={`stamp stamp--lg vstamp vstamp--${result}`}
      style={{ '--stamp-color': m.color, '--stamp-tilt': '-7deg', '--jp-scale': len <= 2 ? 1 : 0.72 }}
      role="img"
      aria-label={`判定：${m.jp}`}
    >
      <span class="stamp__splat" aria-hidden="true" />
      <div class="stamp__frame" aria-hidden="true">
        <span class="stamp__kicker">死因宣告 · {String(attempt).padStart(2, '0')}</span>
        <span class="stamp__jp">{m.jp}</span>
        <span class="stamp__en">{m.en}</span>
      </div>
    </div>
  );
}

/** ✔ / ？ per answer element. Order: element id (A, B, C …). */
export function ElementChecklist({ view, animate }: { view: VerdictView; animate?: boolean }) {
  const ref = useRef<HTMLUListElement>(null);
  const ids = Object.keys(view.labels).sort();
  useLayoutEffect(() => {
    if (!animate || !ref.current || motionReduced()) return;
    const tw = gsap.fromTo(ref.current.children, { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.12, ease: 'power3.out', delay: 0.25 });
    return () => tw.kill();
  }, [view, animate]);
  return (
    <ul ref={ref} class="vchk" aria-label="宣告に含まれた要素">
      {ids.map((id) => {
        const ok = view.matched.includes(id);
        const opt = isOptional(view, id);
        return (
          <li key={id} class={`vchk__item ${ok ? 'is-ok' : 'is-miss'} ${opt ? 'is-optional' : ''}`}>
            <span class="vchk__mark" aria-hidden="true">
              {ok ? '✔' : opt ? '＋' : '？'}
            </span>
            <span class="vchk__label">{view.labels[id]}</span>
            {opt && <span class="vchk__opt">任意</span>}
            <span class="sr-only">{ok ? '：含まれている' : opt ? '：なくても宣告は通ります' : '：足りない'}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface VerdictPanelProps {
  session: InquestSession;
  onSubmit: () => void;
  onOpenEvidence: () => void;
  /** The stamp slams in when this key changes. */
  stampKey: number;
  /** Focus the sheet when writing becomes possible (off on phones: no surprise keyboard). */
  autoFocus?: boolean;
  /** Touch device: no keyboard-shortcut copy; the writing tip goes into the placeholder. */
  touch?: boolean;
  onStampImpact?: () => void;
}

export function VerdictPanel({ session: s, onSubmit, onOpenEvidence, stampKey, onStampImpact, autoFocus = true, touch = false }: VerdictPanelProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const step = s.verdictStep.value;
  const draft = s.draft.value;
  const view = s.verdict.value;
  const attempts = s.verdictAttempts.value;
  const count = [...draft].length;
  const talking = !!s.dialogue.value;
  const intro = s.verdictIntro.value;
  /** Writing is possible (not while Holma talks, the cut-in plays or the judgement runs). */
  const writable = step === 'write' && !talking && !intro && !s.tokenDead.value;
  const canSubmit = writable && draft.trim().length >= 4;
  const promptRef = useRef<HTMLParagraphElement>(null);
  /** ~1 s after the slam the stamp shrinks to a seal in the corner, so the sentence reads again. */
  const [sealed, setSealed] = useState(false);

  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el || motionReduced()) return;
    const tw = gsap.fromTo(el.querySelectorAll('.vprompt__ch'), { opacity: 0, y: 8, filter: 'blur(4px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, stagger: 0.045, ease: 'power2.out' });
    return () => tw.kill();
  }, []);

  // Never keep the caret while Holma talks: Enter must advance his line, not type a newline.
  useEffect(() => {
    if (!writable && document.activeElement === ta.current) ta.current?.blur();
  }, [writable]);

  useEffect(() => {
    if (autoFocus && writable) {
      const t = setTimeout(() => ta.current?.focus({ preventScroll: true }), 60);
      return () => clearTimeout(t);
    }
  }, [writable]);

  useEffect(() => {
    setSealed(false);
    if (step !== 'result') return;
    const t = setTimeout(() => setSealed(true), motionReduced() ? 900 : 1150);
    return () => clearTimeout(t);
  }, [stampKey, step]);

  return (
    <div class={`vpanel is-${step}`} data-verdict-step={step}>
      <header class="vpanel__head">
        <span class="vpanel__kicker">
          <Icon name="gavel" size={16} /> 死因宣告 <b>VERDICT</b>
        </span>
        <span class="vpanel__attempt t-mono">{attempts > 0 ? `宣告 ${attempts}回` : '初回の宣告'}</span>
      </header>
      <p ref={promptRef} class="vprompt" aria-label={VERDICT_PROMPT}>
        {/* per-character spans for the reveal, grouped into phrases that never break inside */}
        {(VERDICT_PROMPT.match(/[^、。]+[、。]?/g) ?? [VERDICT_PROMPT]).map((ph, pi) => (
          <span key={pi} class="vprompt__ph" aria-hidden="true">
            {[...ph].map((ch, i) => (
              <span key={i} class={`vprompt__ch ${ch === '。' ? 'is-stop' : ''}`}>
                {ch}
              </span>
            ))}
          </span>
        ))}
      </p>

      <div class="vsheet">
        <div class="vsheet__rule" aria-hidden="true">
          <span>宣告書</span>
          <span class="t-mono">No.{String(attempts + (step === 'write' ? 1 : 0)).padStart(3, '0')}</span>
        </div>
        <label class="sr-only" for="verdict-text">
          死因の宣告（{VERDICT_MAX}字まで）
        </label>
        <textarea
          id="verdict-text"
          ref={ta}
          class="vsheet__input"
          value={draft}
          maxLength={VERDICT_MAX}
          rows={5}
          readOnly={!writable}
          aria-readonly={!writable ? 'true' : undefined}
          placeholder={verdictPlaceholder(touch)}
          onInput={(e) => {
            const v = [...(e.target as HTMLTextAreaElement).value].slice(0, VERDICT_MAX).join('');
            s.setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing && canSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <div class="vsheet__foot">
          <span class={`vsheet__count t-mono ${count > VERDICT_MAX - 40 ? 'is-near' : ''}`}>
            {count}/{VERDICT_MAX}
          </span>
          <span class="vsheet__tip">直接の死因・きっかけの出来事・その仕組みまで書くと、宣告が通りやすくなります。</span>
        </div>

        {step === 'judging' && (
          <div class="vsheet__judging" role="status" aria-live="polite">
            <span class="vsheet__gavel" aria-hidden="true">
              <Icon name="gavel" size={40} />
            </span>
            <span class="vsheet__judging-t">判定中</span>
            <span class="vsheet__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        {view && step === 'result' && (
          <div class={`vsheet__stamp ${sealed ? 'is-sealed' : ''}`}>
            <ResultStamp key={stampKey} result={view.result} attempt={attempts} animate onImpact={onStampImpact} />
          </div>
        )}
      </div>

      {s.support.value && step !== 'judging' && (
        <aside class="vsupport" role="note" aria-label="相談窓口のご案内">
          <p class="vsupport__t">つらい気持ちを抱えているときは、ひとりで抱え込まずに、信頼できる人や相談窓口に話してみてください。</p>
          <a class="vsupport__a" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={14} />
            厚生労働省「まもろうよ こころ」— 電話・SNSの相談窓口
          </a>
        </aside>
      )}
      {view && step !== 'judging' && !s.support.value && (
        <div class={`vresult ${step === 'result' ? 'is-fresh' : ''}`} aria-live="polite">
          <span class="vresult__label">
            {step === 'result' ? '判定' : '前回の判定'}：<b style={{ color: RESULT_META[view.result].color }}>{RESULT_META[view.result].jp}</b>
          </span>
          <ElementChecklist key={`${stampKey}-${step}`} view={view} animate={step === 'result'} />
          {step === 'write' && view.notes.length > 0 && (
            <div class="vnote" role="note" aria-label="ホルマの指摘">
              <span class="vnote__k">
                <Icon name="whisper" size={15} />
                ホルマの指摘
              </span>
              {view.notes.map((n, i) => (
                <p key={i} class="vnote__t">
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div class="vpanel__actions">
        <Button variant="ghost" icon="notebook" onClick={onOpenEvidence} sfx="open">
          所見を見返す
        </Button>
        <Button variant="danger" size="lg" icon="gavel" en="DECLARE" disabled={!canSubmit} onClick={onSubmit} data-verdict-submit>
          宣告する
        </Button>
      </div>
    </div>
  );
}
