/**
 * Bench: reports from GET /api/admin/bench (bench/reports/*.json, newest first; one file per
 * mode run, written by `npm run bench`). The list doubles as an overview (key metrics per
 * report). A report shows its metrics, per-kind / per-case breakdowns, the confusion matrix
 * and the failures. 比較 puts any two runs side by side. HTML reports are linked when the
 * server serves them (the dev server serves files under the project root; Vercel does not).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { adminApi } from '../api';
import {
  bestIndices, fmtDelta, fmtMetric, METRIC_JP, metricDirection, metricKeys, parseReport, pick, type BenchFailure, type BenchRun, type ParsedReport,
} from '../bench-parse';
import { AnswerChip, Badge, Btn, Card, Chips, Empty, ErrorBox, Json, KV } from '../components';
import { fmtBytes, fmtTime } from '../format';
import { cases, refreshTick, route, setQuery } from '../store';

type Row = [ComponentChildren, ComponentChildren];

const htmlCache = new Map<string, Promise<boolean>>();
/** Checks that an HTML report is really served (not the SPA fallback page). */
function htmlAvailable(path: string): Promise<boolean> {
  let p = htmlCache.get(path);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`./${path}`, { cache: 'no-store' });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return false;
        const text = await res.text();
        return !text.includes('/src/main.tsx') && !text.includes('id="admin"') && !text.includes('ROOM ZERO — UNLOCKING');
      } catch {
        return false;
      }
    })();
    htmlCache.set(path, p);
  }
  return p;
}

function useHtml(path: string | undefined): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    setOk(null);
    if (path) void htmlAvailable(path).then((v) => alive && setOk(v));
    else setOk(false);
    return () => {
      alive = false;
    };
  }, [path]);
  return ok;
}

function MetricName({ k }: { k: string }) {
  const dir = metricDirection(k);
  return (
    <span>
      <span class="adm-mono">{k}</span>
      {METRIC_JP[k] && <small class="adm-dim"> {METRIC_JP[k]}</small>}
      {dir !== 'neutral' && <small class="adm-dim"> {dir === 'higher' ? '↑' : '↓'}</small>}
    </span>
  );
}

function toneFor(key: string, v: number | undefined): string {
  if (v === undefined) return '';
  if (/accuracy|factMatch|safetyPass/i.test(key) && metricDirection(key) === 'higher') return v < 0.6 ? 'adm-bad-text' : v < 0.85 ? 'adm-warn-text' : '';
  if (/leak|hallucin|level4|falseSupport/i.test(key)) return v > 0 ? 'adm-bad-text' : '';
  return '';
}

/* ------------------------------------------------------------------ */

