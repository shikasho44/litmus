/**
 * Full TurnTrace viewer (Ask playground + Traces). Shows: mode / fast path / fallback,
 * per-stage timings as bars, candidate facts with scores, best probe match, per-part
 * decisions (judge raw JSON, rendered line, post-check), LLM in/out, tokens and cost.
 */
import type { ComponentChildren } from 'preact';
import { AnswerChip, Badge, Chips, Json, KV, Meter, Pre } from './components';
import { fmtMs, fmtNum, fmtUsd, fmtYen } from './format';
import type { EngineTrace, PartTrace } from './types';

const STAGE_COLORS = ['#3DE0FF', '#C6FF3D', '#FFB020', '#9B6BFF', '#FF2E63', '#7FD8BE', '#F2EFE6', '#8A93A6'];
const STAGE_JP: Record<string, string> = {
  normalize: '正規化・分割',
  retrieve: '候補抽出',
  rules: '規則判定',
  judge: 'モデル判定',
  policy: '開示規則',
  render: '返答生成',
  postcheck: '検査',
  'post-check': '検査',
  verdict: '宣告判定',
  total: '合計',
};

export function stageColor(stage: string, i: number): string {
  const known: Record<string, string> = { normalize: '#8A93A6', retrieve: '#3DE0FF', rules: '#C6FF3D', judge: '#9B6BFF', policy: '#7FD8BE', render: '#FFB020', postcheck: '#FF2E63', 'post-check': '#FF2E63' };
  return known[stage] ?? STAGE_COLORS[i % STAGE_COLORS.length];
}

