import { useEffect, useState } from 'preact/hooks';
import { openCase } from '../../app/flow';
import { back, goto, openOverlay, type SceneProps } from '../../app/router';
import { ART, useImage } from '../../lib/asset';
import { caseList, caseListError, caseListState, loadCases } from '../../lib/cases';
import { DegreeMeter } from '../../features/rank/Badge';
import { detectiveTotal } from '../../features/rank/points';
import { caseStatus, saveData, shownCases } from '../../state/save';
import { formatElapsed } from '../../state/hooks';
import { Button, IconButton } from '../../ui/Button';
import { CaseTag } from '../../ui/CaseTag';
import { Icon } from '../../ui/Icon';
import './files.css';

/**
 * Mounted on the first hover/focus of its case (not for every case on entry: that was ~830 KB
 * of backgrounds for one visible layer). It fades in after it has loaded, and doubles as a
 * prefetch of the background the case intro opens on.
 */
function CaseBackdrop({ path, active }: { path: string; active: boolean }) {
  const url = useImage(path);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!url) return;
    // two frames: let the image paint at opacity 0 first so .is-on transitions
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setShown(true))));
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [url]);
  if (!url) return null;
  return <img class={`files__case-bg ${active && shown ? 'is-on' : ''}`} src={url} alt="" aria-hidden="true" />;
}

/** The first-visit tip chip can be dismissed for the rest of the session. */
let tipDismissed = false;

function SkeletonTag({ i }: { i: number }) {
  return (
    <div class="tag tag--skeleton" style={{ '--tag-tilt': `${[-2, 1.5, -1][i % 3]}deg`, '--tag-delay': `${i * 90}ms` }} aria-hidden="true">
      <span class="tag__string" />
      <div class="tag__card">
        <span class="tag__hole" />
        <span class="skel skel--num" />
        <span class="skel skel--title" />
        <span class="skel skel--line" />
        <span class="skel skel--line" />
        <span class="skel skel--line skel--short" />
      </div>
    </div>
  );
}

