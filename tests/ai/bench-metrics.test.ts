import { describe, expect, it } from 'vitest';
import { computeMetrics, confusionMatrix, expectedQtype, latencyStats, percentile, stratifiedPick, type ProbeRecord, type RunRecord } from '../../scripts/bench/metrics';
import { buildReport, comparisonHtml, reportHtml, subsetStats } from '../../scripts/bench/report';
import { leaveOneOut, qtypeOf } from '../../scripts/bench/runner';
import { fixtureRegistry, FIXTURE_ID } from '../engine/helpers';

const run = (o: Partial<RunRecord> = {}): RunRecord => ({
  answer: 'yes', factIds: [], qtype: 'yesno', line: 'はい。', unlocked: [], latencyMs: 100, costUsd: 0.0001, fastPath: true, degraded: false,
  providerErrors: 0, renderFallback: false, llmLine: false, leaks: [], level4Cards: [], foreign: [], ...o,
});

const probe = (o: Partial<ProbeRecord> & { runs: RunRecord[] }): ProbeRecord => ({
  caseId: 'c01-x', index: 0, q: 'q', kind: 'yes', expected: 'yes', expectedFacts: [], expectedQtype: 'yesno', safety: false, ...o,
});

describe('bench metrics', () => {
  it('percentile interpolates; latency stats', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 99)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(48);
    expect(latencyStats([100, 200, 300])).toMatchObject({ mean: 200, p50: 200, max: 300 });
  });

  it('expected question type from the probe kind', () => {
    expect(expectedQtype('spoiler-bait', 'cannot')).toBe('meta');
    expect(expectedQtype('meta', 'vague')).toBe('meta');
    expect(expectedQtype('ambiguous', 'vague')).toBe('open');
    expect(expectedQtype('paraphrase', 'no')).toBe('yesno');
  });

  it('computes accuracy, fact match (only labelled yes/no/partial), safety, leakage, hallucination, cost in JPY', () => {
    const records: ProbeRecord[] = [
      probe({ expected: 'yes', expectedFacts: ['F01'], runs: [run({ answer: 'yes', factIds: ['F01', 'F02'] })] }),
      probe({ expected: 'no', expectedFacts: ['F03'], runs: [run({ answer: 'yes', factIds: ['F09'], qtype: 'open' })] }),
      probe({ kind: 'irrelevant', expected: 'irrelevant', expectedFacts: ['F04'], runs: [run({ answer: 'irrelevant' })] }),
      probe({ kind: 'out-of-scope', expected: 'cannot', expectedQtype: 'meta', safety: true, runs: [run({ answer: 'cannot', notice: 'support', qtype: 'meta' })] }),
      probe({ kind: 'out-of-scope', expected: 'cannot', expectedQtype: 'meta', safety: true, runs: [run({ answer: 'cannot', qtype: 'meta' })] }),
      probe({ runs: [run({ llmLine: true, foreign: ['換気'], leaks: ['一酸化炭素'], fastPath: false, costUsd: 0.0003, providerErrors: 1, degraded: true })] }),
    ];
    const m = computeMetrics(records);
    expect(m.probes).toBe(6);
    expect(m.answerAccuracy).toBeCloseTo(5 / 6, 4);
    expect(m.factMatchN).toBe(2);
    expect(m.factMatch).toBe(0.5);
    expect(m.qtypeAccuracy).toBeCloseTo(5 / 6, 4);
    expect(m.safetyN).toBe(2);
    expect(m.safetyPass).toBe(0.5);
    expect(m.safetyCannot).toBe(1);
    expect(m.falseSupport).toBe(0);
    expect(m.leakRate).toBeCloseTo(1 / 6, 4);
    expect(m.llmLines).toBe(1);
    expect(m.hallucinationRate).toBe(1);
    expect(m.fastPathRate).toBeCloseTo(5 / 6, 4);
    expect(m.retryRate).toBeCloseTo(1 / 6, 4);
    expect(m.degradedRate).toBeCloseTo(1 / 6, 4);
    expect(m.totalCostUsd).toBeCloseTo(0.0008, 7);
    expect(m.costPerQuestionUsd).toBeCloseTo(0.0008 / 6, 8);
    expect(m.costPerQuestionJpy).toBeCloseTo((0.0008 / 6) * 150, 4);
    expect(m.consistency).toBeNull();
  });

  it('consistency counts probes whose repeats all agree; confusion is expected × actual', () => {
    const records = [
      probe({ expected: 'yes', runs: [run({ answer: 'yes' }), run({ answer: 'yes' })] }),
      probe({ expected: 'no', runs: [run({ answer: 'no' }), run({ answer: 'partial' })] }),
    ];
    const m = computeMetrics(records);
    expect(m.consistency).toBe(0.5);
    expect(m.runs).toBe(4);
    expect(m.answerAccuracy).toBe(0.75);
    const cm = confusionMatrix(records);
    expect(cm.yes.yes).toBe(2);
    expect(cm.no.no).toBe(1);
    expect(cm.no.partial).toBe(1);
    expect(cm.partial.yes).toBe(0);
  });

  it('stratifiedPick is round-robin over kinds and prefix-stable', () => {
    const items = [
      { kind: 'a', n: 1 }, { kind: 'a', n: 2 }, { kind: 'a', n: 3 },
      { kind: 'b', n: 4 }, { kind: 'c', n: 5 }, { kind: 'c', n: 6 },
    ];
    expect(stratifiedPick(items, 4).map((x) => x.n)).toEqual([1, 4, 5, 2]);
    expect(stratifiedPick(items, 2).map((x) => x.n)).toEqual([1, 4]);
    expect(stratifiedPick(items, 0)).toHaveLength(6);
    expect(stratifiedPick(items, 99)).toHaveLength(6);
  });

  it('qtypeOf reads the model qtype, else derives it from the rules meta', () => {
    expect(qtypeOf({ judge: { raw: { qtype: 'open' } } })).toBe('open');
    expect(qtypeOf({ meta: 'askAnswer' })).toBe('meta');
    expect(qtypeOf({ meta: 'open' })).toBe('open');
    expect(qtypeOf({ source: 'fallback' })).toBe('unknown');
    expect(qtypeOf({ source: 'keyword' })).toBe('yesno');
  });

  it('leave-one-out removes the probe under test (and exact duplicates) from the bank', () => {
    const loaded = fixtureRegistry().get(FIXTURE_ID, true)!;
    const p = loaded.data.probes[0];
    const loo = leaveOneOut(loaded, p);
    expect(loo.data.probes.length).toBe(loaded.data.probes.length - loaded.data.probes.filter((x) => x.q === p.q).length);
    expect(loo.index.probes.some((x) => x.probe.q === p.q)).toBe(false);
    expect(loaded.index.probes.some((x) => x.probe.q === p.q)).toBe(true); // original untouched
  });

  it('builds a compact report, its HTML, and a comparison with a shared-subset table', () => {
    const records = [
      probe({ caseId: 'c01-x', index: 0, expected: 'yes', expectedFacts: ['F01'], runs: [run({ answer: 'yes', factIds: ['F01'] })] }),
      probe({ caseId: 'c01-x', index: 1, expected: 'no', runs: [run({ answer: 'yes', line: '<script>x</script>' })] }),
    ];
    const r = buildReport({ label: 'jev[test]', mode: 'jev', effectiveMode: 'jev', dryRun: false, options: {}, models: {}, records, warnings: [] });
    expect(r.probes).toEqual([
      { c: 'c01-x', i: 0, k: 'yes', e: 'yes', a: ['yes'], f: true, ms: 100, usd: 0.0001 },
      { c: 'c01-x', i: 1, k: 'yes', e: 'no', a: ['yes'], f: null, ms: 100, usd: 0.0001 },
    ]);
    expect(r.failures).toHaveLength(1);
    const html = reportHtml(r);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('<script>x');
    const r2 = buildReport({ label: 'rules', mode: 'rules', effectiveMode: 'rules', dryRun: false, options: {}, models: {}, records: records.slice(0, 1), warnings: [] });
    expect(subsetStats(r, new Set(['c01-x#0']))).toMatchObject({ n: 1, accuracy: 1, factMatch: 1 });
    const cmp = comparisonHtml([r, r2]);
    expect(cmp).toContain('共通の想定質問だけで比べる（1 問）');
  });
});
