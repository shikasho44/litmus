/**
 * Pure analysis of AI playtest logs (unit-tested in tests/ai/playtest.test.ts):
 *   - stuck streaks      ≥ 5 consecutive answers that gave the player nothing (vague / irrelevant / cannot)
 *   - contradictions     semantically equivalent questions answered differently — same normalised
 *                        core form (and negation); near-identical wording (bigram Dice ≥ 0.8, same
 *                        proposition polarity) answered はい vs いいえ; or the same authored probe
 *                        (≥ 0.85, label flip aware)
 *   - label disagreement a question close to an authored probe answered unlike the probe label
 *   - leaks              case leak terms in anything shown before the verdict (answers, hints,
 *                        verdict feedback, debate lines) that the player's cards do not already contain,
 *                        and spoilerLevel-4 facts shown as cards
 */
import type { AnswerClass, Case } from '../../shared/case-schema.js';
import { ANSWER_CLASSES } from '../../shared/case-schema.js';
import type { CaseIndex } from '../../server/engine/case-index.js';
import { analyze, bigrams, dice, normalize } from '../../server/engine/normalize.js';
import { scoreProbes } from '../../server/engine/retrieve.js';
import type { AskPart, Contradiction, LabelDisagreement, LeakHit, RunLog, RunMetrics, StuckStreak } from './types.js';

export const STUCK_CLASSES: ReadonlySet<AnswerClass> = new Set(['vague', 'irrelevant', 'cannot']);
export const STUCK_MIN = 5;
export const SAME_PROBE_MIN = 0.85;
export const SIMILAR_MIN = 0.8;

/** Runs of ≥ `min` consecutive stuck answers (by question turn: a turn is stuck when all its parts are). */
export function stuckStreaks(asks: readonly AskPart[], min = STUCK_MIN): StuckStreak[] {
  const turns = new Map<number, AskPart[]>();
  for (const a of asks) turns.set(a.turn, [...(turns.get(a.turn) ?? []), a]);
  const ordered = [...turns.entries()].sort((a, b) => a[0] - b[0]);
  const out: StuckStreak[] = [];
  let cur: [number, AskPart[]][] = [];
  const flush = () => {
    if (cur.length >= min) {
      out.push({
        from: cur[0][0],
        to: cur[cur.length - 1][0],
        length: cur.length,
        questions: cur.map(([, p]) => p[0].message),
        answers: cur.map(([, p]) => p[0].answer),
      });
    }
    cur = [];
  };
  for (const t of ordered) {
    const stuck = t[1].every((p) => STUCK_CLASSES.has(p.answer));
    if (stuck) cur.push(t);
    else flush();
  }
  flush();
  return out;
}

const flipClass = (a: AnswerClass): AnswerClass => (a === 'yes' ? 'no' : a === 'no' ? 'yes' : a);

export interface PooledAsk { run: string; part: AskPart }

/**
 * Equivalent questions answered differently, over every run of one case. Two keys:
 *   same-question  identical normalised core form + same negation
 *   same-probe     the same authored probe is the best match (≥ SAME_PROBE_MIN) of both; answers
 *                  are compared after undoing the probe flip (「止まって？」 vs 「動いて？」)
 * Safety answers are ignored (they are not judgements).
 */