export function FilesScene(_: SceneProps) {
  const roomBg = useImage(ART.roomZero);
  const [focus, setFocus] = useState<string | null>(null);
  const [tipOff, setTipOff] = useState(tipDismissed);
  // case backgrounds are mounted lazily: once hovered/focused, kept for the cross-fade
  const [touched] = useState(() => new Set<string>());
  if (focus) touched.add(focus);
  const list = caseList.value;
  const state = caseListState.value;
  const save = saveData.value;

  useEffect(() => {
    void loadCases();
  }, []);

  const solvedCount = list ? list.filter((c) => ['solved', 'complete'].includes(caseStatus(save.cases[c.id]))).length : 0;
  const completeCount = list ? list.filter((c) => caseStatus(save.cases[c.id]) === 'complete').length : 0;
  // a prototype case without its switch (?proto) is not counted (shownCases)
  const anyStarted = Object.values(shownCases(save.cases)).some((c) => c.stage !== 'new');
  const focused = list?.find((c) => c.id === focus);
  const degree = detectiveTotal(shownCases(save.cases));
  // 初見タイム合計: the first-clear times of every case that has one (owner: how fast can you do them all on first sight)
  const firsts = list ? list.map((c) => save.cases[c.id]?.firstClear).filter((f) => !!f) : [];
  const firstTotal = firsts.reduce((sum, f) => sum + f.clearMs, 0);

  return (
    <section class="scene files" style={focused ? { '--files-accent': focused.accent } : undefined}>
      <div class="files__bg" aria-hidden="true">
        {roomBg ? <img class="files__room" src={roomBg} alt="" /> : <div class="files__room-fallback" />}
        {list?.map((c) => (touched.has(c.id) ? <CaseBackdrop key={c.id} path={c.background} active={focus === c.id} /> : null))}
        <div class="files__bg-shade" />
      </div>

      <div class="page files__page">
        <div class="page__inner">
          <header class="files__head">
            <div class="files__nav">
              <IconButton icon="back" label="タイトルへ戻る" onClick={() => back()} sfx="cancel" tooltipSide="right" />
              <span class="eyebrow only-wide">ARCHIVE — ROOM ZERO</span>
              <div class="spacer" />
              <IconButton icon="help" label="遊び方" onClick={() => openOverlay('howto')} />
              <IconButton icon="settings" label="設定" onClick={() => openOverlay('settings')} />
            </div>
            <div class="files__heading">
              <h1 class="files__title">
                <span class="files__title-jp">事件ファイル</span>
                <span class="files__title-en">CASE FILES</span>
              </h1>
              <p class="files__lead">
                名前を失った者たちの記録。
                <br class="only-wide" />
                ひとつ選んで、解剖を始めましょう。
              </p>
              <div class={`files__degree ${degree === 0 && !anyStarted ? 'is-empty' : ''}`}>
                <DegreeMeter total={degree} onClick={() => openOverlay('howto', { page: 'DETECTIVE DEGREE' })} />
              </div>
              {list && (
                <dl class="files__stats" aria-label="進み具合">
                  <div>
                    <dt>SOLVED</dt>
                    <dd>
                      {solvedCount}
                      <small>/{list.length}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>COMPLETE</dt>
                    <dd>
                      {completeCount}
                      <small>/{list.length}</small>
                    </dd>
                  </div>
                  {firsts.length > 0 && (
                    <div class="files__stats-first" data-first-total>
                      <dt>初見タイム合計</dt>
                      <dd aria-label={`初見タイム合計 ${formatElapsed(firstTotal)}（${firsts.length}件）`}>
                        {formatElapsed(firstTotal)}
                        <small>/{firsts.length}件</small>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </header>

          {!anyStarted && !tipOff && state !== 'error' && (
            <aside class="files__tip" aria-label="はじめての方へ">
              <Icon name="info" size={16} />
              <p>
                はじめてなら <strong>CASE 01</strong> から。質問のコツは
              </p>
              <button type="button" class="files__tip-link" onClick={() => openOverlay('howto')}>
                <Icon name="help" size={16} />
                遊び方
              </button>
              <IconButton
                icon="close"
                label="このヒントを閉じる"
                size="sm"
                variant="plain"
                sfx="close"
                class="files__tip-close"
                onClick={() => {
                  tipDismissed = true;
                  setTipOff(true);
                }}
              />
            </aside>
          )}

          {state === 'error' && (
            <div class="files__error" role="alert">
              <p class="t-display t-lg">事件ファイルを開けませんでした</p>
              <p class="t-sm t-bone2">通信が不安定なようです。少し待ってから、もう一度お試しください。</p>
              <p class="t-2xs t-muted t-mono">{caseListError.value}</p>
              <div class="row" style={{ marginTop: 10 }}>
                <Button icon="refresh" onClick={() => loadCases(true)}>
                  再読み込み
                </Button>
                <Button variant="ghost" icon="back" sfx="cancel" onClick={() => goto('title')}>
                  タイトルへ
                </Button>
              </div>
            </div>
          )}

          <div class="files__grid" aria-busy={state === 'loading'}>
            {!list && state !== 'error' && [0, 1, 2].map((i) => <SkeletonTag key={i} i={i} />)}
            {list?.map((c, i) => {
              const p = save.cases[c.id];
              const status = caseStatus(p);
              return (
                <CaseTag
                  key={c.id}
                  summary={c}
                  index={i}
                  status={status}
                  bestRank={p?.bestRank}
                  bestPoints={p?.bestRank ? p.bestPoints : undefined}
                  onOpen={() => openCase(c.id)}
                  onFocusCase={() => setFocus(c.id)}
                  onSecondary={p?.lastResult ? () => goto('result', { caseId: c.id }) : undefined}
                  secondaryLabel="記録"
                  restored={p?.restored}
                  firstClear={p?.firstClear}
                />
              );
            })}
          </div>

          <p class="files__foot t-mono">ALL CASES ARE FICTIONAL — 登場する事件・人物はすべて架空です</p>
        </div>
      </div>
    </section>
  );
}