function MetricTable({ runs }: { runs: BenchRun[] }) {
  const keys = metricKeys(runs);
  if (runs.length === 0) return <Empty>このレポートから指標を読み取れませんでした（下の JSON を確認）。</Empty>;
  if (keys.length === 0) return <Empty>数値の指標がありません。</Empty>;
  return (
    <div class="adm-table-wrap">
      <table class="adm-table adm-table--metrics">
        <thead>
          <tr>
            <th>指標</th>
            {runs.map((r) => (
              <th key={r.key} class="adm-num adm-mono">
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const best = bestIndices(k, runs);
            return (
              <tr key={k}>
                <th>
                  <MetricName k={k} />
                </th>
                {runs.map((r, i) => (
                  <td key={r.key} class={`adm-num ${best.has(i) ? 'is-best' : ''} ${toneFor(k, r.metrics[k])}`}>
                    {fmtMetric(k, r.metrics[k])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const BREAKDOWN_COLS = ['probes', 'answerAccuracy', 'accuracy', 'factMatch', 'qtypeAccuracy', 'leakRate', 'hallucinationRate', 'latency.p95', 'costPerQuestionUsd'];

function Breakdown({ groups, labelOf }: { groups: Record<string, Record<string, number>>; labelOf?: (k: string) => ComponentChildren }) {
  const rows = Object.entries(groups);
  const present = new Set(rows.flatMap(([, m]) => Object.keys(m)));
  const cols = BREAKDOWN_COLS.filter((c) => present.has(c));
  return (
    <div class="adm-table-wrap">
      <table class="adm-table adm-table--tight adm-table--metrics">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c} class="adm-num" title={c}>
                {METRIC_JP[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, m]) => (
            <tr key={name}>
              <th class="adm-mono">{labelOf ? labelOf(name) : name}</th>
              {cols.map((c) => (
                <td key={c} class={`adm-num ${toneFor(c, m[c])}`}>
                  {fmtMetric(c, m[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Confusion({ m }: { m: Record<string, Record<string, number>> }) {
  const rows = Object.keys(m);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(m[r])))];
  return (
    <div class="adm-table-wrap">
      <table class="adm-confusion">
        <thead>
          <tr>
            <th class="adm-small adm-dim">正解 ＼ 判定</th>
            {cols.map((c) => (
              <th key={c}>
                <AnswerChip cls={c} compact />
              </th>
            ))}
            <th class="adm-num adm-small adm-dim">計</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = Object.values(m[r]).reduce((a, b) => a + b, 0);
            return (
              <tr key={r}>
                <th>
                  <AnswerChip cls={r} compact />
                </th>
                {cols.map((c) => {
                  const n = m[r][c] ?? 0;
                  const share = total ? n / total : 0;
                  const diag = r === c;
                  return (
                    <td
                      key={c}
                      class={`adm-num ${n === 0 ? 'adm-dim' : ''}`}
                      style={
                        n > 0
                          ? { background: diag ? `rgba(198,255,61,${0.1 + share * 0.45})` : `rgba(255,46,99,${0.12 + share * 0.6})`, color: diag && share > 0.5 ? 'var(--ink)' : undefined }
                          : undefined
                      }
                      title={`${r} → ${c}: ${n}`}
                    >
                      {n}
                    </td>
                  );
                })}
                <td class="adm-num adm-dim">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Failures({ list }: { list: BenchFailure[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 25);
  return (
    <>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--tight">
          <thead>
            <tr>
              <th>事件</th>
              <th>想定質問</th>
              <th>種類</th>
              <th>正解</th>
              <th>判定</th>
              <th>所見（正 / 判）</th>
              <th>返答</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f, i) => (
              <tr key={i}>
                <td class="adm-mono adm-small adm-nowrap">{String(f.c ?? '').slice(0, 3)}</td>
                <td>
                  {f.q}
                  {f.judge !== undefined && <Json value={f.judge} label="judge" />}
                </td>
                <td>
                  <Badge>{f.kind}</Badge>
                </td>
                <td>
                  <AnswerChip cls={String(f.expected)} compact />
                </td>
                <td>
                  <AnswerChip cls={String(f.got)} compact />
                </td>
                <td class="adm-small adm-nowrap">
                  <Chips items={f.facts ?? []} /> / {(f.gotFacts ?? []).length ? <Chips items={f.gotFacts} tone={f.gotFacts.some((x) => (f.facts ?? []).includes(x)) ? 'ok' : 'bad'} /> : <span class="adm-dim">—</span>}
                </td>
                <td class="adm-small adm-dim">{f.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > 25 && (
        <div class="adm-card__body">
          <Btn size="sm" onClick={() => setAll(!all)}>
            {all ? '先頭25件だけ表示' : `残り ${list.length - 25} 件も表示`}
          </Btn>
        </div>
      )}
    </>
  );
}

function ReportView({ r, caseTitle }: { r: ParsedReport; caseTitle: (id: string) => ComponentChildren }) {
  const html = useHtml(r.html);
  const metaRows = Object.entries(r.meta).slice(0, 16);
  const spend = r.spend as
    | { totalUsd?: number; totalJpy?: number; jev?: { calls?: number; errors?: number; costUsd?: number }; llm?: { calls?: number; errors?: number; costUsd?: number } }
    | undefined;
  const condRows: Row[] = [
    ...metaRows.map(([k, v]): Row => [<span class="adm-mono">{k}</span>, <span class="adm-mono">{String(v)}</span>]),
    ...Object.entries(r.models ?? {}).map(([k, v]): Row => [<span class="adm-mono">models.{k}</span>, <span class="adm-mono">{String(v)}</span>]),
  ];
  if (r.options)
    condRows.push([
      <span class="adm-mono">options</span>,
      <span class="adm-mono adm-small">
        {Object.entries(r.options)
          .map(([k, v]) => `${k}=${Array.isArray(v) ? `${v.length}件` : String(v)}`)
          .join('  ')}
      </span>,
    ]);
  const spendRows: Row[] = spend
    ? [
        ['合計', <span class="adm-mono">{fmtMetric('costUsd', spend.totalUsd)} {spend.totalJpy !== undefined && <small class="adm-dim">≈ {spend.totalJpy}円</small>}</span>],
        ...(['jev', 'llm'] as const)
          .filter((k) => spend[k])
          .map((k): Row => [k === 'jev' ? 'Jev' : 'LLM', <span class="adm-mono">{spend[k]!.calls ?? 0} 回 · エラー {spend[k]!.errors ?? 0} · {fmtMetric('costUsd', spend[k]!.costUsd)}</span>]),
      ]
    : [];
  return (
    <div class="adm-stack">
      <Card
        title={r.label}
        en={`REPORT · ${r.file}`}
        actions={
          <>
            {r.dryRun && <Badge tone="amber">dry-run（通信なし・数値は参考外）</Badge>}
            {r.html && html ? (
              <a class="adm-btn adm-btn--ghost adm-btn--sm" href={`./${r.html}`} target="_blank" rel="noopener">
                HTML レポートを開く
              </a>
            ) : r.html && html === false ? (
              <span class="adm-small adm-dim">HTML はこのサーバーでは配信されていません</span>
            ) : null}
          </>
        }
      >
        {r.error && <ErrorBox>{r.error}</ErrorBox>}
        {r.warnings.length > 0 && (
          <ul class="adm-list adm-list--warn">
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <div class="adm-grid2">
          <div>
            <p class="adm-sublabel">実行条件</p>
            <KV rows={condRows} />
          </div>
          <div>
            <p class="adm-sublabel">費用</p>
            {spendRows.length ? <KV rows={spendRows} /> : <p class="adm-dim adm-small">記録なし</p>}
          </div>
        </div>
      </Card>

      <Card title="指標" en="METRICS" pad={false}>
        <MetricTable runs={r.runs} />
      </Card>

      {r.byKind && (
        <Card title="想定質問の種類ごと" en="BY PROBE KIND" pad={false}>
          <Breakdown groups={r.byKind} />
        </Card>
      )}
      {r.byCase && (
        <Card title="事件ごと" en="BY CASE" pad={false}>
          <Breakdown groups={r.byCase} labelOf={caseTitle} />
        </Card>
      )}
      {r.confusion && (
        <Card title="混同行列（正解 × 判定）" en="CONFUSION" pad={false}>
          <Confusion m={r.confusion} />
        </Card>
      )}
      {r.failures && (
        <Card title={`外れ（${r.failures.length}）`} en="FAILURES" pad={false}>
          {r.failures.length ? <Failures list={r.failures} /> : <Empty icon="check">外れなし</Empty>}
        </Card>
      )}
      <Json value={r.raw} label="レポート JSON（全体）" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Compare({ runs }: { runs: BenchRun[] }) {
  const q = route.value.query;
  const a = runs.find((r) => r.key === q.get('a')) ?? runs[0];
  const b = runs.find((r) => r.key === q.get('b')) ?? runs.find((r) => r !== a && r.label !== a?.label) ?? runs[1];
  if (!a || !b || runs.length < 2) return <Empty>比べるには、実行（レポート）が2つ以上必要です。</Empty>;
  const keys = metricKeys([a, b]);
  const label = (r: BenchRun) => `${r.label}${r.dryRun ? '（dry-run）' : ''} — ${r.file}`;
  return (
    <>
      <div class="adm-filters">
        <label class="adm-compare-pick">
          <span class="adm-badge adm-badge--info">A</span>
          <select value={a.key} onChange={(e) => setQuery({ a: (e.target as HTMLSelectElement).value })}>
            {runs.map((r) => (
              <option key={r.key} value={r.key}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        <label class="adm-compare-pick">
          <span class="adm-badge adm-badge--violet">B</span>
          <select value={b.key} onChange={(e) => setQuery({ b: (e.target as HTMLSelectElement).value })}>
            {runs.map((r) => (
              <option key={r.key} value={r.key}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        <Btn size="sm" icon="refresh" onClick={() => setQuery({ a: b.key, b: a.key })}>
          入れ替え
        </Btn>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--metrics">
          <thead>
            <tr>
              <th>指標</th>
              <th class="adm-num">A: {a.label}</th>
              <th class="adm-num">B: {b.label}</th>
              <th class="adm-num">B − A</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const va = a.metrics[k];
              const vb = b.metrics[k];
              const dir = metricDirection(k);
              const both = va !== undefined && vb !== undefined;
              const d = both ? vb - va : undefined;
              const better = both && dir !== 'neutral' && d !== 0 ? (dir === 'higher' ? d! > 0 : d! < 0) : undefined;
              const rel = both && va !== 0 ? (d! / Math.abs(va)) * 100 : undefined;
              return (
                <tr key={k}>
                  <th>
                    <MetricName k={k} />
                  </th>
                  <td class="adm-num">{fmtMetric(k, va)}</td>
                  <td class="adm-num">{fmtMetric(k, vb)}</td>
                  <td class={`adm-num ${better === true ? 'adm-ok-text' : better === false ? 'adm-bad-text' : ''}`}>
                    {d === undefined ? '—' : fmtDelta(k, d, [va, vb])}
                    {rel !== undefined && Number.isFinite(rel) && Math.abs(rel) >= 0.05 && <small class="adm-dim"> ({`${rel > 0 ? '+' : ''}${rel.toFixed(1)}%`})</small>}
                  </td>
                  <td>{better === undefined ? <span class="adm-dim">—</span> : better ? <Badge tone="ok">B が良い</Badge> : <Badge tone="bad">A が良い</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function ListRow({ r, on, onPick }: { r: ParsedReport; on: boolean; onPick: () => void }) {
  const html = useHtml(r.html);
  const m = r.runs[0]?.metrics ?? {};
  const acc = pick(m, 'answerAccuracy', 'accuracy');
  const fm = pick(m, 'factMatch');
  const p95 = pick(m, 'latency.p95', 'latencyMs.p95');
  const cost = pick(m, 'costPerQuestionUsd');
  const leak = pick(m, 'leakRate');
  return (
    <tr class={`adm-row-link ${on ? 'is-open' : ''} ${r.dryRun ? 'is-dim' : ''}`} onClick={onPick}>
      <td>
        <b class="adm-mono">{r.label}</b>
        {r.runs.length > 1 && <small class="adm-dim"> ×{r.runs.length}</small>}
        <small class="adm-block adm-dim adm-mono">{r.file}</small>
      </td>
      <td class="adm-mono adm-small adm-nowrap">{fmtTime(r.modified, true)}</td>
      <td class="adm-mono adm-small">{[...new Set(r.runs.map((x) => x.mode))].join(', ') || '—'}</td>
      <td class={`adm-num ${acc ? toneFor(acc.key, acc.value) : ''}`}>{acc ? fmtMetric(acc.key, acc.value) : '—'}</td>
      <td class="adm-num">{fm ? fmtMetric(fm.key, fm.value) : '—'}</td>
      <td class={`adm-num ${leak && leak.value > 0 ? 'adm-bad-text' : ''}`}>{leak ? fmtMetric(leak.key, leak.value) : '—'}</td>
      <td class="adm-num">{p95 ? fmtMetric(p95.key, p95.value) : '—'}</td>
      <td class="adm-num">{cost ? fmtMetric(cost.key, cost.value) : '—'}</td>
      <td class="adm-nowrap">
        {r.error ? <Badge tone="bad">読めない</Badge> : r.runs.length ? null : <Badge tone="amber">形式不明</Badge>}
        {r.dryRun && <Badge tone="amber">dry</Badge>}
        {r.warnings.length > 0 && <Badge tone="warn">警告 {r.warnings.length}</Badge>}
        {r.html && html && (
          <a class="adm-link adm-small" href={`./${r.html}`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
            HTML
          </a>
        )}
      </td>
      <td class="adm-num adm-dim adm-small">{fmtBytes(r.size)}</td>
    </tr>
  );
}

export function BenchSection() {
  const [list, setList] = useState<ParsedReport[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = route.value.query;
  const view = q.get('view') === 'compare' ? 'compare' : 'reports';
  const hideDry = q.get('dry') === '0';

  async function load() {
    setBusy(true);
    htmlCache.clear();
    try {
      setList((await adminApi.bench()).map(parseReport));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }
  useEffect(() => {
    void load();
  }, [refreshTick.value]);

  const shown = useMemo(() => (list ?? []).filter((r) => !hideDry || !r.dryRun), [list, hideDry]);
  const allRuns = useMemo(() => shown.flatMap((r) => r.runs), [shown]);
  const selected = shown.find((r) => r.file === q.get('file')) ?? shown[0];
  const titles = useMemo(() => new Map((cases.value?.cases ?? []).map((c) => [c.id, c.data.title])), [cases.value]);
  const caseTitle = (id: string) => (
    <span>
      {id}
      {titles.get(id) && <small class="adm-dim"> {titles.get(id)}</small>}
    </span>
  );

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!list) return <Empty>読み込み中…</Empty>;
  if (list.length === 0)
    return (
      <Empty icon="star">
        ベンチレポートがありません。<code>npm run bench</code> を実行すると <code>bench/reports/*.json</code>（と HTML）ができ、ここに並びます。
        本番（Vercel）には bench/ が無いので、この画面は開発サーバーで使います。
      </Empty>
    );

  return (
    <div class="adm-stack">
      <Card
        title={`レポート（${shown.length}${hideDry ? ` / ${list.length}` : ''}）`}
        en="BENCH REPORTS"
        pad={false}
        actions={
          <>
            <label class="adm-check">
              <input type="checkbox" checked={hideDry} onChange={(e) => setQuery({ dry: (e.target as HTMLInputElement).checked ? '0' : undefined })} />
              dry-run を隠す
            </label>
            <div class="adm-seg" role="tablist" aria-label="表示">
              <button type="button" role="tab" aria-selected={view === 'reports'} class={view === 'reports' ? 'is-on' : ''} onClick={() => setQuery({ view: undefined })}>
                レポート
              </button>
              <button type="button" role="tab" aria-selected={view === 'compare'} class={view === 'compare' ? 'is-on' : ''} onClick={() => setQuery({ view: 'compare' })}>
                比較
              </button>
            </div>
            <Btn size="sm" icon="refresh" disabled={busy} onClick={() => void load()}>
              更新
            </Btn>
          </>
        }
      >
        <div class="adm-table-wrap adm-table-wrap--tall">
          <table class="adm-table">
            <thead>
              <tr>
                <th>ラベル / ファイル</th>
                <th>更新</th>
                <th>mode</th>
                <th class="adm-num">正答率</th>
                <th class="adm-num">所見一致</th>
                <th class="adm-num">漏洩</th>
                <th class="adm-num">P95</th>
                <th class="adm-num">費用/問</th>
                <th>状態</th>
                <th class="adm-num">サイズ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <ListRow key={r.file} r={r} on={view === 'reports' && r === selected} onPick={() => setQuery({ file: r.file, view: undefined })} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {view === 'compare' ? (
        <Card title="比較" en="COMPARE A / B" pad={false}>
          <Compare runs={allRuns} />
        </Card>
      ) : selected ? (
        <ReportView r={selected} caseTitle={caseTitle} />
      ) : (
        <Empty>表示するレポートがありません。</Empty>
      )}
    </div>
  );
}
