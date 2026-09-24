/**
 * Ask playground: POST /api/admin/ask-debug {caseId, question, token?, mode?} and show the
 * answers plus the full TurnTrace. Runs are kept in memory for this tab (newest first).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AskResponse, PipelineMode } from '../../../shared/api';
import { adminApi } from '../api';
import { AnswerChip, Badge, Btn, Card, Chips, CopyBtn, Empty, ErrorBox, Field, KV, Meter } from '../components';
import { fmtMs, fmtPct, fmtTime, fmtUsd } from '../format';
import { cases, pendingAsk, route, setQuery, status } from '../store';
import { TraceView } from '../TraceView';
import { PIPELINE_MODES, STAGES, type EngineTrace, type Stage } from '../types';

interface Run {
  n: number;
  at: number;
  caseId: string;
  question: string;
  mode: PipelineMode | '';
  sentToken: boolean;
  ms: number;
  res?: AskResponse;
  error?: string;
}

const MAX_Q = 200;
let runSeq = 0;
// Survives section switches (module scope), not page reloads.
const memory: { runs: Run[]; token: string; carry: boolean; mode: PipelineMode | '' } = { runs: [], token: '', carry: true, mode: '' };

export function AskSection() {
  const all = cases.value;
  const r = route.value;
  const [caseId, setCaseId] = useState<string>(r.query.get('case') ?? all?.cases[0]?.id ?? '');
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<PipelineMode | ''>(memory.mode);
  const [token, setToken] = useState(memory.token);
  const [carry, setCarry] = useState(memory.carry);
  const [stage, setStage] = useState<Stage>('investigated');
  const [busy, setBusy] = useState(false);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Run[]>(memory.runs);
  const [sel, setSel] = useState<number>(memory.runs[0]?.n ?? -1);
  const qRef = useRef<HTMLTextAreaElement>(null);

  // hand-over from Cases (試す) / Token tool
  useEffect(() => {
    const p = pendingAsk.value;
    if (!p) return;
    pendingAsk.value = null;
    if (p.caseId) setCaseId(p.caseId);
    if (p.question !== undefined) setQuestion(p.question);
    if (p.token !== undefined) setToken(p.token);
    if (p.caseId && p.caseId !== caseId && p.token === undefined) setToken('');
    setTimeout(() => qRef.current?.focus(), 0);
  }, [pendingAsk.value]);

  useEffect(() => {
    if (!caseId && all?.cases[0]) setCaseId(all.cases[0].id);
  }, [all]);
  useEffect(() => {
    if (caseId && r.query.get('case') !== caseId) setQuery({ case: caseId });
  }, [caseId]);
  useEffect(() => {
    memory.runs = runs;
    memory.token = token;
    memory.carry = carry;
    memory.mode = mode;
  }, [runs, token, carry, mode]);

  const c = all?.cases.find((x) => x.id === caseId);
  const factLabel = useMemo(() => {
    const m = new Map((c?.data.facts ?? []).map((f) => [f.id, f.cardTitle ?? f.text.slice(0, 22)]));
    return (id: string) => <span class="adm-dim adm-small">{m.get(id) ?? ''}</span>;
  }, [c]);
  const len = [...question].length;
  const current = runs.find((x) => x.n === sel) ?? runs[0];

  async function send() {
    const q = question.trim();
    if (!q || !caseId || busy || len > MAX_Q) return;
    setBusy(true);
    setError('');
    const t0 = performance.now();
    const run: Run = { n: ++runSeq, at: Date.now(), caseId, question: q, mode, sentToken: !!token.trim(), ms: 0 };
    try {
      run.res = await adminApi.askDebug({ caseId, question: q, token: token.trim() || undefined, mode: mode || undefined });
      if (carry) setToken(run.res.token);
    } catch (e) {
      run.error = e instanceof Error ? e.message : String(e);
      setError(run.error);
    }
    run.ms = performance.now() - t0;
    setRuns((prev) => [run, ...prev].slice(0, 30));
    setSel(run.n);
    setBusy(false);
  }

  async function mint() {
    if (!caseId) return;
    setMinting(true);
    setError('');
    try {
      const m = await adminApi.mintToken(caseId, stage);
      setToken(m.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setMinting(false);
  }

  const suggestions = useMemo(() => {
    if (!c) return [] as string[];
    const starters = c.data.intro.starterQuestions;
    const probes = c.data.probes.filter((p) => ['core', 'spoiler-bait', 'negated', 'typo', 'multi'].includes(p.kind)).slice(0, 6).map((p) => p.q);
    return [...starters, ...probes];
  }, [c]);

  if (!all) return <Empty>事件データを読み込み中…</Empty>;

  return (
    <div class="adm-ask">
      <Card title="質問を送る" en="REQUEST" class="adm-ask__form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div class="adm-row">
            <Field label="事件">
              <select value={caseId} onChange={(e) => (setCaseId((e.target as HTMLSelectElement).value), setToken(''))}>
                {all.cases.map((x) => (
                  <option key={x.id} value={x.id}>
                    {String(x.data.number).padStart(2, '0')} {x.data.title}（{x.id}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="mode（一時上書き）" hint={`既定 = サーバーの ${status.value?.mode ?? '?'}`}>
              <select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as PipelineMode | '')}>
                <option value="">既定（{status.value?.mode ?? '—'}）</option>
                {PIPELINE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="質問" hint={<span class={len > MAX_Q ? 'adm-bad-text' : ''}>{len} / {MAX_Q} 字 · Ctrl+Enter で送信 · 「？」「それと」で最大3問に分割</span>} grow>
            <textarea
              ref={qRef}
              rows={3}
              value={question}
              placeholder="例: 換気は止まっていましたか？"
              onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          </Field>
          {suggestions.length > 0 && (
            <div class="adm-suggest">
              {suggestions.map((s, i) => (
                <button key={i} type="button" class="adm-chip adm-chip--btn" onClick={() => (setQuestion(s), qRef.current?.focus())}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <Field
            label="進行トークン（任意）"
            hint={
              <span>
                空 = 新規（開始直後）。<label class="adm-check adm-check--inline"><input type="checkbox" checked={carry} onChange={(e) => setCarry((e.target as HTMLInputElement).checked)} /> 返ってきたトークンを次の質問に引き継ぐ</label>
              </span>
            }
            grow
            group
          >
            <div class="adm-token-row">
              <input type="text" class="adm-mono" spellcheck={false} aria-label="進行トークン" value={token} placeholder="j1.…" onInput={(e) => setToken((e.target as HTMLInputElement).value)} />
              <select value={stage} onChange={(e) => setStage((e.target as HTMLSelectElement).value as Stage)} aria-label="発行するステージ">
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}（{s.id}）
                  </option>
                ))}
              </select>
              <Btn size="sm" icon="tag" onClick={() => void mint()} disabled={minting || !caseId}>
                {minting ? '発行中…' : '発行して入れる'}
              </Btn>
              {token && (
                <Btn size="sm" icon="close" onClick={() => setToken('')}>
                  空にする
                </Btn>
              )}
            </div>
          </Field>
          <div class="adm-row adm-row--end">
            {error && <ErrorBox>{error}</ErrorBox>}
            <Btn variant="primary" icon="send" type="submit" disabled={busy || !question.trim() || len > MAX_Q}>
              {busy ? '判定中…' : '送信'}
            </Btn>
          </div>
        </form>
      </Card>

      {runs.length > 0 && (
        <div class="adm-runs" role="tablist" aria-label="実行履歴">
          {runs.map((x) => (
            <button key={x.n} type="button" role="tab" aria-selected={x === current} class={x === current ? 'is-on' : ''} onClick={() => setSel(x.n)} title={x.question}>
              <span class="adm-mono adm-dim">#{x.n}</span>
              <span class="adm-runs__q">{x.question}</span>
              <span class="adm-runs__res">
                {x.error ? <Badge tone="bad">ERR</Badge> : x.res?.answers.map((a, i) => <AnswerChip key={i} cls={a.answerClass} compact />)}
              </span>
            </button>
          ))}
        </div>
      )}

      {current ? (
        current.error ? (
          <ErrorBox>
            #{current.n} 「{current.question}」: {current.error}
          </ErrorBox>
        ) : (
          current.res && <RunResult run={current} factLabel={factLabel} />
        )
      ) : (
        <Empty icon="send">質問を送ると、ホルマの答えと判定の全トレース（段階ごとの時間・候補・判定の生データ・LLM 入出力・費用）がここに出ます。</Empty>
      )}
    </div>
  );
}

function RunResult({ run, factLabel }: { run: Run; factLabel: (id: string) => ComponentChildren }) {
  const res = run.res!;
  const p = res.progress;
  return (
    <div class="adm-stack">
      <div class="adm-grid2 adm-grid2--wide-left">
        <Card title="答え" en={`ANSWERS · #${run.n} · ${fmtTime(run.at)}`}>
          <div class="adm-answers">
            {res.answers.map((a, i) => (
              <div key={i} class="adm-answer">
                <div class="adm-answer__head">
                  <AnswerChip cls={a.answerClass} />
                  <span class="adm-answer__q">{a.question}</span>
                  <Badge>{a.mood}</Badge>
                  {a.nearCore && (
                    <Badge tone="amber" title="この答えで核心に近づいた（ホルマの反応が変わる）">
                      nearCore
                    </Badge>
                  )}
                  {a.notice &&<Badge tone={a.notice === 'support' ? 'violet' : 'bad'}>notice: {a.notice}</Badge>}
                </div>
                <p class="adm-answer__line">{a.line}</p>
                {a.unlocked.length > 0 && (
                  <div class="adm-answer__unlocked">
                    <span class="adm-sublabel">所見が開いた</span>
                    {a.unlocked.map((f) => (
                      <span key={f.id} class="adm-factcard">
                        <b class="adm-mono">{f.id}</b> {f.cardTitle ?? f.text}
                        <small>
                          {f.category} · 重要度 {f.importance}
                        </small>
                      </span>
                    ))}
                  </div>
                )}
                {a.memos.length > 0 && (
                  <div class="adm-answer__unlocked">
                    <span class="adm-sublabel">科学メモ</span>
                    {a.memos.map((m) => (
                      <span key={m.id} class="adm-factcard adm-factcard--memo">
                        <b>{m.title}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card title="進行" en="PROGRESS">
          <KV
            rows={[
              ['mode 指定', <span class="adm-mono">{run.mode || '既定'}</span>],
              ['往復時間', <span class="adm-mono">{fmtMs(run.ms)}</span>],
              ['進捗', <span class="adm-inline"><Meter value={p.progress} tone="ok" /> {fmtPct(p.progress)}</span>],
              ['質問数', <span class="adm-mono">{p.asked}</span>],
              ['開示済み所見', p.unlocked.length ? <Chips items={p.unlocked} max={12} /> : <span class="adm-dim">なし</span>],
              ['核心接近', p.nearCore ? <Badge tone="amber">nearCore</Badge> : <span class="adm-dim">—</span>],
              ['状態', <span>{p.solved ? <Badge tone="ok">解決</Badge> : null}{p.reconstructed ? <Badge tone="ok">再構成</Badge> : null}{!p.solved && <span class="adm-dim">捜査中</span>}</span>],
              ['費用', <span class="adm-mono">{fmtUsd(res.trace?.costUsd)}</span>],
            ]}
          />
          <div class="adm-row">
            <CopyBtn text={res.token} label="新しいトークンをコピー" />
          </div>
        </Card>
      </div>
      {res.trace ? (
        <Card title="トレース" en="TURN TRACE">
          <TraceView trace={res.trace as EngineTrace} factLabel={factLabel} />
        </Card>
      ) : (
        <Empty>trace が返りませんでした（管理者として認識されていない可能性）。</Empty>
      )}
    </div>
  );
}
