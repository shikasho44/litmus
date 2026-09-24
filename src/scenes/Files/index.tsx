import { useEffect, useState } from 'preact/hooks';
import { openCase } from '../../app/flow';
import { back, goto, openOverlay, type SceneProps } from '../../app/router';
import { ART, useImage } from '../../lib/asset';
import { caseList, caseListError, caseListState, loadCases } from '../../lib/cases';
import { caseStatus, saveData } from '../../state/save';
import { Button, IconButton } from '../../ui/Button';
import { CaseTag } from '../../ui/CaseTag';
import { Icon } from '../../ui/Icon';
import './files.css';

function CaseBackdrop({ path, active }: { path: string; active: boolean }) {
  const url = useImage(path);
  if (!url) return null;
  return <img class={`files__case-bg ${active ? 'is-on' : ''}`} src={url} alt="" aria-hidden="true" />;
}

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
  const list = caseList.value;
  const state = caseListState.value;
  const save = saveData.value;

  useEffect(() => {
    void loadCases();
  }, []);

  const solvedCount = list ? list.filter((c) => ['solved', 'complete'].includes(caseStatus(save.cases[c.id]))).length : 0;
  const completeCount = list ? list.filter((c) => caseStatus(save.cases[c.id]) === 'complete').length : 0;
  const anyStarted = Object.values(save.cases).some((c) => c.stage !== 'new');
  const focused = list?.find((c) => c.id === focus);

  return (
    <section class="scene files" style={focused ? { '--files-accent': focused.accent } : undefined}>
      <div class="files__bg" aria-hidden="true">
        {roomBg ? <img class="files__room" src={roomBg} alt="" /> : <div class="files__room-fallback" />}
        {list?.map((c) => <CaseBackdrop key={c.id} path={c.background} active={focus === c.id} />)}
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
                </dl>
              )}
            </div>
          </header>

          {!anyStarted && state !== 'error' && (
            <aside class="files__tip">
              <Icon name="info" size={18} />
              <p>
                はじめての方は <strong>CASE 01</strong> からどうぞ。質問のしかたは「遊び方」でいつでも確認できます。
              </p>
              <Button variant="ghost" size="sm" icon="help" onClick={() => openOverlay('howto')} sfx={false}>
                遊び方
              </Button>
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
                  onOpen={() => openCase(c.id)}
                  onFocusCase={() => setFocus(c.id)}
                  onSecondary={p?.lastResult ? () => goto('result', { caseId: c.id }) : undefined}
                  secondaryLabel="記録"
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
