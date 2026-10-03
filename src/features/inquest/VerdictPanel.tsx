/**
 * ② 死因宣告 — in the format of the case difficulty (session.verdictMode):
 *   choice  見習い  big selectable cards; options struck out by a debate assist cannot be picked
 *   cloze   審問官  the truth sentence with inline blanks; each opens a small picker of its options
 *   free    教授    the 宣告書 (declaration sheet) with an IME-safe textarea (the original verdict)
 * Common: the assists earned in the noise break, the element checklist from the last judgement
 * (✔ matched / ？ missing — never the answer), the result stamp, and 宣告する. The scene runs
 * the suspense beat and Holma's lines.
 */
import { gsap } from 'gsap';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VerdictResult, VerdictSetupResponse } from '../../../shared/api';
import { PROTO_I005 } from '../../config/proto';
import { motionReduced } from '../../fx/motion';
import { ClosenessBand } from '../i005/ClosenessBand';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ASSIST_TEXT, DIFFICULTY_META } from '../difficulty/meta';
import { parseCloze, SUPPORT_URL, VERDICT_MAX, type InquestSession, type VerdictView } from './session';

export const VERDICT_PROMPT = '彼女に、何が起きたのか。なぜ死んだのか。あなたの言葉で。';
const CHOICE_PROMPT = '彼女は、なぜ死んだのか。';
const CLOZE_PROMPT = '空欄を埋めて、彼女の死を宣告せよ。';

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

