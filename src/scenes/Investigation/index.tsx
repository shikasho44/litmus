/**
 * 捜査 (INVESTIGATION) — the heart of the game. Free-typed yes/no questions to Holma, the
 * judgement stamp, findings flying into the notebook, Jane's shards lighting up.
 * Logic lives in src/features/investigation (controller + components) and
 * src/features/notebook. See docs/design-bible.md §3-1 / §4.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { closeOverlay, goto, openOverlay, overlay, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { pickLine, type ResolvedLine } from '../../lib/lines';
import { layout, viewportSize } from '../../lib/viewport';
import { useCaseProgress, useCaseTimer } from '../../state/hooks';
import { addFacts, getCaseProgress, setStage } from '../../state/save';
import { Button } from '../../ui/Button';
import { dialogOpenCount } from '../../ui/dialog';
import { Icon } from '../../ui/Icon';
import { StageLayout } from '../../ui/StageLayout';
import { ensureToken, useCasePublic } from '../../features/investigation/caseData';
import { ChatLog } from '../../features/investigation/ChatLog';
import { createController } from '../../features/investigation/controller';
import { HintConfirm, InquestConfirm, MenuDialog, TokenTroubleDialog } from '../../features/investigation/Dialogs';
import { FindingFlight } from '../../features/investigation/FindingFlight';
import { InputDock } from '../../features/investigation/InputDock';
import { StageView } from '../../features/investigation/StageView';
import { TopBar } from '../../features/investigation/TopBar';
import { WhisperOverlay } from '../../features/investigation/WhisperOverlay';
import { Notebook, unseenFacts } from '../../features/notebook/Notebook';
import '../../features/investigation/investigation.css';

const SIDE_PREF = 'janedoe:notebook-side';
const draftKey = (caseId: string) => `janedoe:draft:${caseId}`;

function readSidePref(): boolean | null {
  try {
    const v = localStorage.getItem(SIDE_PREF);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}
function writeSidePref(open: boolean) {
  try {
    localStorage.setItem(SIDE_PREF, open ? '1' : '0');
  } catch {
    /* per-viewer convenience only */
  }
}

