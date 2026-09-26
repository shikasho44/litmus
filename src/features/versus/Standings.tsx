/**
 * Versus standings — who is where, from the room view (aggregate progress only).
 * Used by the versus screen (lobby → result panel) and the HUD's standings sheet.
 */
import type { VersusPlayerView, VersusRoomView, VersusStage } from '../../../shared/versus';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';

export const STAGE_META: Record<VersusStage, { jp: string; en: string; icon: IconName }> = {
  lobby: { jp: '待機', en: 'READY', icon: 'users' },
  investigation: { jp: '捜査', en: 'INVESTIGATION', icon: 'evidence' },
  inquest: { jp: '審問', en: 'INQUEST', icon: 'gavel' },
  solved: { jp: '解明', en: 'SOLVED', icon: 'crown' },
};

/** mm:ss (h:mm:ss past an hour), tenths when asked. */
export function raceTime(ms: number, tenths = false): string {
  const t = Math.max(0, ms);
  const s = Math.floor(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
  return tenths ? `${base}.${Math.floor((t % 1000) / 100)}` : base;
}

/** Ranked first (by rank), then still playing (by progress), then 脱落 / 退出. */
export function orderPlayers(players: VersusPlayerView[]): VersusPlayerView[] {
  const group = (p: VersusPlayerView) => (p.rank ? 0 : p.left ? 3 : p.out ? 2 : 1);
  return [...players].sort((a, b) => group(a) - group(b) || (a.rank ?? 0) - (b.rank ?? 0) || b.progress - a.progress || a.asked - b.asked);
}

export function statusLabel(p: VersusPlayerView): { jp: string; tone: 'win' | 'done' | 'play' | 'out' | 'idle' } {
  if (p.rank === 1) return { jp: '勝利', tone: 'win' };
  if (p.rank) return { jp: `${p.rank}位`, tone: 'done' };
  if (p.left) return { jp: '退出', tone: 'idle' };
  if (p.out) return { jp: '脱落', tone: 'out' };
  return { jp: STAGE_META[p.stage].jp, tone: p.stage === 'lobby' ? 'idle' : 'play' };
}

/** crown for the solvers, a cross for 脱落, a way-out arrow for 退出, else the stage. */
export function stateIcon(p: VersusPlayerView): IconName {
  if (p.rank) return 'crown';
  if (p.left) return 'back';
  if (p.out) return 'cross';
  return STAGE_META[p.stage].icon;
}

export function ProgressBar({ value, tone = 'play' }: { value: number; tone?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span class={`vs-bar vs-bar--${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`解明度 ${pct}%`}>
      <span class="vs-bar__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Standings({ room, compact }: { room: VersusRoomView; compact?: boolean }) {
  const rows = orderPlayers(room.players);
  const started = room.status !== 'lobby';
  return (
    <ol class={`vs-standings ${compact ? 'is-compact' : ''}`} aria-label="順位">
      {rows.map((p, i) => {
        const st = statusLabel(p);
        return (
          <li key={p.id} class={`vs-row is-${st.tone} ${p.you ? 'is-you' : ''} ${p.online || !started ? '' : 'is-offline'}`} style={{ '--i': i }}>
            <span class="vs-row__rank t-en" aria-label={p.rank ? `${p.rank}位` : '順位なし'}>
              {p.rank === 1 ? <Icon name="crown" size={22} /> : p.rank ? p.rank : '—'}
            </span>
            <span class="vs-row__who">
              <span class="vs-row__name">{p.name}</span>
              <span class="vs-row__tags">
                {p.you && <span class="vs-tag vs-tag--you">あなた</span>}
                {p.host && <span class="vs-tag">ホスト</span>}
                {started && !p.online && !p.left && <span class="vs-tag vs-tag--dim">通信待ち</span>}
                {p.left && p.rank && <span class="vs-tag vs-tag--dim">退出</span>}
              </span>
            </span>
            {started && (
              <span class="vs-row__state">
                <span class={`vs-state is-${st.tone}`}>
                  <Icon name={stateIcon(p)} size={14} />
                  {st.jp}
                </span>
                <ProgressBar value={p.progress} tone={st.tone} />
              </span>
            )}
            {started && (
              <span class="vs-row__time t-mono" aria-label="タイム">
                {p.finishMs !== undefined ? raceTime(p.finishMs, true) : '--:--'}
              </span>
            )}
            {started && (
              <span class="vs-row__q t-mono" aria-label="質問数">
                <small>Q</small>
                {p.asked}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
