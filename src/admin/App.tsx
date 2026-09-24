/** Admin console shell: auth gate, side navigation, section host. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { Badge, Btn, ErrorBox } from './components';
import { fmtAgo } from './format';
import { auth, authError, cases, connect, go, hasToken, health, healthFailure, lastRefresh, refreshAll, route, SECTIONS, signIn, signOut, status } from './store';
import { OverviewSection } from './sections/Overview';
import { CasesSection } from './sections/Cases';
import { AskSection } from './sections/Ask';
import { TracesSection } from './sections/Traces';
import { BenchSection } from './sections/Bench';
import { TokenSection } from './sections/Token';

function useNow(ms = 5000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Brand() {
  return (
    <div class="adm-brand">
      <span class="adm-brand__en">ROOM ZERO</span>
      <span class="adm-brand__jp">管理コンソール</span>
      <span class="adm-brand__tape" aria-hidden="true" />
    </div>
  );
}

function Gate() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const h = health.value;
  const state = auth.value;
  return (
    <div class="adm-gate">
      <div class="adm-gate__card">
        <Brand />
        {state === 'checking' && <p class="adm-dim">サーバーに接続しています…</p>}
        {state === 'offline' && (
          <>
            <ErrorBox>
              管理 API に接続できません: {authError.value}
              <br />
              静的版（<code>--mode static</code>）には API がありません。<code>npm run dev</code> か <code>npm run preview</code> で開いてください。
            </ErrorBox>
            <Btn icon="refresh" onClick={() => void connect()}>
              再接続
            </Btn>
          </>
        )}
        {state === 'need-token' && (
          <form
            class="adm-gate__form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!value.trim()) {
                // The button stays live (a dimmed primary reads as broken); an empty submit
                // explains itself instead.
                setEmpty(true);
                inputRef.current?.focus();
                return;
              }
              setBusy(true);
              await signIn(value);
              setBusy(false);
            }}
          >
            <p>
              本番サーバーの管理 API は <code>ADMIN_TOKEN</code> が必要です。入力したトークンはこのタブの <code>sessionStorage</code> にだけ保存され、
              <code>x-admin-token</code> ヘッダーで送られます。
            </p>
            {authError.value && <ErrorBox>{authError.value}</ErrorBox>}
            <label class={`adm-field ${empty ? 'is-invalid' : ''}`}>
              <span class="adm-field__label">ADMIN_TOKEN</span>
              <input
                ref={inputRef}
                type="password"
                autocomplete="off"
                spellcheck={false}
                value={value}
                onInput={(e) => {
                  setValue((e.target as HTMLInputElement).value);
                  setEmpty(false);
                }}
                placeholder="管理トークン"
                aria-invalid={empty || undefined}
                aria-describedby={empty ? 'adm-gate-empty' : undefined}
                autofocus
              />
              {empty && (
                <span class="adm-field__hint adm-warn-text" id="adm-gate-empty">
                  トークンを入力してください。
                </span>
              )}
            </label>
            <Btn variant="primary" icon="lock" type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? '確認中…' : '接続'}
            </Btn>
          </form>
        )}
        {h ? (
          <p class="adm-gate__health adm-small adm-dim">
            {/* public health is liveness only; mode / cases appear once the token is accepted */}
            /api/health: <span class={h.ok ? 'adm-ok-text' : 'adm-bad-text'}>{h.ok ? '応答あり' : '異常'}</span>
            {h.mode && (
              <>
                {' '}
                · mode <b class="adm-mono">{h.mode}</b>
              </>
            )}
            {h.cases !== undefined && <> · 事件 {h.cases}</>}
            {h.dev !== undefined && <> · {h.dev ? 'development' : 'production'}</>} · API v{h.version}
          </p>
        ) : (
          healthFailure.value === 503 && (
            <p class="adm-gate__health adm-small adm-bad-text">/api/health: 503 — 本番サーバーの設定に不備があります（SESSION_SECRET の未設定・短すぎ など）。</p>
          )
        )}
        <a class="adm-link adm-small" href="./">
          ← ゲームに戻る
        </a>
      </div>
    </div>
  );
}

/**
 * On phones the section menu becomes a horizontal strip. Keep the current tab in view and fade
 * whichever edge still has tabs beyond it, so a cut-off tab reads as "scroll for more".
 */