/** Elapsed play time that ticks every second between the 5 s save commits. */
function useLiveElapsed(ms: number) {
  const base = useRef({ ms, at: performance.now() });
  if (base.current.ms !== ms) base.current = { ms, at: performance.now() };
  const [, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const extra = document.visibilityState === 'visible' ? Math.min(6000, performance.now() - base.current.at) : 0;
  return ms + extra;
}

const isTyping = (el: Element | null) => !!el?.closest('input, textarea, select, [contenteditable="true"]');

export function InvestigationScene({ params }: SceneProps) {
  const caseId = params.caseId!;
  const progress = useCaseProgress(caseId).value;
  const { data: pub, status, retry } = useCasePublic(caseId);
  const ctl = useMemo(() => createController(caseId), [caseId]);
  useCaseTimer(caseId);
  const elapsed = useLiveElapsed(progress?.elapsedMs ?? 0);
  const narrow = layout.value === 'narrow';
  const vh = viewportSize.value.h;
  const [sideOpen, setSideOpen] = useState(() => readSidePref() ?? window.innerWidth >= 1200);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [inquest, setInquest] = useState<{ line: ResolvedLine; low: boolean } | null>(null);
  const inputId = `iv-input-${caseId}`;
  const cachedStarters = useRef<string[]>([]);
  cachedStarters.current = pub?.starterQuestions ?? [];

  /* ---------- boot ---------- */
  useEffect(() => {
    const c = getCaseProgress(caseId);
    if (!c?.snapshot?.solved) setStage(caseId, 'investigation');
    ctl.syncFromSave();
    try {
      const d = localStorage.getItem(draftKey(caseId));
      if (d) ctl.inputText.value = d;
    } catch {
      /* ignore */
    }
    return () => ctl.dispose();
  }, [ctl]);

  useEffect(() => {
    ctl.setPub(pub);
    if (!pub) return;
    void ensureToken(caseId, pub).then((ok) => {
      // The server grants the starting facts with every token; a record made elsewhere
      // (dev shortcut, imported save) may lack their cards → the chat intro would promise
      // 「捜査ノートに記録済み」 over an empty notebook.
      const c = getCaseProgress(caseId);
      if (!ok || !c?.token) return;
      const missing = pub.startingFacts.filter((f) => !c.facts[f.id]);
      if (!missing.length) return;
      addFacts(caseId, missing);
      ctl.setPub(pub); // recount Jane's shards with the restored cards
    });
  }, [pub]);

  // keep the unsent draft (per-viewer convenience)
  useEffect(
    () =>
      ctl.inputText.subscribe((v) => {
        try {
          if (v) localStorage.setItem(draftKey(caseId), v);
          else localStorage.removeItem(draftKey(caseId));
        } catch {
          /* ignore */
        }
      }),
    [ctl],
  );

  /* ---------- notebook ---------- */
  const sheetOpen = overlay.value?.name === 'sheet';
  const notebookOpen = narrow ? sheetOpen : sideOpen;
  /** Notebook empty state: an example question fills the input (never sends). */
  const pickQuestion = (q: string) => {
    ctl.inputText.value = q.slice(0, 200);
    ctl.touch();
    audio.sfx('page');
    if (overlay.peek()?.name === 'sheet') closeOverlay();
    setTimeout(() => {
      const el = document.getElementById(inputId) as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }, 60);
  };
  const openSheet = () =>
    openOverlay('sheet', {
      title: '捜査ノート',
      en: 'NOTEBOOK',
      side: 'bottom',
      render: () => <Notebook caseId={caseId} arriving={ctl.arriving} variant="sheet" starters={cachedStarters.current} onPickQuestion={pickQuestion} />,
    });
  const toggleNotebook = () => {
    ctl.touch();
    if (narrow) {
      if (sheetOpen) closeOverlay();
      else openSheet();
      return;
    }
    const next = !sideOpen;
    setSideOpen(next);
    writeSidePref(next);
    audio.sfx(next ? 'open' : 'close');
  };

  /* ---------- inquest / hint / menu ---------- */
  const openInquestConfirm = () => {
    if (ctl.asking.peek() || ctl.presenting.peek()) return;
    ctl.touch();
    const c = getCaseProgress(caseId);
    const facts = c ? c.factOrder.map((id) => c.facts[id]).filter(Boolean) : [];
    const important = facts.filter((f) => f.importance >= 2).length;
    const low = ctl.shownProgress.peek() < 0.35 || important < 5;
    setInquest({ line: pickLine(low ? 'investigation.inquestConfirmLow' : 'investigation.inquestConfirm', low ? 'surprised' : 'normal'), low });
  };
  const startInquest = () => {
    setInquest(null);
    audio.sfx('gavel');
    fx.shake(0.8);
    setStage(caseId, 'inquest');
    goto('inquest', { caseId });
  };
  const hintsUsed = progress?.snapshot?.hintsUsed ?? progress?.hints.length ?? 0;
  const hintTotal = pub?.hintCount ?? 3;

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      ctl.touch();
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (ctl.whisper.peek()) return;
      const typing = isTyping(document.activeElement);
      const k = e.key;
      if (overlay.peek()?.name === 'sheet') {
        if ((k === 'n' || k === 'N') && !typing) {
          e.preventDefault();
          closeOverlay();
        }
        return;
      }
      if (dialogOpenCount() > 0 || overlay.peek()) return;
      if (k === 'Escape') {
        if (ctl.idleLine.peek()) ctl.idleLine.value = null;
        if (ctl.presenting.peek()) ctl.fastForward();
        return;
      }
      if (typing) return;
      if (k === '/') {
        e.preventDefault();
        document.getElementById(inputId)?.focus();
      } else if (k === 'n' || k === 'N') {
        e.preventDefault();
        toggleNotebook();
      } else if (k === 'h' || k === 'H') {
        e.preventDefault();
        setHintOpen(true);
      } else if ((k === 'Enter' || k === ' ') && ctl.presenting.peek() && !document.activeElement?.closest('button, a')) {
        e.preventDefault();
        ctl.fastForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl, narrow, sideOpen, sheetOpen]);

  /* ---------- idle ---------- */
  useEffect(() => {
    const iv = setInterval(() => ctl.idleCheck(dialogOpenCount() > 0 || !!overlay.peek() || menuOpen || hintOpen || !!inquest), 3000);
    return () => clearInterval(iv);
  }, [ctl, menuOpen, hintOpen, inquest]);

  const log = progress?.log ?? [];
  const empty = !log.some((e) => e.kind === 'question');
  const newFacts = unseenFacts(progress, ctl.arriving.value).length;
  const bottomHeight = vh < 780 ? 290 : 370;

  const stageNode =
    status === 'error' && !pub ? (
      <div class="iv-error">
        <Icon name="alert" size={28} />
        <p class="iv-error__title">事件ファイルを開けませんでした</p>
        <p class="iv-error__text">通信が不安定なようです。少し待ってから、もう一度お試しください。</p>
        <div class="row" style={{ justifyContent: 'center' }}>
          <Button icon="refresh" onClick={retry}>
            再読み込み
          </Button>
          <Button variant="ghost" icon="back" sfx="cancel" onClick={() => goto('files')}>
            事件ファイルへ
          </Button>
        </div>
      </div>
    ) : (
      <StageView ctl={ctl} pub={pub} progress={progress} elapsed={elapsed} />
    );

  return (
    <section class={`scene iv ${ctl.presenting.value ? 'is-presenting' : ''}`} onPointerDown={() => ctl.touch()}>
      <StageLayout
        stageFit="fill"
        bottomHeight={bottomHeight}
        background={pub?.background}
        tone="formalin"
        stageClass="iv__stage"
        side={<Notebook caseId={caseId} arriving={ctl.arriving} variant="side" onCollapse={toggleNotebook} starters={pub?.starterQuestions} onPickQuestion={pickQuestion} />}
        sideOpen={sideOpen}
        top={
          <TopBar
            ctl={ctl}
            pub={pub}
            progress={progress}
            elapsed={elapsed}
            newFacts={newFacts}
            notebookOpen={notebookOpen}
            onMenu={() => setMenuOpen(true)}
            onHint={() => setHintOpen(true)}
            onNotebook={toggleNotebook}
            onInquest={openInquestConfirm}
          />
        }
        stage={stageNode}
        bottom={<ChatLog ctl={ctl} progress={progress} pub={pub} />}
        dock={<InputDock ctl={ctl} starters={pub?.starterQuestions ?? []} empty={empty} disabled={!pub} inputId={inputId} />}
      />
      <WhisperOverlay ctl={ctl} />
      <FindingFlight ctl={ctl} />
      <InquestConfirm
        open={!!inquest}
        onClose={() => setInquest(null)}
        onConfirm={startInquest}
        line={inquest?.line ?? { text: '', mood: 'normal' }}
        low={!!inquest?.low}
        progress={progress}
      />
      <HintConfirm
        open={hintOpen}
        onClose={() => setHintOpen(false)}
        used={hintsUsed}
        total={hintTotal}
        hints={progress?.hints ?? []}
        busy={ctl.hintBusy.value}
        onConfirm={() => {
          setHintOpen(false);
          void ctl.requestHint();
        }}
        onReread={(lv) => {
          setHintOpen(false);
          ctl.showWhisperAgain(lv);
        }}
      />
      <TokenTroubleDialog
        open={!!ctl.tokenTrouble.value}
        onClose={() => void ctl.resolveTokenTrouble('dismiss')}
        onRetry={() => void ctl.resolveTokenTrouble('retry')}
        onRestart={() => void ctl.resolveTokenTrouble('restart')}
      />
      <MenuDialog
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSettings={() => {
          setMenuOpen(false);
          setTimeout(() => openOverlay('settings'), 60);
        }}
        onHowTo={() => {
          setMenuOpen(false);
          setTimeout(() => openOverlay('howto'), 60);
        }}
        onReplayIntro={() => {
          setMenuOpen(false);
          goto('intro', { caseId, replay: '1' });
        }}
        onFiles={() => {
          setMenuOpen(false);
          goto('files');
        }}
        onTitle={() => {
          setMenuOpen(false);
          goto('title');
        }}
      />
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {ctl.announce.value}
      </p>
    </section>
  );
}