export function TimingBars({ timings }: { timings: { stage: string; ms: number }[] }) {
  const total = timings.find((t) => t.stage === 'total')?.ms ?? timings.reduce((a, t) => a + t.ms, 0);
  const stages = timings.filter((t) => t.stage !== 'total');
  const sum = stages.reduce((a, t) => a + t.ms, 0);
  const scale = Math.max(total, sum, 0.001);
  const other = Math.max(0, total - sum);
  return (
    <div class="adm-timing">
      <div class="adm-timing__stack" aria-hidden="true">
        {stages.map((t, i) => (
          <span key={t.stage} style={{ width: `${(t.ms / scale) * 100}%`, background: stageColor(t.stage, i) }} title={`${t.stage} ${fmtMs(t.ms)}`} />
        ))}
        {other > 0 && <span class="adm-timing__other" style={{ width: `${(other / scale) * 100}%` }} title={`その他 ${fmtMs(other)}`} />}
      </div>
      <table class="adm-timing__rows">
        <tbody>
          {stages.map((t, i) => (
            <tr key={t.stage}>
              <th>
                <i style={{ background: stageColor(t.stage, i) }} />
                <span class="adm-mono">{t.stage}</span>
                {STAGE_JP[t.stage] && <small>{STAGE_JP[t.stage]}</small>}
              </th>
              <td class="adm-timing__bar">
                <span style={{ width: `${Math.max(0.5, (t.ms / scale) * 100)}%`, background: stageColor(t.stage, i) }} />
              </td>
              <td class="adm-num">{fmtMs(t.ms)}</td>
              <td class="adm-num adm-dim">{((t.ms / scale) * 100).toFixed(0)}%</td>
            </tr>
          ))}
          <tr class="adm-timing__total">
            <th>
              <i />
              <span class="adm-mono">total</span>
              <small>合計{sum > total + 0.5 ? '（部分は並列）' : ''}</small>
            </th>
            <td class="adm-timing__bar">
              <span style={{ width: `${(total / scale) * 100}%` }} />
            </td>
            <td class="adm-num">{fmtMs(total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ScoreBars({ items, max, label }: { items: { id: string; score: number; note?: ComponentChildren }[]; max?: number; label?: (id: string) => ComponentChildren }) {
  if (items.length === 0) return <p class="adm-dim adm-small">候補なし</p>;
  const top = max ?? Math.max(...items.map((i) => i.score), 0.0001);
  return (
    <table class="adm-scores">
      <tbody>
        {items.map((c) => (
          <tr key={c.id}>
            <th class="adm-mono">{c.id}</th>
            {label && <td class="adm-scores__label">{label(c.id)}</td>}
            <td class="adm-scores__bar">
              <span style={{ width: `${Math.min(100, (c.score / top) * 100)}%` }} />
            </td>
            <td class="adm-num">{fmtNum(c.score)}</td>
            {c.note !== undefined && <td>{c.note}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PartView({ p, index, factLabel }: { p: PartTrace; index: number; factLabel?: (id: string) => ComponentChildren }) {
  return (
    <div class="adm-part">
      <div class="adm-part__head">
        <span class="adm-part__no">#{index + 1}</span>
        <AnswerChip cls={p.answerClass} />
        <span class="adm-part__q">{p.question}</span>
      </div>
      <div class="adm-part__grid">
        <KV
          rows={[
            ['正規化', <code>{p.normalized || '（空）'}</code>],
            ['判定元', <span>
              <Badge tone={p.source === 'model' ? 'violet' : p.source === 'probe' ? 'ok' : p.source === 'keyword' ? 'info' : 'mute'}>{p.source}</Badge>
              {p.meta && <Badge tone="amber">meta:{p.meta}</Badge>}
              {p.negated && <Badge tone="warn">否定</Badge>}
              {p.open && <Badge tone="warn">疑問詞</Badge>}
            </span>],
            ['確信度', <span class="adm-inline"><Meter value={p.confidence} tone={p.confidence >= 0.75 ? 'ok' : p.confidence >= 0.5 ? 'amber' : 'bad'} threshold={0.5} /> {fmtNum(p.confidence, 3)}</span>],
            ['核心への近さ', <span class="adm-mono">{p.closeness} / 3</span>],
            ['対象の所見', p.factIds.length ? <Chips items={p.factIds} /> : <span class="adm-dim">—</span>],
            ['開示', p.unlocked.length ? <Chips items={p.unlocked} tone="ok" /> : <span class="adm-dim">なし</span>],
            ['保留', p.blocked.length ? <span class="adm-chips">{p.blocked.map((b) => <span class="adm-chip adm-chip--warn" key={b.id}>{b.id}: {b.reason}</span>)}</span> : <span class="adm-dim">なし</span>],
            ...(p.fallback ? [['退避', <Badge tone="bad">{p.fallback}</Badge>] as [string, ComponentChildren]] : []),
          ]}
        />
        <div>
          <p class="adm-sublabel">候補の所見</p>
          <ScoreBars items={p.candidates} label={factLabel} />
        </div>
      </div>
      {p.probes.length > 0 && (
        <>
          <p class="adm-sublabel">近い想定質問</p>
          <table class="adm-table adm-table--tight">
            <thead>
              <tr>
                <th>想定質問</th>
                <th>正解</th>
                <th class="adm-num">類似</th>
                <th>反転</th>
              </tr>
            </thead>
            <tbody>
              {p.probes.map((pr, i) => (
                <tr key={i}>
                  <td>{pr.q}</td>
                  <td>
                    <AnswerChip cls={pr.label} compact />
                  </td>
                  <td class="adm-num">{fmtNum(pr.score)}</td>
                  <td>{pr.flip ? <Badge tone="warn">flip</Badge> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {p.rendered && (
        <div class="adm-line">
          <span class="adm-line__who">ホルマ {p.rendered.canned ? <Badge tone="ok">定型文</Badge> : <Badge tone="violet">モデル</Badge>}</span>
          <p>{p.rendered.text}</p>
        </div>
      )}
      <div class="adm-part__json">
        <Json value={p.judge} label="判定の生データ（judge）" />
        {p.postCheck && <Json value={p.postCheck} label={`検査（post-check: ${p.postCheck.pass ? 'pass' : 'NG'}）`} />}
      </div>
    </div>
  );
}

export function TraceView({ trace, factLabel }: { trace: EngineTrace; factLabel?: (id: string) => ComponentChildren }) {
  const total = trace.timings?.find((t) => t.stage === 'total')?.ms;
  const requested = trace.requestedMode;
  const changed = requested && requested !== trace.mode;
  return (
    <div class="adm-trace">
      <div class="adm-trace__strip">
        <div>
          <span class="adm-stat__label">MODE</span>
          <span class="adm-trace__mode">
            {changed ? (
              <>
                <s class="adm-dim">{requested}</s> → <b>{trace.mode}</b>
              </>
            ) : (
              <b>{trace.mode}</b>
            )}
          </span>
        </div>
        <div>
          <span class="adm-stat__label">PATH</span>
          {trace.fastPath ? <Badge tone="ok">FAST PATH</Badge> : <Badge tone="violet">MODEL PHRASING</Badge>}
          {trace.degraded && <Badge tone="bad">DEGRADED</Badge>}
        </div>
        <div>
          <span class="adm-stat__label">CONFIDENCE</span>
          <span class="adm-inline">
            {trace.confidence !== undefined ? (
              <>
                <Meter value={trace.confidence} tone={trace.confidence >= 0.75 ? 'ok' : trace.confidence >= 0.5 ? 'amber' : 'bad'} threshold={0.5} /> <b class="adm-mono">{fmtNum(trace.confidence)}</b>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div>
          <span class="adm-stat__label">TOTAL</span>
          <b class="adm-mono">{fmtMs(total)}</b>
        </div>
        <div>
          <span class="adm-stat__label">TOKENS in / out</span>
          <b class="adm-mono">
            {fmtNum(trace.tokens?.input ?? 0)} / {fmtNum(trace.tokens?.output ?? 0)}
          </b>
        </div>
        <div>
          <span class="adm-stat__label">COST</span>
          <b class="adm-mono">{fmtUsd(trace.costUsd, 8)}</b>
          <small class="adm-dim">≈ {fmtYen(trace.costUsd)}</small>
        </div>
      </div>
      {trace.fallback && (
        <div class="adm-fallback">
          <b>退避・注記</b>
          <span class="adm-chips">
            {trace.fallback.split(' ').map((f, i) => (
              <span key={i} class="adm-chip adm-chip--bad">
                {f}
              </span>
            ))}
          </span>
        </div>
      )}

      <div class="adm-trace__cols">
        <div>
          <p class="adm-sublabel">段階ごとの時間</p>
          {trace.timings?.length ? <TimingBars timings={trace.timings} /> : <p class="adm-dim">記録なし</p>}
        </div>
        <div>
          <p class="adm-sublabel">候補の所見（上位）</p>
          <ScoreBars items={trace.candidates ?? []} label={factLabel} />
          {trace.probeMatch && (
            <>
              <p class="adm-sublabel">最も近い想定質問</p>
              <p class="adm-probe">
                <span>{trace.probeMatch.q}</span>
                <b class="adm-mono">{fmtNum(trace.probeMatch.score)}</b>
              </p>
            </>
          )}
          <p class="adm-sublabel">正規化</p>
          <Chips items={trace.normalized ?? []} />
        </div>
      </div>

      {trace.parts && trace.parts.length > 0 && (
        <div class="adm-parts">
          <p class="adm-sublabel">分割された質問（{trace.parts.length}）</p>
          {trace.parts.map((p, i) => (
            <PartView key={i} p={p} index={i} factLabel={factLabel} />
          ))}
        </div>
      )}

      <div class="adm-trace__io">
        <Pre text={trace.llmInput} label="LLM 入力（prompt）" open={false} />
        <Pre text={trace.llmOutput} label="LLM 出力" open={!!trace.llmOutput} />
        {!trace.llmInput && !trace.llmOutput && <p class="adm-dim adm-small">LLM 呼び出しなし（定型文の FAST PATH）</p>}
        {trace.postCheck && <Json value={trace.postCheck} label={`検査 post-check（${trace.postCheck.pass ? 'pass' : 'NG'}）`} open />}
        <Json value={trace.judge} label="判定の生データ（judge raw）" />
        <Json value={trace} label="トレース全体（TurnTrace）" />
      </div>
    </div>
  );
}