function useNavStrip(section: string) {
  const ref = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const first = useRef(true);
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    const measure = () => {
      const max = n.scrollWidth - n.clientWidth;
      const l = max > 1 && n.scrollLeft > 2;
      const r = max > 1 && n.scrollLeft < max - 2;
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
    };
    n.addEventListener('scroll', measure, { passive: true });
    // Tabs change width after load (the case-issue badge), which fires no scroll/resize event.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    if (ro) for (const el of [n, ...Array.from(n.children)]) ro.observe(el);
    else window.addEventListener('resize', measure);
    measure();
    return () => {
      n.removeEventListener('scroll', measure);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  useEffect(() => {
    const n = ref.current;
    const on = n?.querySelector<HTMLElement>('.is-on');
    if (!n || !on || n.scrollWidth <= n.clientWidth + 1) return;
    const a = on.getBoundingClientRect();
    const b = n.getBoundingClientRect();
    const left = n.scrollLeft + (a.left - b.left) - (b.width - a.width) / 2;
    const calm = first.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    n.scrollTo({ left: Math.max(0, left), behavior: calm ? 'auto' : 'smooth' });
    first.current = false;
  }, [section]);
  return { ref, cls: `${edge.l ? 'has-more-l' : ''} ${edge.r ? 'has-more-r' : ''}` };
}

function Side() {
  const r = route.value;
  const s = status.value;
  const strip = useNavStrip(r.section);
  const issues = (cases.value?.issues ?? []).filter((i) => i.level === 'error').length + (cases.value?.cases ?? []).filter((c) => !c.validation.ok).length;
  return (
    <aside class="adm-side">
      <Brand />
      <nav class={`adm-nav ${strip.cls}`} aria-label="セクション" ref={strip.ref}>
        {SECTIONS.map((x) => (
          <a
            key={x.id}
            href={`#/${x.id}`}
            class={`adm-nav__item ${r.section === x.id ? 'is-on' : ''}`}
            aria-current={r.section === x.id ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(x.id);
            }}
          >
            <Icon name={x.icon} size={18} />
            <span class="adm-nav__label">
              <span>{x.label}</span>
              <small>{x.en}</small>
            </span>
            {x.id === 'cases' && issues > 0 && <span class="adm-nav__badge">{issues}</span>}
          </a>
        ))}
      </nav>
      <div class={`adm-side__foot ${hasToken.value ? 'has-token' : ''}`}>
        {s && (
          <div class="adm-side__env">
            <Badge tone={s.dev ? 'info' : 'amber'}>{s.dev ? 'DEV' : 'PRODUCTION'}</Badge>
            <span class="adm-mono">{s.mode}</span>
          </div>
        )}
        <a class="adm-link adm-side__game" href="./" target="_blank" rel="noopener">
          <Icon name="external" size={14} /> ゲームを開く
        </a>
        {hasToken.value && (
          <button type="button" class="adm-link adm-side__signout" onClick={() => signOut()} title="トークンを消す" aria-label="トークンを消す">
            <Icon name="lock" size={14} /> <span class="adm-side__signout-label">トークンを消す</span>
          </button>
        )}
      </div>
    </aside>
  );
}

function SectionHost() {
  const r = route.value;
  switch (r.section) {
    case 'cases':
      return <CasesSection />;
    case 'ask':
      return <AskSection />;
    case 'traces':
      return <TracesSection />;
    case 'bench':
      return <BenchSection />;
    case 'token':
      return <TokenSection />;
    default:
      return <OverviewSection />;
  }
}

export function AdminApp() {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  if (auth.value !== 'ok') return <Gate />;
  const meta = SECTIONS.find((x) => x.id === route.value.section)!;
  return (
    <div class="adm-shell">
      <Side />
      <main class="adm-main" id="main">
        <header class="adm-top">
          <div>
            <span class="adm-kicker">{meta.en}</span>
            <h1>{meta.label}</h1>
          </div>
          <div class="adm-top__actions">
            <span class="adm-dim adm-small">更新 {fmtAgo(lastRefresh.value, now)}</span>
            <Btn
              icon="refresh"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await refreshAll();
                setBusy(false);
              }}
            >
              {busy ? '更新中…' : '再読込'}
            </Btn>
          </div>
        </header>
        <SectionHost />
      </main>
    </div>
  );
}
