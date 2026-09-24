/**
 * 記憶の定着 RECALL TEST (design bible §3-5). One question at a time, 3–4 choices, immediate
 * feedback with the explanation. A wrong pick greys that choice out and shows the
 * explanation; the player simply tries again (the retry count is kept, nothing else).
 * All correct → a giant 「RECORD SEALED」 stamp; the run is ranked and saved (completeCase)
 * right there, then 結果へ.
 *
 * Save: CaseProgress.quiz = { answers: { [questionIndex]: wrongAttempts }, correct: [questionIndex…] }
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CaseSummary, SolutionResponse } from '../../../shared/api';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { buildCaseResult } from '../../features/rank';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { pickLine, type ResolvedLine } from '../../lib/lines';
import { completeCase, getCaseProgress, updateCase } from '../../state/save';
import { Button, IconButton } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import { EndingError, EndingLoading } from '../Resolution/common';
import { advanceStage, caseNumber, pad2, useSolution } from '../Resolution/solution';
import './quiz.css';

export function QuizScene({ params }: SceneProps) {
  const caseId = params.caseId!;
  const [state, retry] = useSolution(caseId);
  useEffect(() => {
    if (state.status === 'ok') advanceStage(caseId, 'quiz');
  }, [state.status, caseId]);
  if (state.status === 'loading') return <EndingLoading label="問題を用意しています" />;
  if (state.status === 'error') return <EndingError caseId={caseId} reason={state.reason} onRetry={retry} />;
  return <Quiz caseId={caseId} sol={state.sol} summary={state.summary} />;
}

const LETTERS = ['A', 'B', 'C', 'D'];

function readQuiz(caseId: string) {
  const q = getCaseProgress(caseId)?.quiz;
  return { answers: { ...(q?.answers ?? {}) }, correct: [...(q?.correct ?? [])] };
}

/** Record the run as complete (once per run) and return the stored result. */
function finishRun(caseId: string, summary: CaseSummary | null) {
  const p = getCaseProgress(caseId);
  if (p?.stage === 'complete' && p.lastResult) return p.lastResult;
  const { result } = buildCaseResult(p, { difficulty: summary?.difficulty ?? 2, estimatedMinutes: summary?.estimatedMinutes });
  completeCase(caseId, result);
  return result;
}

