/**
 * 対戦 (ONLINE VERSUS) — create / join a room → lobby → synchronized countdown → the race
 * (the ordinary case scenes, with the VERSUS HUD) → standings / result. docs/versus.md.
 *
 *   entry      name + 「部屋を作る」 (case, difficulty) / 「部屋に入る」 (6-character code)
 *   lobby      the big room code (copy, 配信用に隠す), players 2–4, case + difficulty, host's start
 *   countdown  3-2-1 to the server's startAt (clock-corrected) → the run token → investigation
 *   race       live standings; back into the case; after a solve / 脱落 the same panel is the result
 *
 * http build only (src/app/scenes.ts compiles it out of the static build).
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Difficulty } from '../../../shared/api';
import { ROOM_CODE_LENGTH, VERSUS_NAME_MAX, type VersusRoomView } from '../../../shared/versus';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { caseList, loadCases } from '../../lib/cases';
import { layout } from '../../lib/viewport';
import { DifficultyBadge } from '../../features/difficulty/Badge';
import { DIFFICULTY_META, DIFFICULTY_ORDER } from '../../features/difficulty/meta';
import { caseNo } from '../../features/investigation/caseData';
import { errorText } from '../../features/versus/client';
import { mountHud } from '../../features/versus/Hud';
import {
  beginRun, clockTick, createRoom, hideCode, initVersus, joinRoom, leaveRoom, resumeRun, savedName, serverNow,
  setHideCode, startRace, vsEnded, vsMe, vsRoom, vsSession,
} from '../../features/versus/session';
import { raceTime, Standings } from '../../features/versus/Standings';
import { Button, IconButton } from '../../ui/Button';
import { Switch } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toast';
import '../../features/versus/versus.css';
import './versus-scene.css';

/* ------------------------------------------------------------------ helpers */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // insecure context / permission: the old way
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function caseLabel(caseId: string): { no: string; title: string } {
  const c = caseList.value?.find((x) => x.id === caseId);
  return { no: `CASE ${caseNo(c?.number)}`, title: c?.title ?? caseId };
}

function Header({ en, jp, onBack }: { en: string; jp: string; onBack?: () => void }) {
  return (
    <header class="vsx__head">
      <div class="vsx__nav">
        <IconButton icon="back" label="タイトルへ" sfx="cancel" onClick={onBack ?? (() => goto('title'))} tooltipSide="right" />
        <span class="eyebrow only-wide">ONLINE VERSUS — ROOM ZERO</span>
      </div>
      <h1 class="vsx__title">
        <span class="vsx__title-jp">{jp}</span>
        <span class="vsx__title-en">{en}</span>
      </h1>
    </header>
  );
}

/* ------------------------------------------------------------------ entry */
function NameField({ value, onInput }: { value: string; onInput: (v: string) => void }) {
  return (
    <label class="vsx-field">
      <span class="vsx-field__label t-label">あなたの名前</span>
      <input
        class="vsx-input"
        type="text"
        value={value}
        maxLength={VERSUS_NAME_MAX * 2}
        autocomplete="nickname"
        placeholder="例：審問官A"
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        data-vs-name
      />
      <span class="vsx-field__hint">1〜{VERSUS_NAME_MAX}文字。ほかの参加者にだけ表示されます。</span>
    </label>
  );
}

