/** Overview: server health, pipeline mode, secret, budget, providers, content issues. */
import { Badge, Card, Empty, ErrorBox, KV, Meter, PathText, Stat } from '../components';
import { fmtPct, fmtUptime, fmtUsd, fmtYen } from '../format';
import { cases, casesError, go, health, status } from '../store';

export function OverviewSection() {
  const h = health.value;
  const s = status.value;
  const c = cases.value;
  const budget = s?.budget;
  const unlimited = budget ? !Number.isFinite(budget.limitUsd) || budget.limitUsd < 0 : false;
  const used = budget && !unlimited && budget.limitUsd > 0 ? budget.spentUsd / budget.limitUsd : budget?.limitUsd === 0 ? 1 : 0;
  const degraded = s && s.mode !== s.requestedMode;
  const caseErrors = (c?.issues ?? []).filter((i) => i.level === 'error');
  const caseWarnings = (c?.issues ?? []).filter((i) => i.level === 'warning');

  return (
    <div class="adm-stack">
      <div class="adm-stats">
        <Stat
          label="実行モード"
          value={<span class="adm-mono">{s?.mode ?? h?.mode ?? '—'}</span>}
          sub={degraded ? <span class="adm-warn-text">要求 {s!.requestedMode} から降格</span> : `要求どおり（${s?.requestedMode ?? h?.requestedMode ?? '—'}）`}
          tone={degraded ? 'amber' : 'ok'}
        />
        <Stat
          label="秘密鍵 SESSION_SECRET"
          value={(s?.secretConfigured ?? h?.secretConfigured) ? '設定済み' : '未設定'}
          sub={(s?.secretConfigured ?? h?.secretConfigured) ? 'トークンの署名は安全' : s?.dev ? '開発用の固定値を使用中' : '本番では必須 — トークンを偽造できる'}
          tone={(s?.secretConfigured ?? h?.secretConfigured) ? 'ok' : s?.dev ? 'amber' : 'bad'}
        />
        <Stat
          label="本日の費用（UTC）"
          value={<span class="adm-mono">{fmtUsd(budget?.spentUsd ?? 0)}</span>}
          sub={
            budget ? (
              <span class="adm-inline">
                <Meter value={used} tone={budget.exceeded ? 'bad' : used > 0.75 ? 'amber' : 'ok'} label="予算の消化率" />
                {unlimited ? '上限なし' : `上限 ${fmtUsd(budget.limitUsd)}`}
              </span>
            ) : (
              '—'
            )
          }
          tone={budget?.exceeded ? 'bad' : undefined}
        />
        <Stat
          label="事件"
          value={<span class="adm-mono">{h?.cases ?? c?.cases.length ?? '—'}</span>}
          sub={(h?.contentIssues ?? 0) > 0 ? <span class="adm-bad-text">読込エラー {h!.contentIssues}</span> : '読込エラーなし'}
          tone={(h?.contentIssues ?? 0) > 0 ? 'bad' : 'ok'}
        />
        <Stat label="稼働時間" value={fmtUptime(h?.uptimeSec)} sub={`API v${h?.version ?? '?'} · ${h?.dev ?? s?.dev ? 'development' : 'production'}`} />
      </div>

      {h?.misconfigured && (
        <ErrorBox>
          本番サーバーの設定に不備があります: <code>{h.misconfigured}</code>
          <br />
          進行トークンを使う API は 503 を返しています（プレイできません）。
        </ErrorBox>
      )}

      {s && s.warnings.length > 0 && (
        <Card title="警告" en="WARNINGS">
          <ul class="adm-list adm-list--warn">
            {s.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <div class="adm-grid2">
        <Card title="判定パイプライン" en="PIPELINE">
          {s ? (
            <KV
              rows={[
                ['実際の mode', <b class="adm-mono">{s.mode}</b>],
                ['要求した mode', <span class="adm-mono">{s.requestedMode}</span>],
                ['判定プロバイダ', <span class="adm-mono">{s.decisionProvider}</span>],
                ['Jev モデル', <span class="adm-mono">{s.jevModel}</span>],
                ['LLM プロバイダ', <span class="adm-mono">{s.llmProvider}</span>],
                ['LLM モデル', <span class="adm-mono">{s.llmModel ?? '—'}</span>],
                ['OpenRouter キー', s.hasOpenRouterKey ? <Badge tone="ok">あり</Badge> : <Badge tone="mute">なし</Badge>],
                ['レート制限の追跡キー', <span class="adm-mono">{s.rateLimiterKeys}</span>],
              ]}
            />
          ) : (
            <Empty>状態を取得できません</Empty>
          )}
        </Card>
        <Card title="予算" en="DAILY BUDGET">
          {budget ? (
            <>
              <div class="adm-budget">
                <Meter value={used} tone={budget.exceeded ? 'bad' : used > 0.75 ? 'amber' : 'ok'} label="予算の消化率" />
                <span class="adm-mono">{unlimited ? '上限なし' : fmtPct(used)}</span>
              </div>
              <KV
                rows={[
                  ['日付（UTC）', <span class="adm-mono">{budget.day}</span>],
                  ['使用額', <span class="adm-mono">{fmtUsd(budget.spentUsd)} <small class="adm-dim">≈ {fmtYen(budget.spentUsd)}</small></span>],
                  ['上限 DAILY_COST_LIMIT_USD', <span class="adm-mono">{unlimited ? '無制限（負の値）' : budget.limitUsd === 0 ? '0（有料モデルを使わない）' : fmtUsd(budget.limitUsd)}</span>],
                  ['有料呼び出し回数', <span class="adm-mono">{budget.calls}</span>],
                  ['状態', budget.exceeded ? <Badge tone="bad">超過 — rules に退避中</Badge> : <Badge tone="ok">範囲内</Badge>],
                ]}
              />
              <p class="adm-small adm-dim">インスタンスごとのメモリ集計（目安）。確実な上限は OpenRouter キーの上限で。</p>
            </>
          ) : (
            <Empty>—</Empty>
          )}
        </Card>
      </div>

      <Card
        title="事件データの検査"
        en="CONTENT"
        actions={
          c && (
            <span class="adm-small adm-dim">
              台詞バンク: <span class="adm-mono">{c.lines.source}</span> · プロローグ: {c.prologue ? '読込済み' : 'なし'}
            </span>
          )
        }
        pad={false}
      >
        {casesError.value && <ErrorBox>{casesError.value}</ErrorBox>}
        {c ? (
          <div class="adm-table-wrap">
            <table class="adm-table">
              <thead>
                <tr>
                  <th>事件</th>
                  <th>公開</th>
                  <th>確認</th>
                  <th class="adm-num">所見</th>
                  <th class="adm-num">想定質問</th>
                  <th class="adm-num">エラー</th>
                  <th class="adm-num">警告</th>
                  <th class="adm-num">rules 自己一致</th>
                  <th class="adm-num">汎化 (LOO)</th>
                </tr>
              </thead>
              <tbody>
                {c.cases.map((x) => {
                  const st = x.validation.stats;
                  const sc = st?.selfConsistency.rate;
                  return (
                    <tr key={x.id} class="adm-row-link" onClick={() => go('cases', x.id)}>
                      <td>
                        <span class="adm-case-name">
                          <i style={{ background: x.data.assets.accent }} />
                          <span class="adm-mono adm-dim">{String(x.data.number).padStart(2, '0')}</span>
                          <b>{x.data.title}</b>
                          <small class="adm-dim">{x.id}</small>
                        </span>
                      </td>
                      <td>
                        {x.publish ? <Badge tone="ok">公開</Badge> : <Badge tone="mute">非公開</Badge>}
                        {x.proto && <Badge tone="amber">試作 ?proto={x.proto}</Badge>}
                      </td>
                      <td>
                        <Badge tone={x.reviewStatus === 'human-reviewed' ? 'ok' : x.reviewStatus === 'ai-reviewed' ? 'info' : 'amber'}>{x.reviewStatus}</Badge>
                      </td>
                      <td class="adm-num">{x.data.facts.length}</td>
                      <td class="adm-num">{x.data.probes.length}</td>
                      <td class="adm-num">{x.validation.errors.length ? <b class="adm-bad-text">{x.validation.errors.length}</b> : 0}</td>
                      <td class="adm-num">{x.validation.warnings.length ? <span class="adm-warn-text">{x.validation.warnings.length}</span> : 0}</td>
                      <td class="adm-num">
                        {sc !== undefined ? (
                          <span class="adm-inline adm-inline--end">
                            <Meter value={sc} tone={sc >= 0.95 ? 'ok' : 'bad'} threshold={0.95} />
                            {fmtPct(sc)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td class="adm-num">{st ? fmtPct(st.generalization.rate) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>読み込み中…</Empty>
        )}
        {c && (caseErrors.length > 0 || caseWarnings.length > 0) && (
          <div class="adm-card__body">
            <p class="adm-sublabel">読込時の問題（壊れた事件はスキップされ、ほかは動き続けます）</p>
            <ul class="adm-list">
              {[...caseErrors, ...caseWarnings].map((i, k) => (
                <li key={k}>
                  <Badge tone={i.level === 'error' ? 'bad' : 'amber'}>{i.level}</Badge> <PathText path={i.path} /> {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {c && c.lines.issues.length > 0 && (
          <div class="adm-card__body">
            <p class="adm-sublabel">台詞バンク（content/holma-lines.json）</p>
            <ul class="adm-list">
              {c.lines.issues.map((m, k) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