export function findContradictions(caseId: string, pool: readonly PooledAsk[], index: CaseIndex): Contradiction[] {
  const out: Contradiction[] = [];
  const byCore = new Map<string, PooledAsk[]>();
  const byProbe = new Map<number, { ask: PooledAsk; flip: boolean }[]>();
  for (const x of pool) {
    if (x.part.notice === 'support') continue;
    const q = analyze(x.part.question);
    if (q.norm.length < 2) continue;
    const key = `${q.negated ? '¬' : ''}${q.core}`;
    byCore.set(key, [...(byCore.get(key) ?? []), x]);
    const best = scoreProbes(q, index.probes, 1, index.contentWords)[0];
    if (best && best.score >= SAME_PROBE_MIN) {
      byProbe.set(best.entry.index, [...(byProbe.get(best.entry.index) ?? []), { ask: x, flip: best.flip }]);
    }
  }
  const coreKeys = new Set<string>();
  for (const [key, items] of byCore) {
    const classes = new Set(items.map((i) => i.part.answer));
    if (classes.size > 1) {
      coreKeys.add(items.map((i) => `${i.run}#${i.part.turn}`).sort().join('|'));
      out.push({
        kind: 'same-question',
        caseId,
        key,
        items: items.map((i) => ({ run: i.run, turn: i.part.turn, question: i.part.question, answer: i.part.answer, effective: i.part.answer, line: i.part.line })),
      });
    }
  }
  // Near-identical wording answered yes vs no (「とけたりしたんですか」 / 「とけたんですか」).
  const polar = pool
    .filter((x) => x.part.notice !== 'support' && (x.part.answer === 'yes' || x.part.answer === 'no'))
    .map((x) => ({ x, q: analyze(x.part.question) }))
    .map((o) => ({ ...o, grams: bigrams(o.q.core) }));
  for (let i = 0; i < polar.length; i++) {
    for (let j = i + 1; j < polar.length; j++) {
      const a = polar[i];
      const b = polar[j];
      if (a.x.part.answer === b.x.part.answer || a.q.negated !== b.q.negated || a.q.prop.polarity !== b.q.prop.polarity) continue;
      if (a.q.core === b.q.core) continue; // reported as same-question
      if (dice(a.grams, b.grams) < SIMILAR_MIN) continue;
      const sig = [`${a.x.run}#${a.x.part.turn}`, `${b.x.run}#${b.x.part.turn}`].sort().join('|');
      if (coreKeys.has(sig)) continue;
      coreKeys.add(sig);
      out.push({
        kind: 'similar-question',
        caseId,
        key: `${a.x.part.question} ≈ ${b.x.part.question}`,
        items: [a, b].map((o) => ({ run: o.x.run, turn: o.x.part.turn, question: o.x.part.question, answer: o.x.part.answer, effective: o.x.part.answer, line: o.x.part.line })),
      });
    }
  }
  for (const [pi, items] of byProbe) {
    const eff = items.map((i) => (i.flip ? flipClass(i.ask.part.answer) : i.ask.part.answer));
    if (new Set(eff).size <= 1) continue;
    const sig = items.map((i) => `${i.ask.run}#${i.ask.part.turn}`).sort().join('|');
    if (coreKeys.has(sig)) continue; // already reported as the same question
    out.push({
      kind: 'same-probe',
      caseId,
      key: index.probes.find((p) => p.index === pi)?.probe.q ?? String(pi),
      items: items.map((i, k) => ({ run: i.ask.run, turn: i.ask.part.turn, question: i.ask.part.question, answer: i.ask.part.answer, effective: eff[k], line: i.ask.part.line })),
    });
  }
  return out;
}

/** Answers that differ from the closest authored probe's label (score ≥ min, flip-aware). */
export function labelDisagreements(pool: readonly PooledAsk[], index: CaseIndex, min = 0.9): LabelDisagreement[] {
  const out: LabelDisagreement[] = [];
  for (const x of pool) {
    if (x.part.notice === 'support') continue;
    const q = analyze(x.part.question);
    const best = scoreProbes(q, index.probes, 1, index.contentWords)[0];
    if (!best || best.score < min) continue;
    const expected = best.flip ? flipClass(best.entry.probe.answer) : best.entry.probe.answer;
    if (expected !== x.part.answer) {
      out.push({ run: x.run, turn: x.part.turn, question: x.part.question, answer: x.part.answer, probe: best.entry.probe.q, probeScore: best.score, expected, flipped: best.flip });
    }
  }
  return out;
}

/** Leak terms (normalised) in `text` that are not in the texts the player already holds. */
export function leakTermsIn(text: string, leakTerms: readonly string[], heldTexts: readonly string[]): string[] {
  const n = normalize(text);
  const held = normalize(heldTexts.join(' '));
  return leakTerms.filter((t) => t.length > 0 && n.includes(t) && !held.includes(t));
}

