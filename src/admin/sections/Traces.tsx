/**
 * Traces: the server's in-memory ring buffer (newest first, ≤300) with filters.
 * Rows expand into the full TraceView. Dev also writes logs/trace-YYYY-MM-DD.jsonl.
 */
import { Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { adminApi } from '../api';
import { AnswerChip, Badge, Btn, Card, Empty, ErrorBox } from '../components';
import { fmtMs, fmtTime, fmtUsd } from '../format';
import { cases, refreshTick, route, setQuery, status } from '../store';
import { TraceView } from '../TraceView';
import { PIPELINE_MODES, type TraceRecord } from '../types';

const RESULTS = ['yes', 'no', 'partial', 'irrelevant', 'cannot', 'vague', 'correct', 'almost', 'missing', 'wrong'];

export function TracesSection() {
  const q = route.value.query;
  const [items, setItems] = useState<TraceRecord[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string>('');
  const [auto, setAuto] = useState(false);
  const caseId = q.get('case') ?? '';
  const kind = q.get('kind') ?? '';
  const mode = q.get('mode') ?? '';
  const result = q.get('result') ?? '';
  const flag = q.get('flag') ?? '';
  const text = q.get('q') ?? '';
  const limit = Number(q.get('limit') ?? 100) || 100;

  async function load() {
    setBusy(true);
    try {
      setItems(await adminApi.traces(limit, caseId || undefined));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  useEffect(() => {
    void load();
  }, [caseId, limit, refreshTick.value]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [auto, caseId, limit]);

  const titles = useMemo(() => new Map((cases.value?.cases ?? []).map((c) => [c.id, c.data.title])), [cases.value]);
  const factLabels = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const c of cases.value?.cases ?? []) m.set(c.id, new Map(c.data.facts.map((f) => [f.id, f.cardTitle ?? f.text.slice(0, 22)])));
    return m;
  }, [cases.value]);

  const needle = text.trim().toLowerCase();
  const rows = (items ?? []).filter(
    (r) =>
      (!kind || r.kind === kind) &&
      (!mode || r.trace.mode === mode) &&
      (!result || r.result.includes(result)) &&
      (!flag ||
        (flag === 'fallback' && (!!r.trace.fallback || r.trace.degraded)) ||
        (flag === 'model' && !r.trace.fastPath) ||
        (flag === 'unlock' && (r.trace.parts ?? []).some((p) => p.unlocked.length > 0)) ||
        (flag === 'cost' && r.trace.costUsd > 0)) &&
      (!needle || r.input.toLowerCase().includes(needle)),
  );

  return (
    <div class="adm-stack">
      <Card pad={false}>
        <div class="adm-filters">
          <input class="adm-search" type="search" placeholder="入力文で絞り込み" value={text} onInput={(e) => setQuery({ q: (e.target as HTMLInputElement).value })} />
          <select value={caseId} onChange={(e) => setQuery({ case: (e.target as HTMLSelectElement).value })} aria-label="事件">
            <option value="">事件: すべて</option>
            {(cases.value?.cases ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.data.title}
              </option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setQuery({ kind: (e.target as HTMLSelectElement).value })} aria-label="種類">
            <option value="">種類: すべて</option>
            <option value="ask">ask（質問）</option>
            <option value="verdict">verdict（死因宣告）</option>
          </select>
          <select value={mode} onChange={(e) => setQuery({ mode: (e.target as HTMLSelectElement).value })} aria-label="mode">
            <option value="">mode: すべて</option>
            {PIPELINE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select value={result} onChange={(e) => setQuery({ result: (e.target as HTMLSelectElement).value })} aria-label="結果">
            <option value="">結果: すべて</option>
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={flag} onChange={(e) => setQuery({ flag: (e.target as HTMLSelectElement).value })} aria-label="条件">
            <option value="">条件: なし</option>
            <option value="fallback">退避・降格あり</option>
            <option value="model">モデルが言い換え</option>
            <option value="unlock">所見が開いた</option>
            <option value="cost">費用あり</option>
          </select>
          <select value={String(limit)} onChange={(e) => setQuery({ limit: (e.target as HTMLSelectElement).value === '100' ? undefined : (e.target as HTMLSelectElement).value })} aria-label="件数">
            {[50, 100, 300].map((n) => (
              <option key={n} value={n}>
                最新 {n} 件
              </option>
            ))}
          </select>
          <label class="adm-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto((e.target as HTMLInputElement).checked)} />
            5秒ごとに更新
          </label>
          <Btn size="sm" icon="refresh" onClick={() => void load()} disabled={busy}>
            更新
          </Btn>
          <span class="adm-dim adm-small">
            {rows.length} / {items?.length ?? 0} 件
          </span>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {!items ? (
          <Empty>読み込み中…</Empty>
        ) : rows.length === 0 ? (
          <Empty icon="log">
            トレースがありません。ゲームか「質問テスト」で質問すると記録されます（サーバーのメモリに直近 300 件。再起動で消えます
            {status.value?.dev ? '。dev は logs/trace-YYYY-MM-DD.jsonl にも追記' : ''}）。
          </Empty>
        ) : (
          <div class="adm-table-wrap">
            <table class="adm-table adm-table--traces">
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>種類</th>
                  <th>事件</th>
                  <th>mode</th>
                  <th>入力</th>
                  <th>結果</th>
                  <th>経路</th>
                  <th class="adm-num">時間</th>
                  <th class="adm-num">費用</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const total = r.trace.timings?.find((t) => t.stage === 'total')?.ms;
                  const isOpen = open === r.id;
                  const labels = factLabels.get(r.caseId);
                  return (
                    <Fragment key={r.id}>
                      <tr class={`adm-row-link ${isOpen ? 'is-open' : ''}`} onClick={() => setOpen(isOpen ? '' : r.id)} aria-expanded={isOpen}>
                        <td class="adm-mono adm-nowrap" title={r.at}>
                          {fmtTime(r.at)}
                        </td>
                        <td>
                          <Badge tone={r.kind === 'verdict' ? 'violet' : 'mute'}>{r.kind}</Badge>
                        </td>
                        <td class="adm-small">{titles.get(r.caseId) ?? r.caseId}</td>
                        <td class="adm-mono adm-small">
                          {r.trace.requestedMode && r.trace.requestedMode !== r.trace.mode ? (
                            <span title={`要求 ${r.trace.requestedMode}`}>
                              {r.trace.mode} <span class="adm-warn-text">↓</span>
                            </span>
                          ) : (
                            r.trace.mode
                          )}
                        </td>
                        <td class="adm-trace-input">{r.input}</td>
                        <td>
                          <span class="adm-chips">
                            {r.result.map((x, i) => (r.kind === 'ask' ? <AnswerChip key={i} cls={x} compact /> : <Badge key={i} tone={x === 'correct' ? 'ok' : x === 'wrong' ? 'bad' : 'amber'}>{x}</Badge>))}
                          </span>
                        </td>
                        <td>
                          {r.trace.fastPath ? <Badge tone="ok">FAST</Badge> : <Badge tone="violet">MODEL</Badge>}
                          {(r.trace.degraded || r.trace.fallback) && (
                            <Badge tone="bad" title={r.trace.fallback}>
                              退避
                            </Badge>
                          )}
                        </td>
                        <td class="adm-num">{fmtMs(total)}</td>
                        <td class="adm-num">{r.trace.costUsd > 0 ? fmtUsd(r.trace.costUsd, 7) : <span class="adm-dim">0</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr class="adm-trace-detail">
                          <td colSpan={9}>
                            <TraceView trace={r.trace} factLabel={labels ? (id) => <span class="adm-dim adm-small">{labels.get(id) ?? ''}</span> : undefined} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
