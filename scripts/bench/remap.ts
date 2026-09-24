/**
 * Offline re-mapping (no API cost): re-applies the CURRENT JevJudge mapping (mapAskDecision —
 * thresholds, hybrid guards) to Jev distributions recorded by `npm run bench -- --dump <file>`,
 * with the CURRENT rules judge as the prior. Answers "would this mapping change have helped?"
 * without re-calling Jev. Fact choices are approximated from the recorded top-3.
 *
 *   npx tsx scripts/bench/remap.ts <dump.json> [more dumps…]
 */
import { readFileSync } from 'node:fs';
import type { AnswerClass } from '../../shared/case-schema.js';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs.js';
import { analyze, splitQuestions } from '../../server/engine/normalize.js';
import { retrieve } from '../../server/engine/retrieve.js';
import { judgeRules } from '../../server/engine/rules-judge.js';
import { mapAskDecision, type CandidateStrategy } from '../../server/engine/ai/jev-judge.js';
import type { DecisionResult } from '../../server/engine/providers/types.js';
import type { ProbeRecord } from './metrics.js';
import { leaveOneOut } from './runner.js';

interface RawJudge {
  strategy: CandidateStrategy;
  answer: Record<string, number>;
  fact: [string, number][];
  qtype: string;
  closeness?: number;
  flags: { selfHarm: number; directAnswer: number; offtopic: number };
}

function main(): void {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('usage: remap.ts <dump.json>…');
  const reg = loadRegistry(resolveContentRoot());
  for (const file of files) {
    const recs = JSON.parse(readFileSync(file, 'utf8')) as ProbeRecord[];
    let before = 0;
    let after = 0;
    let rulesOk = 0;
    let n = 0;
    const changed: string[] = [];
    for (const p of recs) {
      const run = p.runs[0];
      if (!run) continue;
      n++;
      if (run.answer === p.expected) before++;
      const loaded0 = reg.get(p.caseId, true);
      if (!loaded0) continue;
      const loaded = leaveOneOut(loaded0, loaded0.data.probes[p.index]);
      const first = splitQuestions(p.q).parts[0] ?? p.q;
      const q = analyze(first);
      const cand = retrieve(q, loaded.index);
      const rules = judgeRules(q, cand, loaded.index);
      if (rules.answerClass === p.expected) rulesOk++;
      const raw = ((run.judge as { model?: { raw?: RawJudge } } | undefined)?.model?.raw) as RawJudge | undefined;
      if (!raw || p.kind === 'multi') {
        if (run.answer === p.expected) after++;
        continue;
      }
      const probs = raw.answer;
      const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
      const factProbs = Object.fromEntries(raw.fact);
      const res: DecisionResult = {
        answers: {
          answer: { type: 'choice', choice, probabilities: probs, confidence: probs[choice] },
          fact: { type: 'choice', choice: raw.fact[0]?.[0] ?? 'NONE', probabilities: factProbs, confidence: raw.fact[0]?.[1] ?? 0 },
          qtype: { type: 'choice', choice: raw.qtype, probabilities: { [raw.qtype]: 1 }, confidence: 1 },
          closeness: { type: 'score', score: raw.closeness ?? 0, probabilities: {}, confidence: 0 },
          selfHarm: { type: 'noul', noul: raw.flags.selfHarm },
          directAnswer: { type: 'noul', noul: raw.flags.directAnswer },
          offtopic: { type: 'noul', noul: raw.flags.offtopic },
        },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        latencyMs: 0,
      };
      const build = { state: {}, questions: {}, candidateIds: raw.fact.map(([id]) => id).filter((id) => id !== 'NONE') };
      const d = mapAskDecision(res, build, { caseData: loaded.data, index: loaded.index, question: q, candidates: cand, rules, unlocked: new Set() }, raw.strategy);
      const got: AnswerClass = d.answerClass;
      if (got === p.expected) after++;
      if (got !== run.answer) changed.push(`${p.caseId.slice(0, 3)} ${p.kind} ${p.q} exp=${p.expected} ${run.answer}→${got}`);
    }
    const pc = (x: number) => `${((x / Math.max(1, n)) * 100).toFixed(1)}%`;
    console.log(`${file}\n  n=${n}  recorded ${pc(before)}  remapped ${pc(after)}  (rules now ${pc(rulesOk)})`);
    for (const c of changed.slice(0, 40)) console.log(`   ${c}`);
  }
}

main();
