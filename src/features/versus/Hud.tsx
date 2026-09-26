/**
 * VERSUS HUD — a slim strip above the case scenes during a race: the race clock and, for every
 * opponent, name · 解明度 bar · stage · question count. The scene host moves down by the strip's
 * height (#app[data-vs-hud]), so it never covers gameplay text. Tapping it opens the standings.
 * Rendered in its own root next to the app (mountHud) — the case scenes know nothing about it.
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { CASE_SCENES, goto, route } from '../../app/router';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { clockTick, serverNow, vsConn, vsRoom, vsSession } from './session';
import { slotCase } from './slot';
import { ProgressBar, raceTime, Standings, stateIcon, statusLabel } from './Standings';
import './versus.css';

function useHudVisible(): boolean {
  const r = route.value;
  const id = slotCase.value;
  return !!id && !!vsSession.value && CASE_SCENES.includes(r.scene) && r.params.caseId === id;
}

function RaceClock({ startAt }: { startAt?: number }) {
  void clockTick.value;
  const ms = startAt ? serverNow() - startAt : 0;
  return <span class="vs-hud__clock t-mono">{raceTime(ms)}</span>;
}

export function VersusHud() {
  const visible = useHudVisible();
  const room = vsRoom.value;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const app = document.getElementById('app');
    if (!app) return;
    if (visible) app.dataset.vsHud = 'on';
    else delete app.dataset.vsHud;
  }, [visible]);

  if (!visible || !room) return null;
  const others = room.players.filter((p) => !p.you);
  const winner = room.winner;
  const mine = winner?.id === room.you;

  return (
    <>
      <div class={`vs-hud ${winner ? 'has-winner' : ''}`} role="region" aria-label="対戦の状況">
        <button type="button" class="vs-hud__lead" onClick={() => setOpen(true)} aria-label="対戦の順位を見る">
          <span class="vs-hud__vs t-en">VS</span>
          {winner ? (
            <span class={`vs-hud__win ${mine ? 'is-mine' : ''}`}>
              <Icon name="crown" size={14} />
              <span class="vs-hud__win-name">{mine ? 'あなた' : winner.name}</span>
            </span>
          ) : (
            <RaceClock startAt={room.startAt} />
          )}
          {vsConn.value === 'retrying' && <span class="vs-hud__conn" title="再接続中" aria-label="再接続中" />}
        </button>
        <ul class="vs-hud__list" style={{ '--n': Math.max(1, others.length) }}>
          {others.map((p) => {
            const st = statusLabel(p);
            return (
              <li key={p.id} class={`vs-chip is-${st.tone} ${p.online || p.left ? '' : 'is-offline'}`}>
                <button type="button" class="vs-chip__btn" onClick={() => setOpen(true)} aria-label={`${p.name}：${st.jp}、解明度${Math.round(p.progress * 100)}%、質問${p.asked}`}>
                  <span class="vs-chip__top">
                    <Icon name={stateIcon(p)} size={13} class="vs-chip__icon" />
                    <span class="vs-chip__name">{p.name}</span>
                    <span class="vs-chip__st">{st.jp}</span>
                  </span>
                  <span class="vs-chip__bottom">
                    <ProgressBar value={p.progress} tone={st.tone} />
                    <span class="vs-chip__q t-mono">Q{p.asked}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="対戦の順位" en="VERSUS STANDINGS" size="md" tone="alarm"
        footer={
          <div class="vs-modal__foot">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              閉じる
            </Button>
            <Button variant="primary" size="sm" icon="users" onClick={() => { setOpen(false); goto('versus'); }} data-vs-room>
              対戦の部屋へ
            </Button>
          </div>
        }
      >
        <p class="vs-modal__lead">
          {winner ? (mine ? 'あなたが一番に真相へたどり着きました。' : `${winner.name}が一番に真相へたどり着きました。`) : '最初に死因宣告を通した人が勝ちです。'}
          {' '}最後まで解いた人は、解いた順に並びます。
        </p>
        <Standings room={room} />
      </Modal>
    </>
  );
}

let mounted = false;
let waiting = false;
/**
 * Mounts the HUD in its own root inside #app — on a later frame, never synchronously: a render
 * of another root inside a component's render would break that component's hooks, and Preact's
 * first render into #app would adopt (and then drop) a foreign <div> it found there.
 */
export function mountHud() {
  if (mounted || waiting || typeof document === 'undefined') return;
  waiting = true;
  requestAnimationFrame(() => {
    waiting = false;
    const app = document.getElementById('app');
    if (!app?.querySelector('.app-shell')) {
      mountHud(); // the app shell is not rendered yet: try again next frame
      return;
    }
    if (!mounted) doMount(app);
  });
}

function doMount(app: HTMLElement) {
  mounted = true;
  const el = document.createElement('div');
  el.id = 'vs-hud-root';
  app.appendChild(el);
  render(<VersusHud />, el);
}
