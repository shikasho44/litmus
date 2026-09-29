/**
 * CASE COMPLETE — 審問の記録 (design bible §3-6). Reads the run stored by completeCase()
 * (the quiz finishes the run); works without the server so the Files screen's 「記録」 button
 * can open it any time. `?fresh=1` plays the rank reveal.
 *
 * Under the seal Holma names what cost the rank (rankAdvice: the 1–2 penalties whose removal
 * would have given S, or the next rank up) and how S is earned; on a replay the change against
 * the previous best rank is shown. Below it, the 名探偵度数 block (Degree.tsx): what the run
 * earned, the cumulative degree counting up, its badge and the way to the next one.
 *
 * Buttons: 次の事件へ (big CTA under the stats) / 事件ファイルへ / 同じ事件をもう一度 (confirm → fresh
 * run) / 共有 (Web Share, clipboard fallback; spoiler-free text).
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CaseSummary } from '../../../shared/api';
import { openCase } from '../../app/flow';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { APP_CONFIG } from '../../config/app';
import { buildCaseResult, computeRank, detectiveLevel, detectiveTotal, questionPar, questionTerms, rankAdvice, RANK_LABEL, RANK_TITLES, rankTitleOf, resultPoints, S_CONDITION, S_PLUS_CONDITION, type RankInput } from '../../features/rank';
import { DifficultyBadge } from '../../features/difficulty/Badge';
import { DIFFICULTY_META } from '../../features/difficulty/meta';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { useImage } from '../../lib/asset';
import { caseList, loadCases } from '../../lib/cases';
import { formatElapsed, useCaseProgress } from '../../state/hooks';
import { completeCase, getCaseProgress, resetCase, saveData } from '../../state/save';
import type { CaseResult, Rank } from '../../state/types';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toast';
import { caseNumber, pad2 } from '../Resolution/solution';
import { DegreeBlock } from './Degree';
import './result.css';

const RANK_COLOR: Record<Rank, string> = { 'S+': 'var(--formalin)', S: 'var(--formalin)', A: 'var(--cyan)', B: 'var(--amber)', C: 'var(--bone-2)' };
const RANK_ORDER: Rank[] = ['S+', 'S', 'A', 'B', 'C'];
const isTop = (r: Rank) => r === 'S' || r === 'S+';

export function ResultScene({ params }: SceneProps) {
  const caseId = params.caseId!;
  const progress = useCaseProgress(caseId);
  const [list, setList] = useState<CaseSummary[] | null>(caseList.peek());
  useEffect(() => {
    void loadCases().then((l) => l && setList(l));
  }, []);
  const summary = list?.find((c) => c.id === caseId) ?? null;

  // A run that reached this screen without being sealed (e.g. a deep link right after the
  // quiz) is completed here, so the record is never lost.
  useEffect(() => {
    const p = getCaseProgress(caseId);
    if (!p || p.lastResult || p.stage === 'complete') return;
    const quizDone = (p.quiz?.correct.length ?? 0) > 0 && (p.stage === 'quiz' || p.stage === 'result');
    if (!quizDone || !list) return;
    const { result } = buildCaseResult(p, { difficulty: summary?.difficulty ?? 2, estimatedMinutes: summary?.estimatedMinutes, questionBudget: summary?.questionBudget });
    completeCase(caseId, result);
  }, [caseId, list]);

  const result = progress.value?.lastResult;
  if (!result) return <NoRecord caseId={caseId} />;
  return <Result caseId={caseId} result={result} best={progress.value?.bestRank} clears={progress.value?.clears ?? 1} summary={summary} list={list} fresh={params.fresh === '1'} />;
}

function NoRecord({ caseId }: { caseId: string }) {
  return (
    <section class="scene end-state rs-empty">
      <div class="rs-empty__box">
        <p class="eyebrow">NO RECORD</p>
        <h1 class="rs-empty__title">この事件の記録は、まだありません</h1>
        <p class="rs-empty__body">記憶の定着まで終えると、審問官ランクがここに刻まれます。</p>
        <div class="row row--wrap" style={{ marginTop: 16 }}>
          <Button icon="gavel" onClick={() => openCase(caseId)} data-autofocus>
            事件を開く
          </Button>
          <Button variant="ghost" icon="tag" sfx="cancel" onClick={() => goto('files')}>
            事件ファイルへ
          </Button>
        </div>
      </div>
    </section>
  );
}

function rankInputFrom(r: CaseResult, estimatedMinutes?: number): RankInput {
  const s = r.stats ?? {};
  return {
    estimatedMinutes: s.estimatedMinutes || estimatedMinutes,
    difficulty: s.difficulty ?? 2,
    asked: s.asked ?? 0,
    // question budget fields (2026-09-28); absent in older records → the legacy question rule
    spent: s.spent,
    budget: s.budget,
    overCost: s.budget === undefined ? undefined : (s.budgetCost ?? 0),
    overCap: s.budget === undefined ? undefined : (s.budgetCap ?? 0),
    keyQuestions: s.keyQuestions ?? 0,
    answered: s.answered ?? 0,
    hintsUsed: s.hintsUsed ?? 0,
    debateMisses: s.debateMisses ?? 0,
    grants: s.grants ?? 0,
    verdictAttempts: s.verdictAttempts ?? 1,
    suspensions: s.suspensions ?? 0,
    gameOvers: s.gameOvers ?? 0,
    quizMisses: s.quizMisses ?? 0,
    elapsedMs: r.elapsedMs ?? 0,
    debateRounds: s.debateRounds ?? 0,
    debateCleared: s.debateCleared ?? 0,
  };
}

function Result({ caseId, result, best, clears, summary, list, fresh }: { caseId: string; result: CaseResult; best?: Rank; clears: number; summary: CaseSummary | null; list: CaseSummary[] | null; fresh: boolean }) {
  const s = result.stats ?? {};
  const input = useMemo(() => rankInputFrom(result, summary?.estimatedMinutes), [result, summary?.estimatedMinutes]);
  const detail = useMemo(() => computeRank(input), [input]);
  // only explain the rank when the recomputation agrees with the stored one (older saves may lack inputs)
  const advice = useMemo(() => (detail.rank === result.rank ? rankAdvice(input, detail) : null), [input, detail, result.rank]);
  // older saves keep the title text of their day (「一撃の審問官」…): show it under its current name
  const title = rankTitleOf(result.title) ?? RANK_TITLES.find((t) => t.id === detail.titleId)!;
  const rank = result.rank;
  const num = caseNumber(caseId, summary);
  const bg = useImage(summary?.background ?? null);
  const [confirm, setConfirm] = useState(false);
  const rankRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(!fresh || motionReduced());
  const sorted = list ? [...list].sort((a, b) => a.number - b.number) : [];
  const done = (id: string) => id === caseId || saveData.peek().cases[id]?.completed;
  // the next case in order; after the last one, the first case not yet completed
  const next = sorted.find((c) => c.number > (summary?.number ?? num)) ?? sorted.find((c) => !done(c.id));
  const allDone = sorted.length > 0 && sorted.every((c) => done(c.id));
  const canShare = typeof navigator !== 'undefined' && (typeof navigator.share === 'function' || !!navigator.clipboard);
  const keyRate = s.answered ? Math.round(((s.keyQuestions ?? 0) / s.answered) * 100) : null;
  const par = questionPar(input.difficulty);
  const q = questionTerms(input);
  const degree = detectiveTotal(saveData.value.cases);
  const bestPoints = saveData.value.cases[caseId]?.bestPoints;

  // rank reveal
  useLayoutEffect(() => {
    const el = rankRef.current;
    if (!el || revealed) return;
    const tl = gsap.timeline({ delay: 0.6, onComplete: () => setRevealed(true) });
    tl.fromTo(el, { scale: 2.6, opacity: 0, rotation: 14 }, { scale: 0.94, opacity: 1, rotation: -6, duration: 0.26, ease: 'power4.in' })
      .add(() => {
        audio.sfx('stamp');
        fx.shake(isTop(rank) ? 1.2 : 0.7, 0.4);
        if (isTop(rank)) fx.flash('#C6FF3D', { opacity: rank === 'S+' ? 0.45 : 0.3, duration: 0.5 });
      })
      .to(el, { scale: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.5)' });
    return () => {
      tl.kill();
    };
  }, []);

  const share = async () => {
    const hashtag = `#${APP_CONFIG.GAME_TITLE.replace(/[\s・]/g, '')}`;
    const dl = detectiveLevel(degree);
    const text = `CASE ${pad2(num)}${summary?.title ? `『${summary.title}』` : ''}を難易度「${DIFFICULTY_META[level].jp}」・ランク${rank}で解決。名探偵度数 ${degree}${dl.level > 0 ? `（${dl.name}）` : ''}。${hashtag}`;
    const url = location.href.split('#')[0].replace(/[?&]debug=1/, '');
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('共有用の文をコピーしました', { tone: 'success', icon: 'check' });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      toast('共有できませんでした', { tone: 'error' });
    }
  };

  // value = number in the display face (+ a small unit in the body face only where it reads well: 問 / %).
  // Counts stay bare: 回 set next to a big number, at any weight, reads as a missing-glyph box.
  const verdicts = s.verdictAttempts ?? 1;
  const gameOvers = s.gameOvers ?? 0;
  const quizMiss = s.quizMisses ?? 0;
  const rounds = s.debateRounds ?? 0;
  const roundsCleared = s.debateCleared ?? 0;
  const stats: { icon: IconName; label: string; num: string; unit?: string; sub?: string; tone?: 'good' | 'warn' }[] = [
    q.legacy
      ? { icon: 'send', label: '質問数', num: `${s.asked ?? 0}`, unit: '問', sub: `目安 ${par}問`, tone: (s.asked ?? 0) <= par ? 'good' : undefined }
      : {
          icon: 'send',
          label: '質問数',
          num: `${q.spent}`,
          unit: `/${q.budget}問`,
          // 質問枠 and what went beyond it; free questions (「具体的に」, small talk…) are listed apart
          sub: `質問枠 ${q.budget}問${q.spent > q.budget ? `・${q.spent - q.budget}問超過` : ''}${(s.asked ?? 0) > q.spent ? `・数えない質問 ${(s.asked ?? 0) - q.spent}` : ''}`,
          tone: q.spent <= q.budget ? 'good' : q.overCost > 0 ? 'warn' : undefined,
        },
    { icon: 'star', label: '重要質問率', num: keyRate === null ? '—' : `${keyRate}`, unit: keyRate === null ? undefined : '%', sub: s.answered ? `所見を得た質問 ${s.keyQuestions ?? 0} / ${s.answered}` : '記録なし' },
    { icon: 'hint', label: 'ホルマの囁き', num: `${s.hintsUsed ?? 0}`, sub: 'ヒントを使った回数', tone: (s.hintsUsed ?? 0) === 0 ? 'good' : 'warn' },
    rounds > 0
      ? { icon: 'shard', label: '反証', num: `${roundsCleared}/${rounds}`, sub: `反応なし ${s.debateMisses ?? 0}回${roundsCleared < rounds ? '・飛ばしたラウンドあり' : ''}`, tone: roundsCleared >= rounds && (s.debateMisses ?? 0) === 0 ? 'good' : undefined }
      : { icon: 'shard', label: '反応なし', num: `${s.debateMisses ?? 0}`, sub: '反証で色が変わらなかった回数', tone: (s.debateMisses ?? 0) === 0 ? 'good' : undefined },
    { icon: 'help', label: '泣きつき', num: `${s.grants ?? 0}`, sub: '所見を借りた回数', tone: (s.grants ?? 0) === 0 ? 'good' : 'warn' },
    {
      icon: 'gavel',
      label: '死因宣告',
      num: `${verdicts}`,
      // a game over of this run rides on the verdict tile (a ninth tile would leave the grid ragged)
      sub: `${verdicts <= 1 ? '一度で通った' : `${verdicts}度目で通った`}${gameOvers > 0 ? `・ゲームオーバー${gameOvers}回` : ''}`,
      tone: gameOvers > 0 ? 'warn' : verdicts <= 1 ? 'good' : undefined,
    },
    { icon: 'time', label: '所要時間', num: formatElapsed(result.elapsedMs ?? 0) },
    { icon: 'check', label: '記憶の定着', num: `${quizMiss}`, sub: quizMiss === 0 ? '一度で全問正解' : 'やり直した回数', tone: quizMiss === 0 ? 'good' : undefined },
  ];
  const prev = result.prevBest;
  const bestNote = !best
    ? ''
    : !prev
      ? best !== rank
        ? '（この事件の最高記録）'
        : ''
      : rank === prev
        ? '（前回の最高と同じ）'
        : RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(prev)
          ? ''
          : `（今回 ${rank}）`;
  const improved = !!prev && RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(prev);
  const level = result.playDifficulty ?? 'normal';

  return (
    <section class={`scene rs rs--${rank === 'S+' ? 'Splus' : rank}`} style={{ '--rank-color': RANK_COLOR[rank] }} data-rank={rank}>
      <div class="rs__bg" aria-hidden="true">
        {bg && <img src={bg} alt="" />}
        <div class="rs__shade" />
      </div>
      <div class="page rs-page">
        <div class="page__inner rs-inner">
          <header class="rs-head">
            <p class="eyebrow">
              CASE {pad2(num)}
              {summary ? ` ／ ${summary.title}` : ''}
              {clears > 1 ? ` ／ ${clears}回目の解決` : ''}
            </p>
            <h1 class="rs-title">
              <span class="rs-title__en">CASE COMPLETE</span>
              <span class="rs-title__jp">審問の記録</span>
            </h1>
            <p class="rs-level">
              <span class="rs-level__k t-mono">DIFFICULTY</span>
              <DifficultyBadge difficulty={level} />
              <span class="rs-level__mode">{DIFFICULTY_META[level].modeJp}の死因宣告</span>
            </p>
          </header>

          <div class="rs-main">
            <div class="rs-left">
              <div class="rs-rank">
                <div class={`rs-rank__seal ${revealed ? 'is-in' : ''}`} ref={rankRef} style={fresh && !motionReduced() ? { opacity: 0 } : undefined} role="img" aria-label={`審問官ランク ${rank}`}>
                  <span class="rs-rank__ring" aria-hidden="true" />
                  <span class={`rs-rank__letter ${rank === 'S+' ? 'is-plus' : ''}`} aria-hidden="true">
                    {rank === 'S+' ? (
                      <>
                        S<sup>+</sup>
                      </>
                    ) : (
                      rank
                    )}
                  </span>
                  <span class="rs-rank__en t-mono" aria-hidden="true">
                    RANK · {RANK_LABEL[rank].en}
                  </span>
                </div>
                <div class="rs-rank__text">
                  <p class="rs-rank__label">
                    審問官ランク <strong>{rank}</strong> ／ {RANK_LABEL[rank].jp}
                  </p>
                  <p class="rs-rank__title">「{rankTitleOf(result.title)?.title ?? result.title}」</p>
                  <div class="rs-rank__holma">
                    <div class="rs-rank__face" aria-hidden="true">
                      <HolmaSprite mood={isTop(rank) || rank === 'A' ? 'laugh' : 'normal'} framing="bust" />
                    </div>
                    <p>
                      <span class="rs-rank__name">ホルマ</span>
                      {title?.comment ?? detail.comment}
                      {advice && <span class="rs-rank__advice">{advice.line}</span>}
                    </p>
                  </div>
                  <p class="rs-rank__cond">
                    <span class="rs-rank__cond-k t-mono">RANK S</span>
                    {S_CONDITION}
                  </p>
                  <p class="rs-rank__cond">
                    <span class="rs-rank__cond-k t-mono">RANK S+</span>
                    {S_PLUS_CONDITION}
                  </p>
                  {best && (
                    <p class={`rs-rank__best t-mono ${improved ? 'is-up' : ''}`}>
                      BEST RANK
                      {improved && prev ? (
                        <>
                          <s class="rs-rank__prev">{prev}</s>
                          <span aria-hidden="true">→</span>
                          <strong>{rank}</strong>
                          <em>記録更新</em>
                        </>
                      ) : (
                        <strong>{best}</strong>
                      )}
                      {bestNote}
                    </p>
                  )}
                </div>
              </div>
              <DegreeBlock result={result} total={degree} fresh={fresh} revealed={revealed} />
            </div>

            <div class="rs-side">
              <dl class="rs-stats">
                {stats.map((st, i) => (
                  <div key={st.label} class={`rs-stat ${st.tone ? `is-${st.tone}` : ''}`} style={{ '--i': i }}>
                    <dt>
                      <Icon name={st.icon} size={16} />
                      {st.label}
                    </dt>
                    <dd>
                      <span class="rs-stat__value">
                        <span class="rs-stat__num">{st.num}</span>
                        {st.unit && <span class="rs-stat__unit">{st.unit}</span>}
                      </span>
                      {st.sub && <span class="rs-stat__sub">{st.sub}</span>}
                    </dd>
                  </div>
                ))}
              </dl>

              <nav class="rs-actions" aria-label="次の行動">
                {allDone && (
                  <p class="rs-actions__all">
                    <Icon name="star" size={18} /> すべての事件ファイルを閉じました。お見事ですとも。
                  </p>
                )}
                {next && !(allDone && next.number < (summary?.number ?? num)) && (
                  <Button variant="big-cta" class="end-cta" size="lg" icon="tag" iconRight="chevronRight" en={`NEXT — CASE ${pad2(next.number)}`} onClick={() => openCase(next.id)} data-autofocus>
                    {next.number > (summary?.number ?? num) ? '次の事件へ' : '未解決の事件へ'}
                  </Button>
                )}
                <div class="rs-actions__row">
                  <Button variant={next && !allDone ? 'ghost' : 'primary'} icon="tag" onClick={() => goto('files')} data-autofocus={next && !allDone ? undefined : true}>
                    事件ファイルへ
                  </Button>
                  <Button variant="ghost" icon="refresh" onClick={() => setConfirm(true)}>
                    同じ事件をもう一度
                  </Button>
                  {canShare && (
                    <Button variant="ghost" icon="external" onClick={share} sfx="page">
                      共有する
                    </Button>
                  )}
                </div>
              </nav>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="同じ事件をもう一度"
        en="REPLAY"
        size="sm"
        tone="alarm"
        footer={
          <>
            <Button variant="ghost" sfx="cancel" onClick={() => setConfirm(false)}>
              やめておく
            </Button>
            <Button
              variant="danger"
              icon="refresh"
              onClick={() => {
                setConfirm(false);
                // the run is reset now; the difficulty chooser then starts the new one
                resetCase(caseId);
                setTimeout(() => openCase(caseId), 220);
              }}
            >
              はじめから
            </Button>
          </>
        }
      >
        <p class="rs-confirm">
          この事件の進行（質問の記録・所見・審問）をリセットして、最初から捜査します。難易度は、このあと選び直せます。
          <br />
          最高ランク（{best ?? rank}）・この事件の最高度数（+{bestPoints ?? resultPoints(result).total}）と解決回数は残ります。
        </p>
      </Modal>
    </section>
  );
}