function Quiz({ caseId, sol, summary }: { caseId: string; sol: SolutionResponse; summary: CaseSummary | null }) {
  const quiz = sol.quiz;
  const initial = useMemo(() => readQuiz(caseId), [caseId]);
  const [correct, setCorrect] = useState<string[]>(initial.correct.filter((k) => Number(k) < quiz.length));
  const [misses, setMisses] = useState<Record<string, number>>(initial.answers);
  const firstOpen = quiz.findIndex((_, i) => !initial.correct.includes(String(i)));
  const [idx, setIdx] = useState(firstOpen < 0 ? quiz.length - 1 : firstOpen);
  const [wrongPicks, setWrongPicks] = useState<number[]>([]);
  const [solvedPick, setSolvedPick] = useState<number | null>(firstOpen < 0 ? quiz[quiz.length - 1]?.answer ?? null : null);
  const [line, setLine] = useState<ResolvedLine>(() => pickLine('science.outro'));
  const [complete, setComplete] = useState(firstOpen < 0);
  const [stampKey, setStampKey] = useState(firstOpen < 0 ? 0 : -1);
  const cardRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const q = quiz[idx];
  const key = String(idx);
  const done = correct.includes(key);
  const totalMisses = Object.values(misses).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const num = caseNumber(caseId, summary);

  // persist
  useEffect(() => {
    updateCase(caseId, (c) => ({ ...c, quiz: { answers: misses, correct } }));
  }, [misses, correct]);

  // new question entrance
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || motionReduced()) return;
    gsap.fromTo(el, { opacity: 0, x: 26 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' });
  }, [idx]);

  const pick = (i: number) => {
    if (done || wrongPicks.includes(i) || complete) return;
    if (i === q.answer) {
      audio.sfx('finding');
      setSolvedPick(i);
      setCorrect((c) => (c.includes(key) ? c : [...c, key]));
      setLine(pickLine('quiz.correct', 'laugh'));
    } else {
      audio.sfx('error');
      fx.shake(0.35, 0.25);
      setWrongPicks((w) => [...w, i]);
      setMisses((m) => ({ ...m, [key]: (m[key] ?? 0) + 1 }));
      setLine(pickLine('quiz.wrong'));
    }
    requestAnimationFrame(() => feedbackRef.current?.scrollIntoView({ block: 'nearest', behavior: motionReduced() ? 'auto' : 'smooth' }));
  };

  const next = () => {
    if (idx + 1 < quiz.length) {
      setIdx(idx + 1);
      setWrongPicks([]);
      setSolvedPick(null);
      audio.sfx('page');
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.qz-choice:not(:disabled)')?.focus());
      return;
    }
    // all correct → CASE COMPLETE
    finishRun(caseId, summary);
    setComplete(true);
    setStampKey((k) => k + 1);
    setLine(pickLine('quiz.complete', 'serious'));
  };

  // keyboard: 1-4 / A-D pick, Enter = next when solved
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || document.querySelector('.modal-root, .sheet-root')) return;
      const k = e.key.toUpperCase();
      const n = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : LETTERS.indexOf(k);
      if (n >= 0 && n < q.choices.length && !complete) {
        e.preventDefault();
        pick(n);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const lastWrong = wrongPicks.length > 0 && !done;

  return (
    <section class="scene qz">
      <div class="page qz-page">
        <div class="page__inner qz-inner">
          <header class="qz-head">
            <IconButton icon="back" label="科学解剖へ戻る" sfx="cancel" onClick={() => goto('science', { caseId })} tooltipSide="right" />
            <div class="qz-head__titles">
              <p class="eyebrow">
                CASE {pad2(num)}
                {summary ? ` ／ ${summary.title}` : ''}
              </p>
              <h1 class="qz-title">
                <span class="qz-title__jp">記憶の定着</span>
                <span class="qz-title__en">RECALL TEST</span>
              </h1>
            </div>
            <ol class="qz-dots" aria-label="進み具合">
              {quiz.map((_, i) => {
                const st = correct.includes(String(i)) ? 'ok' : i === idx ? 'now' : 'todo';
                return (
                  <li key={i} class={`qz-dot is-${st}`} aria-label={`第${i + 1}問 ${st === 'ok' ? '正解済み' : st === 'now' ? '回答中' : '未回答'}`}>
                    {st === 'ok' ? <Icon name="check" size={14} /> : <span>{i + 1}</span>}
                  </li>
                );
              })}
            </ol>
          </header>

          <div class="qz-holma">
            <div class="qz-holma__face" aria-hidden="true">
              <HolmaSprite mood={line.mood} framing="bust" talking />
            </div>
            <p class="qz-holma__line" aria-live="polite">
              <span class="qz-holma__name">ホルマ</span>
              {line.text}
            </p>
          </div>

          {!complete ? (
            <div class="qz-card" ref={cardRef} key={idx}>
              <p class="qz-card__num t-mono">
                QUESTION {pad2(idx + 1)} / {pad2(quiz.length)}
                {(misses[key] ?? 0) > 0 && <span class="qz-card__miss">この問題のやり直し {misses[key]}</span>}
              </p>
              <h2 class="qz-card__q">{q.q}</h2>
              <ul class="qz-choices" role="list">
                {q.choices.map((c, i) => {
                  const isWrong = wrongPicks.includes(i);
                  const isRight = done && i === (solvedPick ?? q.answer);
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        class={`qz-choice ${isWrong ? 'is-wrong' : ''} ${isRight ? 'is-right' : ''} ${done && !isRight ? 'is-dim' : ''}`}
                        disabled={isWrong || (done && !isRight)}
                        aria-pressed={isRight}
                        onClick={() => pick(i)}
                        data-autofocus={i === 0 ? true : undefined}
                      >
                        <span class="qz-choice__key" aria-hidden="true">
                          {LETTERS[i]}
                        </span>
                        <span class="qz-choice__text">{c}</span>
                        {isWrong && (
                          <span class="qz-choice__mark qz-choice__mark--ng">
                            <Icon name="cross" size={18} />
                            <span>ちがう</span>
                          </span>
                        )}
                        {isRight && (
                          <span class="qz-choice__mark qz-choice__mark--ok">
                            <Icon name="check" size={18} />
                            <span>正解</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {(done || lastWrong) && (
                <div class={`qz-fb ${done ? 'is-ok' : 'is-ng'}`} ref={feedbackRef} role="status">
                  <p class="qz-fb__head">
                    {done ? (
                      <>
                        <Icon name="check" size={20} /> 正解
                      </>
                    ) : (
                      <>
                        <Icon name="cross" size={20} /> ちがいます——解説を読んで、もう一度
                      </>
                    )}
                  </p>
                  <p class="qz-fb__explain">{q.explain}</p>
                  {done && (
                    <div class="qz-fb__actions">
                      <Button icon={idx + 1 < quiz.length ? 'chevronRight' : 'star'} onClick={next} en={idx + 1 < quiz.length ? 'NEXT' : 'COMPLETE'} data-autofocus>
                        {idx + 1 < quiz.length ? '次の問題へ' : '記録を刻む'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <CompletePanel caseId={caseId} stampKey={stampKey} misses={totalMisses} total={quiz.length} />
          )}
        </div>
      </div>
    </section>
  );
}

function CompletePanel({ caseId, stampKey, misses, total }: { caseId: string; stampKey: number; misses: number; total: number }) {
  const stamp = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = stamp.current;
    if (!el) return;
    if (stampKey <= 0 || motionReduced()) {
      if (stampKey > 0) audio.sfx('gavel');
      gsap.set(el, { opacity: 1 });
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo(el, { scale: 3.2, opacity: 0, rotation: 6 }, { scale: 0.92, opacity: 1, rotation: -8, duration: 0.24, ease: 'power4.in' })
      .add(() => {
        audio.sfx('stamp');
        audio.sfx('gavel');
        fx.shake(1.2, 0.45);
        fx.flash('#C6FF3D', { opacity: 0.35, duration: 0.5 });
        fx.speedLines(700, { kind: 'radial', color: 'rgba(198,255,61,0.5)' });
      })
      .to(el, { scale: 1, duration: 0.5, ease: 'elastic.out(1.1, 0.45)' });
    return () => {
      tl.kill();
    };
  }, [stampKey]);
  return (
    <div class="qz-done">
      {/* the next screen's header is 「CASE COMPLETE」: the stamp seals the record instead of repeating it */}
      <div class="qz-done__stamp" ref={stamp} role="img" aria-label="記録、封緘。記憶、定着">
        <span class="qz-done__kicker t-mono">RECALL TEST — ALL CLEAR</span>
        <span class="qz-done__big">RECORD SEALED</span>
        <span class="qz-done__jp">記憶、定着</span>
      </div>
      <p class="qz-done__sum">
        全{total}問 正解{misses > 0 ? `（やり直し ${misses}回）` : '（一度も間違えずに）'}
      </p>
      <Button variant="big-cta" class="end-cta" size="lg" icon="star" iconRight="chevronRight" en="RESULT" onClick={() => goto('result', { caseId, fresh: '1' })} data-autofocus>
        審問の記録を見る
      </Button>
    </div>
  );
}
