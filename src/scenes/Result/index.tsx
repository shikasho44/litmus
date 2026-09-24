/**
 * CASE COMPLETE — 審問の記録 (design bible §3-6). Reads the run stored by completeCase()
 * (the quiz finishes the run); works without the server so the Files screen's 「記録」 button
 * can open it any time. `?fresh=1` plays the rank reveal.
 *
 * Buttons: 事件ファイルへ / 同じ事件をもう一度 (confirm → fresh run) / 次の事件へ / 共有 (Web
 * Share, clipboard fallback; spoiler-free text).
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CaseSummary } from '../../../shared/api';
import { openCase } from '../../app/flow';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { APP_CONFIG } from '../../config/app';
import { buildCaseResult, computeRank, questionPar, RANK_LABEL, RANK_TITLES, type RankInput } from '../../features/rank';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { useImage } from '../../lib/asset';
import { caseList, loadCases } from '../../lib/cases';
import { formatElapsed, useCaseProgress } from '../../state/hooks';
import { completeCase, getCaseProgress, resetCase, saveData, setStage } from '../../state/save';
import type { CaseResult, Rank } from '../../state/types';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toast';
import { caseNumber, pad2 } from '../Resolution/solution';
import './result.css';

const RANK_COLOR: Record<Rank, string> = { S: 'var(--formalin)', A: 'var(--cyan)', B: 'var(--amber)', C: 'var(--bone-2)' };

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
    const { result } = buildCaseResult(p, { difficulty: summary?.difficulty ?? 2, estimatedMinutes: summary?.estimatedMinutes });
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
        <p class="rs-empty__body">確認テストまで終えると、審問官ランクがここに刻まれます。</p>
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

function rankInputFrom(r: CaseResult): RankInput {
  const s = r.stats ?? {};
  return {
    difficulty: s.difficulty ?? 2,
    asked: s.asked ?? 0,
    keyQuestions: s.keyQuestions ?? 0,
    answered: s.answered ?? 0,
    hintsUsed: s.hintsUsed ?? 0,
    debateMisses: s.debateMisses ?? 0,
    grants: s.grants ?? 0,
    verdictAttempts: s.verdictAttempts ?? 1,
    suspensions: s.suspensions ?? 0,
    elapsedMs: r.elapsedMs ?? 0,
  };
}

function Result({ caseId, result, best, clears, summary, list, fresh }: { caseId: string; result: CaseResult; best?: Rank; clears: number; summary: CaseSummary | null; list: CaseSummary[] | null; fresh: boolean }) {
  const s = result.stats ?? {};
  const input = useMemo(() => rankInputFrom(result), [result]);
  const detail = useMemo(() => computeRank(input), [input]);
  const title = RANK_TITLES.find((t) => t.title === result.title) ?? RANK_TITLES.find((t) => t.id === detail.titleId)!;
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

  // rank reveal
  useLayoutEffect(() => {
    const el = rankRef.current;
    if (!el || revealed) return;
    const tl = gsap.timeline({ delay: 0.6, onComplete: () => setRevealed(true) });
    tl.fromTo(el, { scale: 2.6, opacity: 0, rotation: 14 }, { scale: 0.94, opacity: 1, rotation: -6, duration: 0.26, ease: 'power4.in' })
      .add(() => {
        audio.sfx('stamp');
        fx.shake(rank === 'S' ? 1.2 : 0.7, 0.4);
        if (rank === 'S') fx.flash('#C6FF3D', { opacity: 0.3, duration: 0.5 });
      })
      .to(el, { scale: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.5)' });
    return () => {
      tl.kill();
    };
  }, []);

  const share = async () => {
    const hashtag = `#${APP_CONFIG.GAME_TITLE.replace(/[\s・]/g, '')}`;
    const text = `CASE ${pad2(num)}${summary?.title ? `『${summary.title}』` : ''}をランク${rank}で解決。${hashtag}`;
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

  const stats: { icon: IconName; label: string; value: string; sub?: string; tone?: 'good' | 'warn' }[] = [
    { icon: 'send', label: '質問数', value: `${s.asked ?? 0}`, sub: `目安 ${par}問`, tone: (s.asked ?? 0) <= par ? 'good' : undefined },
    { icon: 'star', label: '重要質問率', value: keyRate === null ? '—' : `${keyRate}%`, sub: s.answered ? `所見を得た質問 ${s.keyQuestions ?? 0} / ${s.answered}` : '記録なし' },
    { icon: 'hint', label: 'ホルマの囁き', value: `${s.hintsUsed ?? 0}`, sub: 'ヒントの使用', tone: (s.hintsUsed ?? 0) === 0 ? 'good' : 'warn' },
    { icon: 'shard', label: 'ノイズ・ブレイクのミス', value: `${s.debateMisses ?? 0}`, tone: (s.debateMisses ?? 0) === 0 ? 'good' : undefined },
    { icon: 'help', label: '泣きつき', value: `${s.grants ?? 0}`, sub: '所見を借りた回数', tone: (s.grants ?? 0) === 0 ? 'good' : 'warn' },
    { icon: 'gavel', label: '死因宣告', value: `${s.verdictAttempts ?? 1}回`, sub: (s.verdictAttempts ?? 1) <= 1 ? '一度で' : `${(s.verdictAttempts ?? 1) - 1}回やり直し`, tone: (s.verdictAttempts ?? 1) <= 1 ? 'good' : undefined },
    { icon: 'time', label: '所要時間', value: formatElapsed(result.elapsedMs ?? 0) },
    { icon: 'check', label: '確認テスト', value: (s.quizMisses ?? 0) === 0 ? '全問一発' : `やり直し ${s.quizMisses}`, tone: (s.quizMisses ?? 0) === 0 ? 'good' : undefined },
  ];

  return (
    <section class={`scene rs rs--${rank}`} style={{ '--rank-color': RANK_COLOR[rank] }}>
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
          </header>

          <div class="rs-main">
            <div class="rs-rank">
              <div class={`rs-rank__seal ${revealed ? 'is-in' : ''}`} ref={rankRef} style={fresh && !motionReduced() ? { opacity: 0 } : undefined} role="img" aria-label={`審問官ランク ${rank}`}>
                <span class="rs-rank__ring" aria-hidden="true" />
                <span class="rs-rank__letter" aria-hidden="true">
                  {rank}
                </span>
                <span class="rs-rank__en t-mono" aria-hidden="true">
                  RANK · {RANK_LABEL[rank].en}
                </span>
              </div>
              <div class="rs-rank__text">
                <p class="rs-rank__label">
                  審問官ランク <strong>{rank}</strong> ／ {RANK_LABEL[rank].jp}
                </p>
                <p class="rs-rank__title">「{result.title}」</p>
                <div class="rs-rank__holma">
                  <div class="rs-rank__face" aria-hidden="true">
                    <HolmaSprite mood={rank === 'S' || rank === 'A' ? 'laugh' : 'normal'} framing="bust" />
                  </div>
                  <p>
                    <span class="rs-rank__name">ホルマ</span>
                    {title?.comment ?? detail.comment}
                  </p>
                </div>
                {best && (
                  <p class="rs-rank__best t-mono">
                    BEST RANK <strong>{best}</strong>
                    {best !== rank ? '（この事件の最高記録）' : ''}
                  </p>
                )}
              </div>
            </div>

            <dl class="rs-stats">
              {stats.map((st, i) => (
                <div key={st.label} class={`rs-stat ${st.tone ? `is-${st.tone}` : ''}`} style={{ '--i': i }}>
                  <dt>
                    <Icon name={st.icon} size={16} />
                    {st.label}
                  </dt>
                  <dd>
                    <span class="rs-stat__value">{st.value}</span>
                    {st.sub && <span class="rs-stat__sub">{st.sub}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

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
                resetCase(caseId);
                setStage(caseId, 'intro');
                goto('intro', { caseId });
              }}
            >
              はじめから
            </Button>
          </>
        }
      >
        <p class="rs-confirm">
          この事件の進行（質問の記録・所見・審問）をリセットして、最初から捜査します。
          <br />
          最高ランク（{best ?? rank}）と解決回数は残ります。
        </p>
      </Modal>
    </section>
  );
}
