import { describe, expect, it } from 'vitest';
import { bestIndices, fmtDelta, fmtMetric, metricDirection, parseReport } from './bench-parse';

describe('admin bench-parse', () => {
  it('reads a scripts/bench v1 report (one run per file)', () => {
    const p = parseReport({
      file: '2026-09-24T13-49-21Z-jev[wide]-exp20.json',
      modified: '2026-09-24T13:49:21.000Z',
      size: 100,
      report: {
        version: 1,
        label: 'jev[wide]-exp20',
        mode: 'jev',
        effectiveMode: 'jev',
        dryRun: false,
        options: { limit: 20 },
        metrics: { probes: 60, answerAccuracy: 0.9, factMatch: 0, factMatchN: 0, consistency: null, latency: { p95: 410, mean: 300 }, costPerQuestionUsd: 0.0001 },
        byKind: { yes: { probes: 6, answerAccuracy: 1, factMatch: 1, factMatchN: 6 } },
        confusion: { yes: { yes: 5, no: 1 } },
        failures: [{ c: 'c01', q: 'q', kind: 'no', expected: 'no', got: 'irrelevant', facts: ['F01'], gotFacts: [], line: '…' }],
        warnings: [],
        probes: [{ c: 'c01' }],
      },
    });
    expect(p.label).toBe('jev[wide]-exp20');
    expect(p.runs).toHaveLength(1);
    expect(p.runs[0].metrics['latency.p95']).toBe(410);
    expect(p.runs[0].metrics.probes).toBe(60);
    expect(p.runs[0].metrics.factMatch).toBeUndefined(); // N = 0 → not a real 0 %
    expect(p.byKind?.yes.answerAccuracy).toBe(1);
    expect(p.confusion?.yes.no).toBe(1);
    expect(p.failures).toHaveLength(1);
    expect(p.html).toBe(`bench/reports/${encodeURIComponent('2026-09-24T13-49-21Z-jev[wide]-exp20.html')}`);
  });

  it('reads multi-mode reports (array and record forms)', () => {
    const a = parseReport({ file: 'a.json', report: { modes: [{ mode: 'rules', metrics: { accuracy: 0.9 } }, { mode: 'jev', metrics: { accuracy: 0.95 } }] } });
    expect(a.runs.map((r) => r.mode)).toEqual(['rules', 'jev']);
    const b = parseReport({ file: 'b.json', report: { modes: { rules: { accuracy: 0.9 }, jev: { accuracy: 0.95 } } } });
    expect(b.runs.map((r) => r.label)).toEqual(['rules', 'jev']);
    expect(parseReport({ file: 'c.json', report: null }).error).toBeTruthy();
  });

  it('knows which direction is better and formats by name', () => {
    expect(metricDirection('answerAccuracy')).toBe('higher');
    expect(metricDirection('leakRate')).toBe('lower');
    expect(metricDirection('level4CardRate')).toBe('lower');
    expect(metricDirection('latency.p95')).toBe('lower');
    expect(metricDirection('factMatchN')).toBe('neutral');
    expect(metricDirection('probes')).toBe('neutral');
    expect(fmtMetric('answerAccuracy', 0.9167)).toBe('91.7%');
    expect(fmtMetric('latency.p95', 559.8)).toBe('560 ms');
    expect(fmtMetric('costPerQuestionJpy', 0.01237)).toBe('0.01237円');
    expect(fmtDelta('answerAccuracy', -0.05, [0.9, 0.85])).toBe('−5.0pt');
    const runs = [{ metrics: { leakRate: 0 } }, { metrics: { leakRate: 0 } }, { metrics: { leakRate: 0.1 } }];
    expect([...bestIndices('leakRate', runs)]).toEqual([0, 1]);
  });
});
