/**
 * Markdown summary of an AI playtest (bench/reports/playtest/<ISO>/summary.md). The hand-written
 * analysis lives in docs/playtest-report.md; this file is the raw table + findings list.
 */
import type { Contradiction, LabelDisagreement, RunLog, RunMetrics } from './types.js';
import { STAMP } from './player.js';

export interface PlaytestSummary {
  meta: {
    createdAt: string;
    player: string;
    judge: string;
    capUsd: number;
    spend: { jevUsd: number; llmUsd: number; totalUsd: number; jevCalls: number; llmCalls: number; errors: Record<string, number> };
    runs: number;
    completed: number;
  };
  metrics: RunMetrics[];
  contradictions: Contradiction[];
  disagreements: LabelDisagreement[];
}

const PERSONA_JA: Record<string, string> = { beginner: '初心者', science: '科学に詳しい人', clumsy: '質問が下手な人', sharp: '核心を突く人', adversarial: '意地悪な人' };
const VERDICT_JA: Record<string, string> = { correct: '正解', almost: 'ほぼ正解', missing: '要素不足', wrong: '違う', none: '未宣告' };

export function summaryMarkdown(s: PlaytestSummary, logs: RunLog[]): string {
  const L: string[] = [];
  L.push(`# AI playtest ${s.meta.createdAt}`, '');
  L.push(`player ${s.meta.player} / judge ${s.meta.judge} / spend $${s.meta.spend.totalUsd} (Jev $${s.meta.spend.jevUsd}, player $${s.meta.spend.llmUsd}) / cap $${s.meta.capUsd} / ${s.meta.completed}/${s.meta.runs} runs`, '');
  L.push('| run | 人物 | 結果 | 質問 | 宣告までの質問 | ヒント | 所見 | 詰まり(≥5連続) | 矛盾 | 漏洩 | 安全 | 劣化 | 撃ち損じ | 泣きつき | 宣告回数 | 費用 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of s.metrics) {
    L.push(
      `| ${m.id} | ${PERSONA_JA[m.persona] ?? m.persona} | ${m.outcome === 'solved' ? '解決' : m.outcome} (${VERDICT_JA[m.verdict]}) | ${m.questions} | ${m.questionsToVerdict ?? '—'} | ${m.hintsUsed} | ${m.unlocked}/${m.totalFacts} | ${m.stuck.map((x) => `Q${x.from}-${x.to}`).join(' ') || '—'} | ${m.contradictions} | ${m.leaks.length + m.level4Shown.length} | ${m.safetyNotices} | ${m.degraded} | ${m.debateMisses} | ${m.grants} | ${m.verdictAttempts} | $${m.costUsd.toFixed(4)} |`,
    );
  }
  L.push('', '## 答えの内訳', '', '| run | ' + Object.values(STAMP).join(' | ') + ' |', '|---|' + Object.values(STAMP).map(() => '---').join('|') + '|');
  for (const m of s.metrics) L.push(`| ${m.id} | ${Object.keys(STAMP).map((k) => m.answerMix[k as keyof typeof m.answerMix]).join(' | ')} |`);

  L.push('', '## 詰まり（≥5連続で 具体的に／関係ない／答えられない）', '');
  for (const m of s.metrics) for (const st of m.stuck) {
    L.push(`- **${m.id}** Q${st.from}〜Q${st.to}（${st.length}連続）`);
    st.questions.forEach((q, i) => L.push(`  - ${q} → ${STAMP[st.answers[i]]}`));
  }

  L.push('', '## 矛盾（同じ意味の質問に違う答え）', '');
  for (const c of s.contradictions) {
    L.push(`- [${c.kind}] ${c.caseId} 「${c.key}」`);
    for (const i of c.items) L.push(`  - ${i.run} Q${i.turn}: ${i.question} → ${STAMP[i.answer]}${i.effective !== i.answer ? `（反転後 ${STAMP[i.effective]}）` : ''}`);
  }

  L.push('', '## 想定質問のラベルと違う答え（類似 ≥0.9）', '');
  for (const d of s.disagreements) L.push(`- ${d.run} Q${d.turn}: ${d.question} → ${STAMP[d.answer]}（想定質問「${d.probe}」${d.probeScore} → ${STAMP[d.expected]}${d.flipped ? '・反転' : ''}）`);

  L.push('', '## 漏洩', '');
  for (const m of s.metrics) {
    for (const l of m.leaks) L.push(`- ${m.id} [${l.where}] Q${l.turn} ${l.terms.join('、')}: ${l.text.replace(/\n/g, ' ')}`);
    if (m.level4Shown.length) L.push(`- ${m.id} spoilerLevel 4 がカード化: ${m.level4Shown.join(',')}`);
  }

  L.push('', '## 死因宣告', '');
  for (const log of logs) for (const v of log.verdicts) L.push(`- ${log.id} (Q${v.asked}) ${VERDICT_JA[v.result]} [${v.matched.join('')}]: 「${v.text}」 → ${v.lines.join(' ')}`);

  L.push('', '## プレイヤー側の問題（出力不正など）', '');
  for (const log of logs) for (const p of log.playerIssues) L.push(`- ${log.id} T${p.turn}: ${p.issue}${p.raw ? ` — ${p.raw.slice(0, 120)}` : ''}`);
  for (const log of logs) if (log.error) L.push(`- ${log.id} ERROR ${log.error.split('\n')[0]}`);
  return L.join('\n') + '\n';
}
