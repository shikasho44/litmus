/**
 * Calibrates the JevPostChecker thresholds (costs one Jev call per line, ≈ $0.00003 each).
 *
 *   npx tsx scripts/bench/postcheck-calibrate.ts <dump.json>… [--canned N]
 *
 * Lines: every final line of the given bench dumps (LLM lines and canned fallbacks) plus N canned
 * answer lines per class from the line bank (these must all pass — they contain no case content).
 * Prints the raw nouls (newInfo / contradicts / secret) so thresholds can be set by eye; label
 * the model lines by hand before trusting the result.
 */
import { readFileSync } from 'node:fs';
import { ANSWER_CLASSES, type AnswerClass, type Fact } from '../../shared/case-schema.js';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs.js';
import { createJevProvider } from '../../server/engine/providers/jev.js';
import { JevPostChecker } from '../../server/engine/ai/jev-judge.js';
import { texts } from '../../server/engine/lines.js';
import type { ProbeRecord } from './metrics.js';
import { MeteredDecision } from './runner.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--canned');
  const cannedN = ci >= 0 ? Number(argv[ci + 1]) || 0 : 2;
  const files = argv.filter((a, i) => !a.startsWith('--') && !(ci >= 0 && i === ci + 1));
  const reg = loadRegistry(resolveContentRoot());
  const jev = new MeteredDecision(createJevProvider(process.env as Record<string, string>), 0.01);
  const checker = new JevPostChecker({ provider: jev });
  const items: { tag: string; caseId: string; q: string; cls: AnswerClass; line: string; allowed: Fact[] }[] = [];
  for (const f of files) {
    const recs = JSON.parse(readFileSync(f, 'utf8')) as ProbeRecord[];
    for (const p of recs) {
      const c = reg.get(p.caseId, true);
      const r = p.runs[0];
      if (!c || !r || r.line.startsWith('ERROR')) continue;
      const ids = new Set([...c.data.facts.filter((x) => x.visibleFromStart).map((x) => x.id), ...r.unlocked]);
      items.push({ tag: r.llmLine ? 'LLM' : 'CAN', caseId: p.caseId, q: p.q, cls: r.answer, line: r.line.split('\n')[0], allowed: c.data.facts.filter((x) => ids.has(x.id)) });
    }
  }
  const c0 = reg.cases[0];
  for (const cls of ANSWER_CLASSES) {
    for (const line of texts(reg.lines.lines.answer[cls]).slice(0, cannedN)) {
      items.push({ tag: 'BANK', caseId: c0.data.id, q: c0.data.probes.find((p) => p.answer === cls)?.q ?? '質問', cls, line, allowed: [] });
    }
  }
  for (const it of items) {
    const c = reg.get(it.caseId, true)!;
    const r = await checker.check({ caseData: c.data, question: it.q, answerClass: it.cls, line: it.line, allowedFacts: it.allowed, leakTerms: c.index.leakTerms, timeoutMs: 8000 });
    const raw = r.raw as { newInfo?: number; contradicts?: number; secret?: number; local?: string[] };
    console.log([it.tag, it.caseId.slice(0, 3), it.cls.padEnd(10), r.pass ? 'PASS' : 'FAIL', `new=${raw.newInfo ?? '-'} con=${raw.contradicts ?? '-'} sec=${raw.secret ?? '-'}${raw.local ? ` local=${raw.local}` : ''}`, it.q, '=>', it.line].join('  '));
  }
  console.log(`Jev: ${jev.meter.calls} calls $${jev.meter.costUsd.toFixed(6)}`);
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
