/** Small shared pieces for the ending scenes (loading / error panels, section chrome). */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { goto } from '../../app/router';
import { restartCaseAfterBadToken } from '../../features/investigation/caseData';
import { getCaseProgress, setStage } from '../../state/save';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import type { SolutionError } from './solution';
import './common.css';

export function EndingLoading({ label = '記録を開いています' }: { label?: string }) {
  return (
    <section class="scene end-state" aria-busy="true">
      <div class="end-state__box">
        <span class="end-state__spinner" aria-hidden="true" />
        <p class="end-state__label t-mono">{label}…</p>
      </div>
    </section>
  );
}

const ERROR_TEXT: Record<SolutionError, { title: string; body: string }> = {
  unsolved: { title: 'この事件は、まだ閉じていません', body: '死因の宣告が通ると、この部屋が開きます。審問へ戻りましょう。' },
  bad_token: {
    title: '記録が読めませんでした',
    body: '進行の記録を確かめられませんでした（期限が切れたか、記録が書き換わっています）。この事件は最初から捜査し直せます。最高ランクと解決回数は残ります。',
  },
  network: { title: '記録を取り寄せられませんでした', body: '通信が不安定なようです。少し待ってから、もう一度お試しください。' },
  server: { title: '記録を取り寄せられませんでした', body: '安置室の書庫で問題が起きました。少し待ってから、もう一度お試しください。' },
};

/**
 * Error panel of the ending scenes. Every reason offers a way forward that does NOT lead back
 * to this same panel: a bad token restarts the case with a fresh token (openCase would route
 * to the same ending scene again), an unsolved token goes back to the inquest.
 */
export function EndingError({ caseId, reason, onRetry }: { caseId: string; reason: SolutionError; onRetry: () => void }) {
  const t = ERROR_TEXT[reason];
  const [busy, setBusy] = useState(false);

  const restart = async () => {
    if (busy) return;
    setBusy(true);
    await restartCaseAfterBadToken(caseId); // never throws; the investigation scene retries the token itself
    goto('investigation', { caseId });
  };
  const backToInquest = () => {
    if (!getCaseProgress(caseId)?.token) return void restart();
    setStage(caseId, 'inquest');
    goto('inquest', { caseId });
  };

  return (
    <section class="scene end-state" role="alert">
      <div class="end-state__box end-state__box--error">
        <div class="end-state__holma" aria-hidden="true">
          <HolmaSprite mood="serious" framing="bust" />
        </div>
        <div>
          <p class="eyebrow">RECORD UNAVAILABLE</p>
          <h1 class="end-state__title">{t.title}</h1>
          <p class="end-state__body">{t.body}</p>
          <div class="row row--wrap" style={{ marginTop: 16 }}>
            {(reason === 'network' || reason === 'server') && (
              <Button icon="refresh" onClick={onRetry} data-autofocus>
                もう一度
              </Button>
            )}
            {reason === 'bad_token' && (
              <Button icon="refresh" onClick={restart} disabled={busy} aria-busy={busy} data-autofocus>
                この事件を最初からやり直す
              </Button>
            )}
            {reason === 'unsolved' && (
              <Button icon="gavel" onClick={backToInquest} data-autofocus>
                審問に戻る
              </Button>
            )}
            <Button variant="ghost" icon="tag" sfx="cancel" onClick={() => goto('files')}>
              事件ファイルへ
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Section heading used by the long-form pages: EN kicker + JP title + number. */
export function SectionHead({ num, en, jp, id }: { num?: string; en: string; jp: ComponentChildren; id?: string }) {
  return (
    <header class="sec-head">
      {num && <span class="sec-head__num t-mono">{num}</span>}
      <span class="sec-head__en">{en}</span>
      <h2 class="sec-head__jp" id={id}>
        {jp}
      </h2>
    </header>
  );
}
