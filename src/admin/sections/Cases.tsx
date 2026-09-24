/**
 * Cases: per-case validation report and full data browser (facts, probes, debate,
 * reconstruction, hints / answer elements / truth, sources / leak terms / memos).
 * Admin-only — this page shows every secret of the case.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { AnswerChip, Badge, Btn, Card, Chips, Empty, ErrorBox, KV, Meter, PathText, Seg, Stat, type Tone } from '../components';
import { fmtPct, noiseSegments } from '../format';
import { cases, go, pendingAsk, route, setQuery } from '../store';
import type { AdminCase, Case, ProbeMismatch } from '../types';

type Tab = 'validation' | 'facts' | 'probes' | 'debate' | 'reconstruction' | 'answers' | 'sources';
const TABS: { id: Tab; label: string }[] = [
  { id: 'validation', label: '検査' },
  { id: 'facts', label: '所見' },
  { id: 'probes', label: '想定質問' },
  { id: 'debate', label: '審問' },
  { id: 'reconstruction', label: '再構成' },
  { id: 'answers', label: '真相・正解・ヒント' },
  { id: 'sources', label: '出典・漏洩語' },
];
const REQUIRED_KINDS = ['yes', 'no', 'irrelevant', 'core', 'spoiler-bait', 'paraphrase', 'typo', 'negated'];
const SPOILER_TONE: Tone[] = ['ok', 'info', 'amber', 'warn', 'bad'];
const SPOILER_JP = ['自由に答える', '訊かれたら', '具体的に訊かれたら', '一致したときだけ', '開示しない'];

function Pips({ n, max = 4 }: { n: number; max?: number }) {
  return (
    <span class="adm-pips" title={`${n} / ${max}`} aria-label={`${n} / ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} class={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

function tryProbe(caseId: string, q: string) {
  pendingAsk.value = { caseId, question: q };
  go('ask');
}

/* ------------------------------------------------------------------ */