/** ✔ / ？ per answer element (or per cloze blank). Order: `order` when given, else element id (A, B, C …). */
export function ElementChecklist({ view, animate, order }: { view: VerdictView; animate?: boolean; order?: string[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const keys = Object.keys(view.labels);
  const ids = order?.length ? [...order.filter((id) => keys.includes(id)), ...keys.filter((id) => !order.includes(id)).sort()] : keys.sort();
  useLayoutEffect(() => {
    if (!animate || !ref.current || motionReduced()) return;
    const tw = gsap.fromTo(ref.current.children, { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.12, ease: 'power3.out', delay: 0.25 });
    return () => tw.kill();
  }, [view, animate]);
  if (!ids.length) return null;
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

/* ------------------------------------------------------------------ */
/* Assists earned in the noise break                                   */
/* ------------------------------------------------------------------ */
export function AssistNote({ session: s }: { session: InquestSession }) {
  const a = s.assists.value;
  const mode = s.verdictMode.value;
  const st = s.setup.value;
  if (!a || a.total <= 0) return null;
  const revealed = mode === 'free' && st?.free ? st.free.revealed.map((id) => st.free!.labels[id]).filter(Boolean) : [];
  return (
    <div class={`vassist ${a.earned > 0 ? 'has-assist' : ''}`} role="note" data-assists={a.earned}>
      <span class="vassist__k">
        <Icon name="shard" size={15} />
        反証の手がかり
        <b class="t-mono">
          {a.earned}/{a.total}
        </b>
      </span>
      <p class="vassist__t">
        {a.earned > 0
          ? mode === 'choice'
            ? `正した記憶のおかげで、選択肢が${a.earned}つ消えています。`
            : mode === 'cloze'
              ? `正した記憶のおかげで、空欄が${a.earned}つ埋まっています。`
              : '正した記憶が、宣告に欠かせない要素を教えてくれます。'
          : s.debateSkipped.value
            ? `反証を飛ばしたので、手がかりはありません（反応を出せば、1ラウンドごとに${ASSIST_TEXT[mode].replace('死因宣告で', '')}）。`
            : '手がかりは、まだありません。'}
      </p>
      {revealed.length > 0 && (
        <ul class="vassist__els" aria-label="明かされた要素">
          {revealed.map((l) => (
            <li key={l}>
              <Icon name="check" size={13} />
              {l}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* choice — 見習い                                                      */
/* ------------------------------------------------------------------ */
function ChoiceBoard({ session: s, setup, writable }: { session: InquestSession; setup: NonNullable<VerdictSetupResponse['choice']>; writable: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const picked = s.choice.value;
  const tried = s.triedChoices.value;
  const options = setup.options;
  const usable = options.filter((o) => !o.removed && !tried.includes(o.id));
  const focusId = picked && usable.some((o) => o.id === picked) ? picked : usable[0]?.id;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || motionReduced()) return;
    const tw = gsap.fromTo(el.querySelectorAll('.vopt'), { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, stagger: 0.06, ease: 'power3.out' });
    return () => tw.kill();
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = usable.findIndex((o) => o.id === (document.activeElement as HTMLElement | null)?.dataset.optionId);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? usable.length - 1 : (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + usable.length) % usable.length;
    const next = usable[n];
    if (!next) return;
    s.pickChoice(next.id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-option-id="${next.id}"]`)?.focus());
  };

  return (
    <div ref={ref} class="vchoice" role="radiogroup" aria-label="死因の選択肢" onKeyDown={onKey}>
      {options.map((o, i) => {
        const removed = o.removed;
        const wrong = tried.includes(o.id);
        const off = removed || wrong;
        const on = picked === o.id && !off;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={off || !writable ? 'true' : undefined}
            tabIndex={o.id === focusId ? 0 : -1}
            class={`vopt ${on ? 'is-on' : ''} ${removed ? 'is-removed' : ''} ${wrong ? 'is-wrong' : ''}`}
            data-option-id={o.id}
            onClick={() => !off && writable && s.pickChoice(o.id)}
          >
            <span class="vopt__n t-mono" aria-hidden="true">
              {String.fromCharCode(65 + i)}
            </span>
            <span class="vopt__t">{o.text}</span>
            {removed && (
              <span class="vopt__tag">
                <Icon name="shard" size={13} />
                手がかりで除外
              </span>
            )}
            {wrong && !removed && (
              <span class="vopt__tag vopt__tag--wrong">
                <Icon name="cross" size={13} />
                宣告済み・違った
              </span>
            )}
            <span class="vopt__mark" aria-hidden="true">
              {on ? '✔' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* cloze — 審問官                                                       */
/* ------------------------------------------------------------------ */
type ClozeBlank = NonNullable<VerdictSetupResponse['cloze']>['blanks'][number];

function BlankPicker({ blank, value, onPick, onClose, id }: { blank: ClozeBlank; value?: number; onPick: (i: number) => void; onClose: () => void; id: string }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>(`[data-index="${value ?? 0}"]`) ?? ref.current?.querySelector<HTMLElement>('[data-index]');
      el?.focus({ preventScroll: true });
    }, 20);
    return () => clearTimeout(t);
  }, []);
  const onKey = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[data-index]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      onClose();
    }
  };
  return (
    <ul ref={ref} id={id} class="vpick" role="listbox" aria-label={`${blank.label}を選ぶ`} onKeyDown={onKey}>
      {blank.options.map((opt, i) => (
        <li key={i} role="none">
          <button type="button" role="option" aria-selected={value === i} class={`vpick__opt ${value === i ? 'is-on' : ''}`} data-index={i} onClick={() => onPick(i)}>
            <span class="vpick__n t-mono" aria-hidden="true">
              {i + 1}
            </span>
            {opt}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ClozeSheet({ session: s, setup, writable, narrow }: { session: InquestSession; setup: NonNullable<VerdictSetupResponse['cloze']>; writable: boolean; narrow: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const picks = s.clozePicks.value;
  const parts = parseCloze(setup.template);
  const wrap = useRef<HTMLDivElement>(null);
  const blankOf = (id: string) => setup.blanks.find((b) => b.id === id);

  useEffect(() => {
    if (!writable) setOpen(null);
  }, [writable]);

  // click outside closes the popover (PC)
  useEffect(() => {
    if (!open || narrow) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.vpick, .vblank')) setOpen(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, narrow]);

  const focusSlot = (id: string) => requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>(`[data-blank-id="${id}"]`)?.focus({ preventScroll: true }));
  const pick = (id: string, i: number) => {
    s.pickBlank(id, i);
    setOpen(null);
    // on to the next empty blank (keyboard / tap flow), else back on this slot
    const next = setup.blanks.find((b) => b.id !== id && typeof (s.clozePicks.peek()[b.id]) !== 'number' && typeof b.filled !== 'number');
    if (next && !narrow) {
      focusSlot(next.id);
      setTimeout(() => setOpen(next.id), 120);
    } else if (next && narrow) setTimeout(() => setOpen(next.id), 260);
    else if (!narrow) focusSlot(id);
    else requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-verdict-submit]')?.focus({ preventScroll: true }));
  };

  const openBlank = open ? blankOf(open) : undefined;
  return (
    <div ref={wrap} class="vcloze">
      <p class="vcloze__text">
        {parts.map((p, k) => {
          if ('text' in p) return <span key={k}>{p.text}</span>;
          const b = blankOf(p.blank);
          if (!b) return <span key={k}>＿＿</span>;
          const v = picks[b.id];
          const locked = typeof b.filled === 'number';
          const filled = typeof v === 'number';
          const isOpen = open === b.id && !narrow;
          const listId = `vpick-${b.id}`;
          return (
            <span key={k} class="vblank-wrap">
              <button
                type="button"
                class={`vblank ${filled ? 'is-filled' : ''} ${locked ? 'is-locked' : ''} ${open === b.id ? 'is-open' : ''}`}
                data-blank-id={b.id}
                aria-haspopup="listbox"
                aria-expanded={open === b.id}
                aria-controls={isOpen ? listId : undefined}
                aria-disabled={locked || !writable ? 'true' : undefined}
                aria-label={`${b.label}：${filled ? b.options[v] : '未選択'}${locked ? '（手がかりで確定）' : ''}`}
                onClick={() => {
                  if (locked || !writable) return;
                  setOpen(open === b.id ? null : b.id);
                }}
              >
                {locked && <Icon name="lock" size={13} />}
                <span class="vblank__t">{filled ? b.options[v] : b.label}</span>
                {!locked && <Icon name="chevronDown" size={14} />}
              </button>
              {isOpen && (
                <BlankPicker
                  id={listId}
                  blank={b}
                  value={v}
                  onPick={(i) => pick(b.id, i)}
                  onClose={() => {
                    setOpen(null);
                    focusSlot(b.id);
                  }}
                />
              )}
            </span>
          );
        })}
      </p>
      {narrow && (
        <BottomSheet open={!!openBlank} onClose={() => setOpen(null)} title={openBlank?.label ?? ''} en="FILL THE BLANK" side="bottom">
          {openBlank && <BlankPicker key={openBlank.id} id={`vpick-${openBlank.id}`} blank={openBlank} value={picks[openBlank.id]} onPick={(i) => pick(openBlank.id, i)} onClose={() => setOpen(null)} />}
        </BottomSheet>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* panel                                                               */
/* ------------------------------------------------------------------ */
export interface VerdictPanelProps {
  session: InquestSession;
  onSubmit: () => void;
  onOpenEvidence: () => void;
  /** Back to the noise break (only offered while rounds are open). */
  onBackToDebate?: () => void;
  /** The stamp slams in when this key changes. */
  stampKey: number;
  /** Focus the sheet when writing becomes possible (off on phones: no surprise keyboard). */
  autoFocus?: boolean;
  /** Touch device: no keyboard-shortcut copy; the writing tip goes into the placeholder. */
  touch?: boolean;
  narrow?: boolean;
  onStampImpact?: () => void;
}

export function VerdictPanel({ session: s, onSubmit, onOpenEvidence, onBackToDebate, stampKey, onStampImpact, autoFocus = true, touch = false, narrow = false }: VerdictPanelProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const step = s.verdictStep.value;
  const draft = s.draft.value;
  const view = s.verdict.value;
  const attempts = s.verdictAttempts.value;
  const count = [...draft].length;
  const talking = !!s.dialogue.value;
  const intro = s.verdictIntro.value;
  const mode = s.verdictMode.value;
  const setup = s.setup.value;
  const setupState = s.setupState.value;
  const lives = s.lives.value;
  const diff = DIFFICULTY_META[s.difficulty.value];
  /** Writing is possible (not while Holma talks, the cut-in plays or the judgement runs). */
  const writable = step === 'write' && !talking && !intro && !s.tokenDead.value;
  const canSubmit = writable && s.verdictReady.value;
  const promptRef = useRef<HTMLParagraphElement>(null);
  /** ~1 s after the slam the stamp shrinks to a seal in the corner, so the sentence reads again. */
  const [sealed, setSealed] = useState(false);
  const prompt =
    mode === 'choice' ? setup?.choice?.prompt || CHOICE_PROMPT : mode === 'cloze' ? setup?.cloze?.prompt || CLOZE_PROMPT : VERDICT_PROMPT;
  const loading = mode !== 'free' && setupState !== 'ready';

  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el || motionReduced()) return;
    const tw = gsap.fromTo(el.querySelectorAll('.vprompt__ch'), { opacity: 0, y: 8, filter: 'blur(4px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, stagger: 0.045, ease: 'power2.out' });
    return () => tw.kill();
  }, [prompt]);

  // Never keep the caret while Holma talks: Enter must advance his line, not type a newline.
  useEffect(() => {
    if (!writable && document.activeElement === ta.current) ta.current?.blur();
  }, [writable]);

  useEffect(() => {
    if (autoFocus && writable && mode === 'free') {
      const t = setTimeout(() => ta.current?.focus({ preventScroll: true }), 60);
      return () => clearTimeout(t);
    }
  }, [writable, mode]);

  useEffect(() => {
    setSealed(false);
    if (step !== 'result') return;
    const t = setTimeout(() => setSealed(true), motionReduced() ? 900 : 1150);
    return () => clearTimeout(t);
  }, [stampKey, step]);

  const overlay: ComponentChildren = (
    <>
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
    </>
  );

  let body: ComponentChildren;
  if (loading) {
    body = (
      <div class="vsheet vsheet--loading" aria-busy={setupState === 'loading'}>
        {setupState === 'error' ? (
          <div class="vload" role="alert">
            <p>宣告の書式を読み込めませんでした。通信を確かめて、もう一度お試しください。</p>
            <Button size="sm" icon="refresh" onClick={() => void s.loadSetup()}>
              もう一度
            </Button>
          </div>
        ) : (
          <p class="vload t-mono">
            LOADING<span class="vload__dots">…</span>
          </p>
        )}
      </div>
    );
  } else if (mode === 'choice' && setup?.choice) {
    body = (
      <div class="vbody vbody--choice">
        <ChoiceBoard session={s} setup={setup.choice} writable={writable} />
        {overlay}
      </div>
    );
  } else if (mode === 'cloze' && setup?.cloze) {
    body = (
      <div class="vsheet vsheet--cloze">
        <div class="vsheet__rule" aria-hidden="true">
          <span>宣告書</span>
          <span class="t-mono">No.{String(attempts + (step === 'write' ? 1 : 0)).padStart(3, '0')}</span>
        </div>
        <ClozeSheet session={s} setup={setup.cloze} writable={writable} narrow={narrow} />
        <div class="vsheet__foot">
          <span class="vsheet__tip">{touch ? '空欄をタップして、言葉を選びます。' : '空欄を押して（Enter）、言葉を選びます。↑↓ で選び、Enter で決定。'}</span>
        </div>
        {overlay}
      </div>
    );
  } else {
    body = (
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
        {overlay}
      </div>
    );
  }

  const fellBack = s.difficulty.value !== 'hard' && mode === 'free' && setup && !setup.available;
  const canGoBack = !!onBackToDebate && s.openRounds.value.length > 0 && step === 'write';

  return (
    <div class={`vpanel vpanel--${mode} is-${step}`} data-verdict-step={step} data-verdict-mode={mode} data-writable={writable && !loading ? 'on' : 'off'}>
      <header class="vpanel__head">
        <span class="vpanel__kicker">
          <Icon name="gavel" size={16} /> 死因宣告 <b>VERDICT</b>
        </span>
        <span class="vpanel__meta">
          <span class="vpanel__mode">
            {diff.jp}・{mode === 'choice' ? '選択式' : mode === 'cloze' ? '穴埋め式' : '自由記述'}
          </span>
          <span class="vpanel__attempt t-mono">{attempts > 0 ? `宣告 ${attempts}回` : '初回の宣告'}</span>
        </span>
      </header>
      <p ref={promptRef} class="vprompt" aria-label={prompt} key={prompt}>
        {/* per-character spans for the reveal, grouped into phrases that never break inside */}
        {(prompt.match(/[^、。？]+[、。？]?/g) ?? [prompt]).map((ph, pi) => (
          <span key={pi} class="vprompt__ph" aria-hidden="true">
            {[...ph].map((ch, i) => (
              <span key={i} class={`vprompt__ch ${ch === '。' || ch === '？' ? 'is-stop' : ''}`}>
                {ch}
              </span>
            ))}
          </span>
        ))}
      </p>
      {fellBack && <p class="vfallback">この事件の宣告は、自由記述で行います。</p>}

      <AssistNote session={s} />

      <div class="vpanel__body">{body}</div>

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
          {/* choice: the elements say nothing about a picked option — the stamp and Holma's note do */}
          {mode !== 'choice' && <ElementChecklist key={`${stampKey}-${step}`} view={view} animate={step === 'result'} order={mode === 'cloze' ? setup?.cloze?.blanks.map((b) => b.id) : undefined} />}
          {/* PROTOTYPE I-005: the red-cabbage 近い・遠い band (?proto=i005) */}
          {PROTO_I005 && view.closeness && <ClosenessBand key={`cb-${stampKey}-${step}`} closeness={view.closeness} animate={step === 'result'} />}
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
        <span class="vpanel__left">
          <Button variant="ghost" icon="notebook" onClick={onOpenEvidence} sfx="open">
            所見を見返す
          </Button>
          {canGoBack && (
            <Button variant="quiet" icon="shard" onClick={onBackToDebate} sfx="page" data-back-debate>
              反証に戻る
            </Button>
          )}
        </span>
        <span class="vpanel__submit">
          <span class={`vpanel__lives t-mono ${lives <= 1 ? 'is-low' : ''}`} aria-hidden="true">
            やり直し 残り{lives}
          </span>
          <Button variant="danger" size="lg" icon="gavel" en="DECLARE" disabled={!canSubmit} onClick={onSubmit} data-verdict-submit>
            宣告する
          </Button>
        </span>
      </div>
    </div>
  );
}
