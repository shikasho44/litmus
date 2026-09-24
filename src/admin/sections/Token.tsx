/**
 * Token tool: POST /api/admin/mint-token {caseId, stage} → a signed progress token at any
 * stage (QA shortcut), plus a local decoder for any token's payload (display only — the
 * signature is NOT checked here; the server verifies it on every call).
 */
import { useState } from 'preact/hooks';
import { adminApi, decodeToken } from '../api';
import { Badge, Btn, Card, Chips, CopyBtn, Empty, ErrorBox, Field, Json, KV, Meter } from '../components';
import { fmtPct, fmtTime } from '../format';
import { cases, go, pendingAsk } from '../store';
import { STAGES, type MintResult, type Stage } from '../types';

const COUNTERS = ['質問数', 'ヒント', '論破ミス', '泣きつき', '宣告回数'];

function Payload({ token }: { token: string }) {
  const d = decodeToken(token);
  if (!d.ok) return <ErrorBox>{d.error}</ErrorBox>;
  const p = d.payload as { v?: number; c?: string; u?: string[]; m?: string[]; n?: number[]; rm?: unknown; r?: string[]; f?: number; t?: number };
  const f = p.f ?? 0;
  return (
    <>
      <KV
        rows={[
          ['形式', <span class="adm-mono">v{p.v ?? '?'}</span>],
          ['事件 c', <span class="adm-mono">{p.c ?? '—'}</span>],
          ['開示所見 u', p.u?.length ? <Chips items={p.u} max={16} /> : <span class="adm-dim">なし</span>],
          ['科学メモ m', p.m?.length ? <Chips items={p.m} /> : <span class="adm-dim">なし</span>],
          [
            'カウンタ n',
            <span class="adm-chips">
              {(p.n ?? []).map((x, i) => (
                <span key={i} class="adm-chip">
                  {COUNTERS[i] ?? `#${i}`}: {x}
                </span>
              ))}
            </span>,
          ],
          ['突破ラウンド r', p.r?.length ? <Chips items={p.r} /> : <span class="adm-dim">なし</span>],
          [
            'フラグ f',
            <span>
              <span class="adm-mono">{f}</span> {f & 1 ? <Badge tone="ok">解決</Badge> : null}
              {f & 2 ? <Badge tone="ok">再構成</Badge> : null}
              {f & 4 ? <Badge tone="amber">nearCore</Badge> : null}
            </span>,
          ],
          ['発行 t', <span class="adm-mono">{p.t ? fmtTime(p.t * 1000, true) : '—'}</span>],
        ]}
      />
      <Json value={p} label="payload（署名は未検証）" />
    </>
  );
}

export function TokenSection() {
  const all = cases.value;
  const [caseId, setCaseId] = useState(all?.cases[0]?.id ?? '');
  const [stage, setStage] = useState<Stage>('investigated');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<(MintResult & { caseId: string; stage: Stage }) | null>(null);
  const [paste, setPaste] = useState('');

  if (!all) return <Empty>事件データを読み込み中…</Empty>;
  const cid = caseId || all.cases[0]?.id || '';

  async function mint() {
    setBusy(true);
    setError('');
    try {
      const m = await adminApi.mintToken(cid, stage);
      setRes({ ...m, caseId: cid, stage });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div class="adm-stack">
      <Card title="ステージを指定してトークンを発行" en="MINT TOKEN">
        <p class="adm-small adm-dim">
          QA 用の近道。<code>POST /api/admin/mint-token</code> が、指定した段階まで進めた署名つき進行トークンを返します（dev か管理者のみ）。
        </p>
        <div class="adm-row">
          <Field label="事件">
            <select value={cid} onChange={(e) => setCaseId((e.target as HTMLSelectElement).value)}>
              {all.cases.map((x) => (
                <option key={x.id} value={x.id}>
                  {String(x.data.number).padStart(2, '0')} {x.data.title}（{x.id}）
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div class="adm-stages" role="radiogroup" aria-label="ステージ">
          {STAGES.map((s, i) => (
            <button key={s.id} type="button" role="radio" aria-checked={stage === s.id} class={stage === s.id ? 'is-on' : ''} onClick={() => setStage(s.id)}>
              <span class="adm-stages__no">{i + 1}</span>
              <b>{s.label}</b>
              <span class="adm-mono adm-small">{s.id}</span>
              <small>{s.detail}</small>
            </button>
          ))}
        </div>
        <div class="adm-row adm-row--end">
          {error && <ErrorBox>{error}</ErrorBox>}
          <Btn variant="primary" icon="tag" disabled={busy || !cid} onClick={() => void mint()}>
            {busy ? '発行中…' : '発行'}
          </Btn>
        </div>
      </Card>

      {res && (
        <Card
          title={`${res.caseId} · ${STAGES.find((s) => s.id === res.stage)?.label}`}
          en="ISSUED TOKEN"
          actions={
            <>
              <CopyBtn text={res.token} label="トークンをコピー" />
              <Btn
                size="sm"
                icon="send"
                onClick={() => {
                  pendingAsk.value = { caseId: res.caseId, token: res.token };
                  go('ask');
                }}
              >
                質問テストで使う
              </Btn>
            </>
          }
        >
          <textarea class="adm-token-out adm-mono" readOnly rows={5} value={res.token} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} aria-label="発行されたトークン" />
          <div class="adm-grid2">
            <div>
              <p class="adm-sublabel">進行（ProgressSnapshot）</p>
              <KV
                rows={[
                  ['進捗', <span class="adm-inline"><Meter value={res.progress.progress} /> {fmtPct(res.progress.progress)}</span>],
                  ['開示所見', <span class="adm-mono">{res.progress.unlocked.length}</span>],
                  ['科学メモ', <span class="adm-mono">{res.progress.memos.length}</span>],
                  ['質問数', <span class="adm-mono">{res.progress.asked}</span>],
                  ['審問突破', res.progress.debateCleared.length ? <Chips items={res.progress.debateCleared} /> : <span class="adm-dim">なし</span>],
                  ['状態', <span>{res.progress.solved ? <Badge tone="ok">解決</Badge> : <Badge>未解決</Badge>}{res.progress.reconstructed && <Badge tone="ok">再構成</Badge>}{res.progress.nearCore && <Badge tone="amber">nearCore</Badge>}</span>],
                ]}
              />
            </div>
            <div>
              <p class="adm-sublabel">中身（payload）</p>
              <Payload token={res.token} />
            </div>
          </div>
          <p class="adm-small adm-dim">
            ゲーム側で使うには、同じオリジンで開いたゲームの開発者ツールから <code>localStorage["janedoe:save:v1"]</code> の該当事件の{' '}
            <code>token</code>（と <code>stage</code>）を差し替えてください。
          </p>
        </Card>
      )}

      <Card title="トークンを読む" en="DECODE">
        <Field label="進行トークン" hint="署名は確かめません（表示だけ）。改ざん・期限切れはサーバーが 401 bad_token で弾きます。" grow>
          <textarea class="adm-mono" rows={3} spellcheck={false} value={paste} placeholder="j1.…" onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} />
        </Field>
        {paste.trim() && <Payload token={paste} />}
      </Card>
    </div>
  );
}