function ValidationTab({ c }: { c: AdminCase }) {
  const v = c.validation;
  const st = v.stats;
  return (
    <div class="adm-stack">
      <div class="adm-stats">
        <Stat label="判定" value={v.ok ? '合格' : '不合格'} sub={v.ok ? 'エラー 0' : `エラー ${v.errors.length}`} tone={v.ok ? 'ok' : 'bad'} />
        <Stat label="警告" value={v.warnings.length} tone={v.warnings.length ? 'amber' : undefined} />
        {st && (
          <>
            <Stat
              label="rules 自己一致"
              value={fmtPct(st.selfConsistency.rate)}
              sub={`${st.selfConsistency.matched} / ${st.selfConsistency.total}（基準 95%）`}
              tone={st.selfConsistency.rate >= 0.95 ? 'ok' : 'bad'}
            />
            <Stat label="汎化（leave-one-out）" value={fmtPct(st.generalization.rate)} sub={`${st.generalization.matched} / ${st.generalization.total}`} tone="info" />
          </>
        )}
      </div>
      {v.errors.length > 0 && (
        <Card title="エラー" en="ERRORS">
          <ul class="adm-list adm-list--bad">
            {v.errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      )}
      {v.warnings.length > 0 && (
        <Card title="警告" en="WARNINGS">
          <ul class="adm-list adm-list--warn">
            {v.warnings.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      )}
      {v.info.length > 0 && (
        <Card title="情報" en="INFO">
          <ul class="adm-list">
            {v.info.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      )}
      {st && (
        <Card title="想定質問の種類" en="PROBE KINDS">
          <div class="adm-kinds">
            {Object.entries(st.kinds)
              .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
              .map(([k, n]) => (
                <span key={k} class={`adm-kind ${REQUIRED_KINDS.includes(k) ? 'is-req' : ''}`}>
                  <span class="adm-mono">{k}</span>
                  <b>{n}</b>
                </span>
              ))}
            {REQUIRED_KINDS.filter((k) => !st.kinds[k as keyof typeof st.kinds]).map((k) => (
              <span key={k} class="adm-kind is-missing">
                <span class="adm-mono">{k}</span>
                <b>0</b>
              </span>
            ))}
          </div>
          <p class="adm-small adm-dim">枠線つき = 必須の種類（{REQUIRED_KINDS.join(' / ')}）</p>
        </Card>
      )}
      {st && <MismatchCard title="rules 自己一致の外れ" en="SELF-CONSISTENCY MISSES" list={st.selfConsistency.mismatches} caseId={c.id} />}
      {st && <MismatchCard title="汎化（1問抜き）の外れ" en="LEAVE-ONE-OUT MISSES" list={st.generalization.mismatches} caseId={c.id} collapsed />}
    </div>
  );
}

function MismatchCard({ title, en, list, caseId, collapsed }: { title: string; en: string; list: ProbeMismatch[]; caseId: string; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <Card
      title={`${title}（${list.length}）`}
      en={en}
      pad={false}
      actions={
        list.length > 0 && (
          <Btn size="sm" icon={open ? 'chevronDown' : 'chevronRight'} onClick={() => setOpen(!open)}>
            {open ? '閉じる' : '開く'}
          </Btn>
        )
      }
    >
      {list.length === 0 ? (
        <Empty icon="check">外れなし</Empty>
      ) : open ? (
        <table class="adm-table">
          <thead>
            <tr>
              <th>想定質問</th>
              <th>種類</th>
              <th>正解</th>
              <th>rules</th>
              <th>判定元</th>
              <th class="adm-num">類似</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((m, i) => (
              <tr key={i}>
                <td>{m.q}</td>
                <td>
                  <Badge>{m.kind}</Badge>
                </td>
                <td>
                  <AnswerChip cls={m.expected} compact />
                </td>
                <td>
                  <AnswerChip cls={m.got} compact />
                </td>
                <td class="adm-mono adm-small">{m.source}</td>
                <td class="adm-num">{m.score !== undefined ? m.score.toFixed(2) : '—'}</td>
                <td>
                  <Btn size="sm" icon="send" onClick={() => tryProbe(caseId, m.q)} title="質問テストで試す">
                    試す
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function FactsTab({ c }: { c: AdminCase }) {
  const d = c.data;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [imp, setImp] = useState('');
  const [spo, setSpo] = useState('');
  const probeCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of d.probes) for (const f of p.facts) m.set(f, (m.get(f) ?? 0) + 1);
    return m;
  }, [d]);
  const memoTitle = new Map(d.scienceMemos.map((m) => [m.id, m.title]));
  const cats = [...new Set(d.facts.map((f) => f.category))];
  const needle = q.trim().toLowerCase();
  const rows = d.facts.filter(
    (f) =>
      (!cat || f.category === cat) &&
      (!imp || f.importance >= Number(imp)) &&
      (!spo || f.spoilerLevel === Number(spo)) &&
      (!needle || [f.id, f.text, f.cardTitle ?? '', ...f.keywords, f.judgeNote ?? ''].some((s) => s.toLowerCase().includes(needle))),
  );
  return (
    <Card pad={false}>
      <div class="adm-filters">
        <input class="adm-search" type="search" placeholder="所見を検索（本文・キーワード・ID）" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <select value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)} aria-label="分類">
          <option value="">分類: すべて</option>
          {cats.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select value={imp} onChange={(e) => setImp((e.target as HTMLSelectElement).value)} aria-label="重要度">
          <option value="">重要度: すべて</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              重要度 ≥ {n}
            </option>
          ))}
        </select>
        <select value={spo} onChange={(e) => setSpo((e.target as HTMLSelectElement).value)} aria-label="ネタバレ度">
          <option value="">ネタバレ度: すべて</option>
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              spoiler {n} — {SPOILER_JP[n]}
            </option>
          ))}
        </select>
        <span class="adm-dim adm-small">
          {rows.length} / {d.facts.length} 件
        </span>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--facts">
          <thead>
            <tr>
              <th>ID</th>
              <th>所見</th>
              <th>分類</th>
              <th>重要度</th>
              <th>ネタバレ</th>
              <th>ifAsked</th>
              <th>前提</th>
              <th>キーワード</th>
              <th class="adm-num">想定質問</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} class={f.importance >= 3 ? 'is-core' : ''}>
                <td class="adm-mono">
                  {f.id}
                  {f.visibleFromStart && (
                    <>
                      <br />
                      <Badge tone="info" title="最初から見える">初期</Badge>
                    </>
                  )}
                </td>
                <td>
                  <div class="adm-fact">
                    {f.cardTitle && <b>{f.cardTitle}</b>}
                    <span>{f.text}</span>
                    {f.scienceMemo && <small class="adm-cyan-text">科学メモ: {memoTitle.get(f.scienceMemo) ?? f.scienceMemo}</small>}
                    {f.judgeNote && <small class="adm-dim">判定メモ: {f.judgeNote}</small>}
                  </div>
                </td>
                <td class="adm-nowrap">{f.category}</td>
                <td>
                  <Pips n={f.importance} />
                </td>
                <td>
                  <Badge tone={SPOILER_TONE[f.spoilerLevel]} title={SPOILER_JP[f.spoilerLevel]}>
                    {f.spoilerLevel}
                  </Badge>
                </td>
                <td>
                  <AnswerChip cls={f.ifAsked} compact />
                </td>
                <td>{f.requires.length ? <Chips items={f.requires} /> : <span class="adm-dim">—</span>}</td>
                <td class="adm-kw">
                  <Chips items={f.keywords} max={6} />
                </td>
                <td class="adm-num">{probeCount.get(f.id) ?? <span class="adm-warn-text">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function ProbesTab({ c }: { c: AdminCase }) {
  const d = c.data;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [ans, setAns] = useState('');
  const [fact, setFact] = useState('');
  const [missOnly, setMissOnly] = useState(false);
  const selfMiss = new Map((c.validation.stats?.selfConsistency.mismatches ?? []).map((m) => [m.q, m]));
  const looMiss = new Map((c.validation.stats?.generalization.mismatches ?? []).map((m) => [m.q, m]));
  const kinds = [...new Set(d.probes.map((p) => p.kind))].sort();
  const answers = [...new Set(d.probes.map((p) => p.answer))];
  const needle = q.trim().toLowerCase();
  const rows = d.probes.filter(
    (p) =>
      (!kind || p.kind === kind) &&
      (!ans || p.answer === ans) &&
      (!fact || p.facts.includes(fact)) &&
      (!missOnly || selfMiss.has(p.q) || looMiss.has(p.q)) &&
      (!needle || p.q.toLowerCase().includes(needle) || (p.note ?? '').toLowerCase().includes(needle)),
  );
  const count = (pred: (p: Case['probes'][number]) => boolean) => d.probes.filter(pred).length;
  return (
    <Card pad={false}>
      <div class="adm-filters">
        <input class="adm-search" type="search" placeholder="想定質問を検索" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)} aria-label="種類">
          <option value="">種類: すべて</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}（{count((p) => p.kind === k)}）
            </option>
          ))}
        </select>
        <select value={ans} onChange={(e) => setAns((e.target as HTMLSelectElement).value)} aria-label="正解">
          <option value="">正解: すべて</option>
          {answers.map((a) => (
            <option key={a} value={a}>
              {a}（{count((p) => p.answer === a)}）
            </option>
          ))}
        </select>
        <select value={fact} onChange={(e) => setFact((e.target as HTMLSelectElement).value)} aria-label="所見">
          <option value="">所見: すべて</option>
          {d.facts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id} {f.cardTitle ?? f.text.slice(0, 18)}
            </option>
          ))}
        </select>
        <label class="adm-check">
          <input type="checkbox" checked={missOnly} onChange={(e) => setMissOnly((e.target as HTMLInputElement).checked)} />
          外れのみ
        </label>
        <span class="adm-dim adm-small">
          {rows.length} / {d.probes.length} 件
        </span>
      </div>
      <div class="adm-answer-dist">
        {answers.map((a) => (
          <button key={a} type="button" class={ans === a ? 'is-on' : ''} onClick={() => setAns(ans === a ? '' : a)}>
            <AnswerChip cls={a} compact /> <b class="adm-mono">{count((p) => p.answer === a)}</b>
          </button>
        ))}
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr>
              <th class="adm-num">#</th>
              <th>想定質問</th>
              <th>正解</th>
              <th>種類</th>
              <th>所見</th>
              <th>rules</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const sm = selfMiss.get(p.q);
              const lm = looMiss.get(p.q);
              return (
                <tr key={p.q} class={sm ? 'is-miss' : ''}>
                  <td class="adm-num adm-dim">{d.probes.indexOf(p) + 1}</td>
                  <td>
                    {p.q}
                    {p.note && <small class="adm-dim adm-block">{p.note}</small>}
                  </td>
                  <td>
                    <AnswerChip cls={p.answer} compact />
                  </td>
                  <td>
                    <Badge>{p.kind}</Badge>
                  </td>
                  <td>{p.facts.length ? <Chips items={p.facts} /> : <span class="adm-dim">—</span>}</td>
                  <td>
                    {sm ? (
                      <Badge tone="bad" title={`rules は ${sm.got}（${sm.source}）`}>
                        自己一致✗ {sm.got}
                      </Badge>
                    ) : (
                      <Badge tone="ok">✓</Badge>
                    )}
                    {lm && (
                      <Badge tone="amber" title={`1問抜きでは ${lm.got}（${lm.source}）`}>
                        LOO✗ {lm.got}
                      </Badge>
                    )}
                  </td>
                  <td>
                    <Btn size="sm" icon="send" onClick={() => tryProbe(c.id, p.q)} title="質問テストで試す">
                      試す
                    </Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function DebateTab({ c }: { c: AdminCase }) {
  const d = c.data;
  const factTitle = (id: string) => {
    const f = d.facts.find((x) => x.id === id);
    return f ? `${id} ${f.cardTitle ?? f.text.slice(0, 24)}` : `${id}（存在しない）`;
  };
  return (
    <div class="adm-stack">
      {d.debate.map((r, ri) => (
        <Card key={r.id} title={r.title} en={`ROUND ${ri + 1} · ${r.id}`}>
          <div class="adm-debate">
            <div class="adm-debate__intro">
              {r.intro.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
            <ol class="adm-statements">
              {r.statements.map((s) => {
                const isAnswer = s.id === r.answer.statement;
                return (
                  <li key={s.id} class={isAnswer ? 'is-answer' : ''}>
                    <span class={`adm-speaker adm-speaker--${s.speaker}`}>{s.speaker === 'jane' ? 'ジェーン' : 'ホルマ'}</span>
                    <span class={s.speaker === 'jane' ? 'adm-jane' : ''}>
                      {noiseSegments(s.text).map((seg, i) =>
                        seg.noise ? (
                          <mark key={i} class={isAnswer && seg.text === r.answer.span ? 'is-target' : ''}>
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )}
                    </span>
                    <small class="adm-mono adm-dim">{s.id}</small>
                  </li>
                );
              })}
            </ol>
            <KV
              rows={[
                ['正解の一撃', <span><code>{r.answer.statement}</code> の「<b class="adm-alarm-text">{r.answer.span}</b>」を <b>{factTitle(r.answer.fact)}</b> で撃つ</span>],
                ['別解', r.alsoAccept.length ? <span>{r.alsoAccept.map(factTitle).join(' / ')}</span> : <span class="adm-dim">なし</span>],
                ['ヒント（2回外すと）', r.hint],
              ]}
            />
            <div class="adm-grid2">
              <div>
                <p class="adm-sublabel">論破成功</p>
                {r.success.map((l, i) => (
                  <p key={i} class="adm-quote adm-quote--ok">
                    {l}
                  </p>
                ))}
              </div>
              <div>
                <p class="adm-sublabel">外したとき</p>
                {r.wrongShot.map((l, i) => (
                  <p key={i} class="adm-quote adm-quote--bad">
                    {l}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function PanelImage({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div class="adm-panel__noimg">{src ? '画像なし' : '画像未指定'}</div>;
  return <img src={`./${src.replace(/^\.?\//, '')}`} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function ReconstructionTab({ c }: { c: AdminCase }) {
  const rc = c.data.reconstruction;
  return (
    <div class="adm-stack">
      <Card title="導入" en="INTRO">
        <p>{rc.intro}</p>
      </Card>
      <div class="adm-panels">
        {rc.panels.map((p, i) => (
          <div key={p.id} class={`adm-panel ${p.choice ? 'is-blank' : ''}`}>
            <div class="adm-panel__img">
              <PanelImage src={p.image} />
              <span class="adm-panel__no">{i + 1}</span>
              {p.choice && <span class="adm-panel__blank">空白コマ</span>}
            </div>
            <div class="adm-panel__body">
              <p class="adm-panel__caption">{p.caption}</p>
              {p.choice && (
                <div class="adm-panel__choice">
                  <p class="adm-sublabel">{p.choice.prompt}</p>
                  <ul>
                    {p.choice.options.map((o, k) => (
                      <li key={k} class={o.correct ? 'is-correct' : ''}>
                        {o.correct ? '✓ ' : '　'}
                        {o.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <details>
                <summary class="adm-small">場面の指示（画像生成ブリーフ）</summary>
                <p class="adm-small adm-dim">{p.scene}</p>
              </details>
            </div>
          </div>
        ))}
      </div>
      <Card title="締めのナレーション" en="FINALE">
        {rc.finale.map((l, i) => (
          <p key={i} class="adm-quote">
            {l}
          </p>
        ))}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AnswersTab({ c }: { c: AdminCase }) {
  const d = c.data;
  return (
    <div class="adm-stack">
      <Card title="真相" en="TRUTH — SECRET">
        <KV
          rows={[
            ['死因', <b>{d.truth.causeOfDeath}</b>],
            ['要約', d.truth.summary],
            ['仕組み', d.truth.mechanism],
            ['被害者', <span>{d.victim.name}（{d.victim.nameKana}）{d.victim.age}歳・{d.victim.occupation} <span class="adm-dim">/ {d.victim.codename}</span></span>],
          ]}
        />
        <table class="adm-table adm-table--tight">
          <thead>
            <tr>
              <th>時刻</th>
              <th>出来事</th>
            </tr>
          </thead>
          <tbody>
            {d.truth.timeline.map((t, i) => (
              <tr key={i}>
                <td class="adm-mono adm-nowrap">{t.time}</td>
                <td>{t.event}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card
        title="答えの要素（死因宣告）"
        en="ANSWER ELEMENTS"
        pad={false}
        actions={
          <span class="adm-small">
            解決: <code>{d.solveRule.required.join('+')}</code> · 惜しい: <code>{d.solveRule.almost.join('+')}</code>
          </span>
        }
      >
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>要素</th>
                <th>必須</th>
                <th>キーワード群（どれか1群の全語）</th>
                <th>判定モデルへの命題 / 欠けたときの一言</th>
              </tr>
            </thead>
            <tbody>
              {d.answerElements.map((e) => (
                <tr key={e.id}>
                  <td class="adm-mono">{e.id}</td>
                  <td>
                    <b>{e.label}</b>
                    <small class="adm-block adm-dim">{e.description}</small>
                  </td>
                  <td>{e.required ? <Badge tone="ok">必須</Badge> : <Badge>任意</Badge>}</td>
                  <td>
                    <Chips items={e.keywordGroups.map((g) => g.join(' + '))} max={8} />
                  </td>
                  <td>
                    <small class="adm-block">{e.judgeClaim}</small>
                    <small class="adm-block adm-amber-text">{e.missingFeedback}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {d.wrongClaims.length > 0 && (
        <Card title="誤った主張" en="WRONG CLAIMS" pad={false}>
          <table class="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>キーワード群</th>
                <th>ホルマの返し</th>
              </tr>
            </thead>
            <tbody>
              {d.wrongClaims.map((w) => (
                <tr key={w.id}>
                  <td class="adm-mono">{w.id}</td>
                  <td>
                    <Chips items={w.keywordGroups.map((g) => g.join(' + '))} max={6} />
                  </td>
                  <td>
                    <small class="adm-block">{w.feedback}</small>
                    <small class="adm-block adm-dim">{w.judgeClaim}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card title="ヒント" en="HINTS">
        <ol class="adm-hints">
          {[...d.hints]
            .sort((a, b) => a.level - b.level)
            .map((h) => (
              <li key={h.level}>
                <span class="adm-hints__lv">Lv.{h.level}</span>
                <p>{h.text}</p>
              </li>
            ))}
        </ol>
      </Card>
    </div>
  );
}

function SourcesTab({ c }: { c: AdminCase }) {
  const d = c.data;
  return (
    <div class="adm-stack">
      <Card title={`出典（${d.sources.length}）`} en="SOURCES" pad={false}>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>資料</th>
                <th>種別</th>
                <th>公開 / 参照</th>
                <th>裏付ける内容</th>
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.id}>
                  <td class="adm-mono">{s.id}</td>
                  <td>
                    <a class="adm-link" href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                    <small class="adm-block adm-dim">{s.organization}</small>
                    {!/^https:\/\//i.test(s.url) && <Badge tone="bad">https ではない</Badge>}
                  </td>
                  <td>
                    <Badge tone="info">{s.type}</Badge>
                  </td>
                  <td class="adm-mono adm-small adm-nowrap">
                    {s.publicationDate ?? '—'}
                    <br />
                    {s.accessedDate}
                  </td>
                  <td>
                    <small>{s.supports}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`漏洩語 leakTerms（${d.leakTerms.length}）`} en="LEAK TERMS — SECRET">
        <p class="adm-small adm-dim">解決前のモデル返答・公開欄に出てはいけない語。含まれた言い換えは捨てて定型文に戻す。</p>
        <Chips items={d.leakTerms} tone="bad" />
      </Card>
      <Card title={`科学メモ（${d.scienceMemos.length}）`} en="SCIENCE MEMOS" pad={false}>
        <table class="adm-table">
          <tbody>
            {d.scienceMemos.map((m) => (
              <tr key={m.id}>
                <td class="adm-mono">{m.id}</td>
                <td>
                  <b>{m.title}</b>
                  <small class="adm-block">{m.text}</small>
                </td>
                <td>
                  <Chips items={d.facts.filter((f) => f.scienceMemo === m.id).map((f) => f.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function CasesSection() {
  const all = cases.value;
  const r = route.value;
  if (!all) return <Empty>事件データを読み込み中…</Empty>;
  if (all.cases.length === 0)
    return (
      <div class="adm-stack">
        <Empty>読み込めた事件がありません。</Empty>
        {all.issues.length > 0 && (
          <ErrorBox>
            {all.issues.map((i, k) => (
              <div key={k}>
                <PathText path={i.path} /> {i.message}
              </div>
            ))}
          </ErrorBox>
        )}
      </div>
    );
  const c = all.cases.find((x) => x.id === r.arg) ?? all.cases[0];
  const tab = (TABS.some((t) => t.id === r.query.get('tab')) ? r.query.get('tab') : 'validation') as Tab;
  const d = c.data;
  let body: ComponentChildren;
  switch (tab) {
    case 'facts':
      body = <FactsTab c={c} />;
      break;
    case 'probes':
      body = <ProbesTab c={c} />;
      break;
    case 'debate':
      body = <DebateTab c={c} />;
      break;
    case 'reconstruction':
      body = <ReconstructionTab c={c} />;
      break;
    case 'answers':
      body = <AnswersTab c={c} />;
      break;
    case 'sources':
      body = <SourcesTab c={c} />;
      break;
    default:
      body = <ValidationTab c={c} />;
  }
  const sc = c.validation.stats?.selfConsistency.rate;
  return (
    <div class="adm-stack">
      <div class="adm-casepick" role="tablist" aria-label="事件">
        {all.cases.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === c.id}
            class={x.id === c.id ? 'is-on' : ''}
            style={{ '--accent': x.data.assets.accent } as Record<string, string>}
            onClick={() => go('cases', x.id, { tab })}
          >
            <span class="adm-casepick__no">{String(x.data.number).padStart(2, '0')}</span>
            <span class="adm-casepick__title">
              <b>{x.data.title}</b>
              <small>{x.data.titleEn}</small>
            </span>
            {x.validation.ok ? <Badge tone="ok">OK</Badge> : <Badge tone="bad">NG {x.validation.errors.length}</Badge>}
          </button>
        ))}
      </div>

      <div class="adm-casehead" style={{ '--accent': d.assets.accent } as Record<string, string>}>
        <div class="adm-casehead__main">
          <span class="adm-kicker">
            CASE {String(d.number).padStart(2, '0')} · {d.titleEn}
          </span>
          <h2>{d.title}</h2>
          <p class="adm-dim adm-small">
            <PathText path={c.path} />
          </p>
        </div>
        <dl class="adm-casehead__facts">
          <div>
            <dt>難易度</dt>
            <dd>
              <Pips n={d.difficulty} max={3} />
            </dd>
          </div>
          <div>
            <dt>分野</dt>
            <dd>{d.categories.join('・')}</dd>
          </div>
          <div>
            <dt>所要</dt>
            <dd>{d.estimatedMinutes}分</dd>
          </div>
          <div>
            <dt>公開</dt>
            <dd>{c.publish ? <Badge tone="ok">公開</Badge> : <Badge tone="mute">非公開</Badge>}</dd>
          </div>
          <div>
            <dt>確認状態</dt>
            <dd>
              <Badge tone={c.reviewStatus === 'human-reviewed' ? 'ok' : 'amber'}>{c.reviewStatus}</Badge>
            </dd>
          </div>
          <div>
            <dt>rules 自己一致</dt>
            <dd>
              {sc !== undefined ? (
                <span class="adm-inline">
                  <Meter value={sc} tone={sc >= 0.95 ? 'ok' : 'bad'} threshold={0.95} /> {fmtPct(sc)}
                </span>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div class="adm-tabsbar">
        <Seg
          label="事件データの表示"
          value={tab}
          options={TABS.map((t) => ({
            id: t.id,
            label:
              t.id === 'validation' && !c.validation.ok ? (
                <>
                  {t.label} <span class="adm-dot adm-dot--bad" />
                </>
              ) : t.id === 'facts' ? (
                `${t.label} ${d.facts.length}`
              ) : t.id === 'probes' ? (
                `${t.label} ${d.probes.length}`
              ) : (
                t.label
              ),
          }))}
          onChange={(t) => setQuery({ tab: t === 'validation' ? undefined : t })}
        />
        <Btn size="sm" icon="send" onClick={() => ((pendingAsk.value = { caseId: c.id }), go('ask'))}>
          この事件で質問テスト
        </Btn>
      </div>
      {body}
    </div>
  );
}