function Entry({ joinCode }: { joinCode?: string }) {
  const [name, setName] = useState(savedName);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [code, setCode] = useState((joinCode ?? '').toUpperCase().slice(0, ROOM_CODE_LENGTH));
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(vsEnded.peek());
  const list = caseList.value;
  const chosen = caseId ?? list?.[0]?.id ?? null;
  const nameOk = [...name.trim()].length >= 1 && [...name.trim()].length <= VERSUS_NAME_MAX;

  useEffect(() => {
    void loadCases();
  }, []);

  const run = async (kind: 'create' | 'join') => {
    if (busy) return;
    setError(null);
    setBusy(kind);
    try {
      if (kind === 'create') await createRoom(chosen!, difficulty, name.trim());
      else await joinRoom(code, name.trim());
      audio.sfx('gavel');
    } catch (e) {
      setError(errorText(e));
      audio.sfx('error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="vsx-entry">
      <p class="vsx__lead">
        同じ事件を、同じ瞬間に。<b>先に死因宣告を通した審問官の勝ち</b>です。2〜4人で、それぞれの端末から。
      </p>
      <NameField value={name} onInput={setName} />
      {error && (
        <p class="vsx-error" role="alert">
          <Icon name="alert" size={16} />
          {error}
        </p>
      )}
      {/* arriving through an invite link: 「部屋に入る」 comes first */}
      <div class={`vsx-entry__cols ${joinCode ? 'is-join-first' : ''}`}>
        <section class="vsx-card vsx-card--host" aria-labelledby="vsx-create">
          <header class="vsx-card__head">
            <span class="vsx-card__en t-en">HOST</span>
            <h2 id="vsx-create" class="vsx-card__title">部屋を作る</h2>
          </header>
          <fieldset class="vsx-cases">
            <legend class="t-label">事件</legend>
            {!list && <p class="vsx-muted">事件ファイルを読み込み中…</p>}
            {list?.map((c) => (
              <label key={c.id} class={`vsx-case ${chosen === c.id ? 'is-on' : ''}`} style={{ '--case-accent': c.accent }}>
                <input type="radio" name="vs-case" value={c.id} checked={chosen === c.id} onChange={() => (audio.sfx('toggle'), setCaseId(c.id))} />
                <span class="vsx-case__no t-en">CASE {caseNo(c.number)}</span>
                <span class="vsx-case__title">{c.title}</span>
                <span class="vsx-case__min t-mono">約{c.estimatedMinutes}分</span>
              </label>
            ))}
          </fieldset>
          <fieldset class="vsx-diffs">
            <legend class="t-label">難易度（全員共通）</legend>
            <div class="vsx-diffs__row" role="radiogroup">
              {DIFFICULTY_ORDER.map((d) => {
                const m = DIFFICULTY_META[d];
                return (
                  <label key={d} class={`vsx-diff ${difficulty === d ? 'is-on' : ''}`} data-difficulty={d}>
                    <input type="radio" name="vs-diff" value={d} checked={difficulty === d} onChange={() => (audio.sfx('toggle'), setDifficulty(d))} />
                    <b>{m.jp}</b>
                    <small>
                      {m.modeJp}・灯{m.lives}
                    </small>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Button variant="primary" size="lg" icon="users" block disabled={!nameOk || !chosen || !!busy} aria-busy={busy === 'create'} onClick={() => void run('create')} data-vs-create>
            {busy === 'create' ? '部屋を用意しています…' : '部屋を作る'}
          </Button>
        </section>

        <section class="vsx-card vsx-card--join" aria-labelledby="vsx-join">
          <header class="vsx-card__head">
            <span class="vsx-card__en t-en">JOIN</span>
            <h2 id="vsx-join" class="vsx-card__title">部屋に入る</h2>
          </header>
          <label class="vsx-field">
            <span class="vsx-field__label t-label">部屋コード（6文字）</span>
            <input
              class="vsx-input vsx-input--code"
              type="text"
              inputMode="text"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck={false}
              value={code}
              maxLength={12}
              placeholder="ABC234"
              onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && nameOk && void run('join')}
              data-vs-code
            />
            <span class="vsx-field__hint">ホストから聞いたコード。0・O・1・I・L は使われていません。</span>
          </label>
          <Button variant="ghost" size="lg" icon="chevronRight" block disabled={!nameOk || code.replace(/[\s-]/g, '').length < ROOM_CODE_LENGTH || !!busy} aria-busy={busy === 'join'} onClick={() => void run('join')} data-vs-join>
            {busy === 'join' ? '入室しています…' : '入室する'}
          </Button>
        </section>
      </div>
      <p class="vsx-note">
        <Icon name="info" size={14} />
        対戦の記録は、ひとりで遊ぶときのセーブ・ランク・名探偵度数には残りません。部屋は約3時間で消えます。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ lobby */
function CodeCard({ room }: { room: VersusRoomView }) {
  const hidden = hideCode.value;
  const copy = async (what: 'code' | 'link') => {
    const url = `${location.origin}${location.pathname}#/versus?join=${room.code}`;
    const ok = await copyText(what === 'code' ? room.code : url);
    toast(ok ? (what === 'code' ? '部屋コードをコピーしました' : '招待リンクをコピーしました') : 'コピーできませんでした', { tone: ok ? 'info' : 'warn', icon: ok ? 'check' : 'alert' });
  };
  return (
    <section class="vsx-code" aria-label="部屋コード">
      <span class="vsx-code__label t-en">ROOM CODE</span>
      <p class={`vsx-code__value ${hidden ? 'is-hidden' : ''}`} aria-label={hidden ? '部屋コード（非表示）' : `部屋コード ${room.code.split('').join(' ')}`} data-vs-roomcode={hidden ? undefined : room.code}>
        {(hidden ? '●'.repeat(ROOM_CODE_LENGTH) : room.code).split('').map((ch, i) => (
          <span key={i} class="vsx-code__ch">
            {ch}
          </span>
        ))}
      </p>
      <div class="vsx-code__actions">
        <Button variant="primary" size="sm" icon="copy" onClick={() => void copy('code')} data-vs-copy>
          コードをコピー
        </Button>
        <Button variant="quiet" size="sm" icon="external" onClick={() => void copy('link')}>
          招待リンク
        </Button>
      </div>
      <div class="vsx-code__hide">
        <Switch label="配信用にコードを隠す" description="画面のコードを伏せます（コピーはできます）" checked={hidden} onChange={setHideCode} />
      </div>
    </section>
  );
}

function CaseCard({ room }: { room: VersusRoomView }) {
  const c = caseLabel(room.caseId);
  const d = DIFFICULTY_META[room.difficulty];
  const summary = caseList.value?.find((x) => x.id === room.caseId)?.summary;
  return (
    <section class="vsx-casecard" aria-label="事件と難易度">
      <span class="vsx-casecard__no t-en">{c.no}</span>
      <h2 class="vsx-casecard__title">{c.title}</h2>
      {summary && <p class="vsx-casecard__sum">{summary}</p>}
      <div class="vsx-casecard__diff">
        <DifficultyBadge difficulty={room.difficulty} />
        <span class="vsx-muted">
          {d.modeJp}の死因宣告・やり直しの灯{d.lives}つ。灯が尽きたら脱落。
        </span>
      </div>
    </section>
  );
}

function Players({ room }: { room: VersusRoomView }) {
  const slots = Array.from({ length: room.maxPlayers }, (_, i) => room.players[i]);
  return (
    <section class="vsx-players" aria-label={`参加者 ${room.players.length}/${room.maxPlayers}`}>
      <header class="vsx-players__head">
        <span class="t-en">PLAYERS</span>
        <b>
          {room.players.length}
          <small>/{room.maxPlayers}</small>
        </b>
      </header>
      <ul class="vsx-players__list">
        {slots.map((p, i) =>
          p ? (
            <li key={p.id} class={`vsx-player ${p.you ? 'is-you' : ''}`} style={{ '--i': i }}>
              <span class="vsx-player__idx t-en">P{i + 1}</span>
              <span class="vsx-player__name">{p.name}</span>
              {p.host && (
                <span class="vs-tag">
                  <Icon name="crown" size={12} />
                  ホスト
                </span>
              )}
              {p.you && <span class="vs-tag vs-tag--you">あなた</span>}
            </li>
          ) : (
            <li key={`empty-${i}`} class="vsx-player is-empty">
              <span class="vsx-player__idx t-en">P{i + 1}</span>
              <span class="vsx-player__name">募集中…</span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function Lobby({ room, onLeave }: { room: VersusRoomView; onLeave: () => void }) {
  const me = vsMe.value;
  const [busy, setBusy] = useState(false);
  const enough = room.players.length >= room.minPlayers;
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startRace();
    } catch (e) {
      toast(errorText(e), { tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="vsx-lobby">
      <CodeCard room={room} />
      <div class="vsx-lobby__side">
        <CaseCard room={room} />
        <Players room={room} />
        <div class="vsx-lobby__actions">
          {me?.host ? (
            <Button variant="big-cta" size="lg" icon="gavel" en="START THE INQUEST" block disabled={!enough || busy} onClick={() => void start()} data-vs-start>
              審問を開始
            </Button>
          ) : (
            <p class="vsx-wait" role="status">
              <span class="vsx-wait__dot" aria-hidden="true" />
              ホストの開始を待っています…
            </p>
          )}
          {me?.host && !enough && <p class="vsx-muted">あと1人以上そろうと開始できます。部屋コードを伝えてください。</p>}
          <Button variant="quiet" size="sm" icon="close" sfx="cancel" onClick={onLeave} data-vs-leave>
            {me?.host ? '部屋を閉じる' : '部屋を出る'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ countdown */
function Countdown({ room }: { room: VersusRoomView }) {
  void clockTick.value;
  const left = (room.startAt ?? serverNow()) - serverNow();
  const n = left > 3000 ? '' : left > 0 ? String(Math.ceil(left / 1000)) : '0';
  const numRef = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const c = caseLabel(room.caseId);

  useLayoutEffect(() => {
    const el = numRef.current;
    if (!el || !n || n === '0') return;
    audio.sfx(n === '1' ? 'gavel' : 'stamp');
    if (!motionReduced()) {
      gsap.fromTo(el, { scale: 2.6, opacity: 0, rotation: -14 }, { scale: 1, opacity: 1, rotation: -6, duration: 0.28, ease: 'power4.in' });
      setTimeout(() => fx.shake(n === '1' ? 1.2 : 0.7, 0.3), 260);
    }
  }, [n]);

  useEffect(() => {
    if (n !== '0' || started.current) return;
    started.current = true;
    void fx.cutIn({ lead: 'さァ——', text: '審問開始！', en: 'VERSUS — THE INQUEST BEGINS', tone: 'alarm', character: 'holma', mood: 'laugh', hold: 0.6 });
    void beginRun();
  }, [n]);

  return (
    <div class="vsx-count" role="timer" aria-live="assertive" aria-label={n && n !== '0' ? `開始まで ${n}` : '開始'}>
      <p class="vsx-count__case">
        <span class="t-en">{c.no}</span> {c.title}
        <DifficultyBadge difficulty={room.difficulty} compact />
      </p>
      <div class="vsx-count__mid">
        <div class="vsx-count__band" aria-hidden="true" />
        <span ref={numRef} class={`vsx-count__num t-en ${n === '' ? 'is-ready' : ''}`} key={n}>
          {n === '' ? 'READY' : n === '0' ? 'GO!' : n}
        </span>
      </div>
      <p class="vsx-count__vs">
        {room.players.map((p, i) => (
          <span key={p.id}>
            {i > 0 && <i class="t-en"> VS </i>}
            <b class={p.you ? 'is-you' : ''}>{p.name}</b>
          </span>
        ))}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ race / result */
function Race({ room, onLeave }: { room: VersusRoomView; onLeave: () => void }) {
  const s = vsSession.value;
  const me = vsMe.value;
  const w = room.winner;
  const mine = w?.id === room.you;
  const finished = room.status === 'finished';
  const canPlay = !!s?.running && !me?.out && !me?.left;
  const late = !s?.running && !me?.out && !me?.left;
  const solvedMe = !!me?.rank;
  const [joining, setJoining] = useState(false);
  void clockTick.value;
  const elapsed = room.startAt ? serverNow() - room.startAt : 0;

  return (
    <div class="vsx-race">
      <div class="vsx-race__top">
        <p class="vsx-race__case">
          <span class="t-en">{caseLabel(room.caseId).no}</span> {caseLabel(room.caseId).title}
          <DifficultyBadge difficulty={room.difficulty} compact />
        </p>
        {!finished && (
          <p class="vsx-race__clock t-mono" aria-label="経過時間">
            {raceTime(elapsed)}
          </p>
        )}
      </div>
      {w ? (
        <section class={`vsx-winner ${mine ? 'is-mine' : ''}`} aria-live="polite" data-vs-winner={w.name}>
          <Icon name="crown" size={34} class="vsx-winner__crown" />
          <div class="vsx-winner__body">
            <span class="vsx-winner__en t-en">{mine ? 'VICTORY' : 'FIRST TO THE TRUTH'}</span>
            <p class="vsx-winner__line">{mine ? '勝利！ あなたが先に真相にたどり着いた！' : `${w.name}が先に真相にたどり着いた！`}</p>
          </div>
          <span class="vsx-winner__time t-mono">{raceTime(w.ms, true)}</span>
        </section>
      ) : (
        <section class="vsx-winner is-pending">
          <Icon name="gavel" size={28} class="vsx-winner__crown" />
          <div class="vsx-winner__body">
            <span class="vsx-winner__en t-en">RACE IN PROGRESS</span>
            <p class="vsx-winner__line">最初に死因宣告を通した人が勝ち。</p>
          </div>
        </section>
      )}
      <Standings room={room} />
      <div class="vsx-race__actions">
        {canPlay && (
          <Button
            variant={solvedMe || me?.out ? 'ghost' : 'big-cta'}
            size="lg"
            icon="play"
            block
            onClick={() => {
              if (!resumeRun()) toast('この画面には対戦の記録が残っていません（別のタブで遊んでいた場合など）。', { tone: 'warn' });
            }}
            data-vs-resume
          >
            {solvedMe ? '事件の続きへ' : '捜査に戻る'}
          </Button>
        )}
        {canPlay && solvedMe && <p class="vsx-muted">真相の再構成・身元回復・科学解剖まで、ひとりのときと同じように続けられます。</p>}
        {late && (
          <Button
            variant="big-cta"
            size="lg"
            icon="play"
            block
            disabled={joining}
            onClick={() => {
              setJoining(true);
              void beginRun().finally(() => setJoining(false));
            }}
          >
            途中から参加する
          </Button>
        )}
        {me?.out && <p class="vsx-muted">脱落しました。ほかの審問官の結果を見届けましょう。</p>}
        <Button variant="quiet" size="sm" icon="close" sfx="cancel" onClick={onLeave} data-vs-leave>
          部屋を出る
        </Button>
      </div>
      <p class="vsx-note">
        <Icon name="info" size={14} />
        対戦の記録は、ひとりで遊ぶときのセーブ・ランク・名探偵度数には残りません。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ scene */
export function VersusScene({ params }: SceneProps) {
  useEffect(() => initVersus(mountHud), []);
  const s = vsSession.value;
  const room = vsRoom.value;
  const narrow = layout.value === 'narrow';
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [leaving, setLeaving] = useState(false);
  void clockTick.value;

  useEffect(() => {
    void loadCases();
  }, []);

  const inCountdown =
    !!room && !!s && !s.running && !vsMe.value?.out && (room.status === 'countdown' || (room.status === 'playing' && !!room.startAt && serverNow() - room.startAt < 2500));
  const view: 'entry' | 'connecting' | 'lobby' | 'countdown' | 'race' = !s
    ? 'entry'
    : !room
      ? 'connecting'
      : room.status === 'lobby'
        ? 'lobby'
        : inCountdown
          ? 'countdown'
          : 'race';

  const heading =
    view === 'entry'
      ? { jp: '対戦', en: 'ONLINE VERSUS' }
      : view === 'lobby' || view === 'connecting'
        ? { jp: '対戦ロビー', en: 'VERSUS LOBBY' }
        : room?.status === 'finished'
          ? { jp: '対戦結果', en: 'VERSUS RESULT' }
          : { jp: '対戦中', en: 'VERSUS — LIVE' };

  const leave = async () => {
    setLeaving(true);
    await leaveRoom();
    setLeaving(false);
    setLeaveAsk(false);
    audio.sfx('cancel');
  };
  const raceOn = room && room.status !== 'lobby' && room.status !== 'finished' && !vsMe.value?.out && !vsMe.value?.rank;

  return (
    <section class={`scene vsx is-${view}`} data-vs-view={view}>
      <div class="vsx__bg" aria-hidden="true">
        <div class="vsx__stripes" />
        <span class="vsx__outline t-en">VERSUS</span>
      </div>
      {view === 'countdown' && room ? (
        <Countdown room={room} />
      ) : (
        <div class="page vsx__page" key={view}>
          <div class="page__inner">
            <Header jp={heading.jp} en={heading.en} />
            {view === 'entry' && <Entry joinCode={params.join} />}
            {view === 'connecting' && (
              <p class="vsx-muted vsx-connecting" role="status">
                部屋に接続しています…
              </p>
            )}
            {view === 'lobby' && room && <Lobby room={room} onLeave={() => setLeaveAsk(true)} />}
            {view === 'race' && room && <Race room={room} onLeave={() => setLeaveAsk(true)} />}
          </div>
        </div>
      )}
      <Modal
        open={leaveAsk}
        onClose={() => setLeaveAsk(false)}
        title={view === 'lobby' && vsMe.value?.host ? '部屋を閉じますか？' : '部屋を出ますか？'}
        en="LEAVE THE ROOM"
        size="sm"
        tone="alarm"
        footer={
          <div class="vs-modal__foot">
            <Button variant="ghost" size={narrow ? 'sm' : 'md'} onClick={() => setLeaveAsk(false)} data-autofocus>
              やめる
            </Button>
            <Button variant="danger" size={narrow ? 'sm' : 'md'} icon="close" disabled={leaving} onClick={() => void leave()} data-vs-leave-confirm>
              {view === 'lobby' && vsMe.value?.host ? '閉じる' : '出る'}
            </Button>
          </div>
        }
      >
        <p>
          {view === 'lobby'
            ? vsMe.value?.host
              ? 'ほかの参加者も部屋から外れます。'
              : 'もう一度入るには、部屋コードが必要です。'
            : raceOn
              ? '対戦の途中です。出ると、この対戦には戻れません（順位表には「退出」と残ります）。'
              : 'この対戦から抜けます。結果はもう見られなくなります。'}
        </p>
      </Modal>
    </section>
  );
}