/** Everything shown to the player before the verdict was accepted, checked for leak terms. */
export function findLeaks(log: RunLog, c: Case, index: CaseIndex): { leaks: LeakHit[]; level4: string[] } {
  const leaks: LeakHit[] = [];
  const level = new Map(c.facts.map((f) => [f.id, f.spoilerLevel]));
  const text = new Map(c.facts.map((f) => [f.id, f.text]));
  const held: string[] = c.facts.filter((f) => f.visibleFromStart && f.spoilerLevel < 4).map((f) => f.text);
  const level4 = new Set<string>();
  const check = (where: LeakHit['where'], turn: number, t: string) => {
    const terms = leakTermsIn(t, index.leakTerms, held);
    if (terms.length > 0) leaks.push({ run: log.id, where, turn, text: t, terms });
  };
  // Answers and hints in turn order; a card's own text is allowed from the moment it is shown.
  const events: { turn: number; order: number; fn: () => void }[] = [];
  log.asks.forEach((a, i) =>
    events.push({
      turn: a.turn,
      order: i,
      fn: () => {
        check('answer', a.turn, a.line);
        for (const u of a.unlocked) {
          if ((level.get(u.id) ?? 0) >= 4) {
            level4.add(u.id); // a leak in itself — its text does not make later mentions legitimate
            continue;
          }
          const t = text.get(u.id);
          if (t) held.push(t);
        }
      },
    }),
  );
  // A hint is taken after the answers of its turn (hint.turn = questions asked so far).
  log.hints.forEach((h, i) => events.push({ turn: h.turn, order: 1e6 + i, fn: () => check('hint', h.turn, h.text) }));
  events.sort((a, b) => a.turn - b.turn || a.order - b.order).forEach((e) => e.fn());
  for (const s of log.shots) {
    if (s.granted) {
      const t = text.get(s.granted);
      if (t) held.push(t);
    }
    for (const l of [...s.lines, s.hint ?? '']) if (l && s.speaker !== 'jane') check('debate', -1, l);
  }
  let solved = false;
  for (const v of log.verdicts) {
    if (solved) break;
    if (v.result === 'correct') solved = true;
    // The accepted verdict's own feedback line comes after the solve.
    if (!solved) for (const l of v.lines) check('verdict', v.asked, l);
  }
  return { leaks, level4: [...level4] };
}

export function runMetrics(log: RunLog, c: Case, index: CaseIndex, contradictions: number): RunMetrics {
  const mix = Object.fromEntries(ANSWER_CLASSES.map((k) => [k, 0])) as Record<AnswerClass, number>;
  for (const a of log.asks) mix[a.answer]++;
  const { leaks, level4 } = findLeaks(log, c, index);
  const solvedAt = log.verdicts.find((v) => v.result === 'correct');
  const last = log.verdicts[log.verdicts.length - 1];
  return {
    id: log.id,
    caseId: log.caseId,
    persona: log.persona,
    questions: log.final.asked,
    questionsToVerdict: solvedAt ? solvedAt.asked : null,
    hintsUsed: log.final.hintsUsed,
    unlocked: log.final.unlocked,
    totalFacts: log.final.totalFacts,
    stuck: stuckStreaks(log.asks),
    contradictions,
    leaks,
    level4Shown: level4,
    safetyNotices: log.asks.filter((a) => a.notice === 'support').length,
    degraded: log.asks.filter((a) => a.notice === 'degraded').length,
    debateMisses: log.final.debateMisses,
    grants: log.shots.filter((s) => s.kind === 'grant').length,
    verdictAttempts: log.verdicts.length,
    verdict: solvedAt ? 'correct' : last ? last.result : 'none',
    outcome: log.outcome,
    answerMix: mix,
    costUsd: Math.round((log.spend.jevUsd + log.spend.llmUsd) * 1e6) / 1e6,
  };
}
