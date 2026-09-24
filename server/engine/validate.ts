/**
 * Case validator: schema + semantic checks + rules self-consistency.
 * Shared by `npm run validate` (scripts/validate-cases.ts), GET /api/admin/cases and tests.
 * Pure (no Node APIs).
 */
import { CaseSchema, PROBE_KINDS, type Case, type ProbeKind } from '../../shared/case-schema.js';
import { buildCaseIndex, type CaseIndex } from './case-index.js';
import { analyze, normalize } from './normalize.js';
import { retrieve } from './retrieve.js';
import { judgeRules } from './rules-judge.js';
import { parseSegments } from './public-view.js';
import { evaluateVerdict } from './verdict.js';
import { formatZodIssues } from './registry.js';

export const REQUIRED_PROBE_KINDS: ProbeKind[] = ['yes', 'no', 'irrelevant', 'core', 'spoiler-bait', 'paraphrase', 'typo', 'negated'];
export const SELF_CONSISTENCY_MIN = 0.95;

export interface ProbeMismatch {
  q: string;
  kind: string;
  expected: string;
  got: string;
  source: string;
  score?: number;
}

export interface CaseValidation {
  caseId: string;
  path?: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
  stats?: {
    facts: number;
    probes: number;
    kinds: Partial<Record<ProbeKind, number>>;
    selfConsistency: { total: number; matched: number; rate: number; mismatches: ProbeMismatch[] };
    /** Leave-one-out: each probe judged with itself removed from the bank (generalisation). */
    generalization: { total: number; matched: number; rate: number; mismatches: ProbeMismatch[] };
  };
}

export interface ValidateOptions {
  path?: string;
  /** Skip the (slower) leave-one-out generalisation pass. */
  skipGeneralization?: boolean;
  /**
   * Checks that a public asset path (relative to public/, e.g. cases/c01/panel-1.webp) exists.
   * Injected by Node callers (npm run validate, the admin API); missing files are warnings.
   */
  assetExists?: (publicPath: string) => boolean;
}

const isHttps = (u: string) => /^https:\/\//i.test(u);

export function validateCase(input: unknown, opts: ValidateOptions = {}): CaseValidation {
  const parsed = CaseSchema.safeParse(input);
  const rawId = (input as { id?: unknown } | null)?.id;
  if (!parsed.success) {
    return {
      caseId: typeof rawId === 'string' ? rawId : '(unknown)',
      path: opts.path,
      ok: false,
      errors: formatZodIssues(parsed.error, 60).map((m) => `schema: ${m}`),
      warnings: [],
      info: [],
    };
  }
  return validateParsedCase(parsed.data, opts);
}

export function validateParsedCase(c: Case, opts: ValidateOptions = {}): CaseValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const factIds = new Set<string>();
  const facts = new Map(c.facts.map((f) => [f.id, f]));

  // ── truth / core ──────────────────────────────────────────────
  if (!c.truth.summary.trim()) errors.push('truth.summary is empty');
  if (!c.truth.causeOfDeath.trim()) errors.push('truth.causeOfDeath is empty');
  if (!c.facts.some((f) => f.importance >= 3)) errors.push('no core fact (importance ≥ 3)');
  if (!c.facts.some((f) => f.spoilerLevel >= 4)) info.push('no spoilerLevel-4 fact (nearCore relies on closeness/progress only)');

  // ── unique ids ────────────────────────────────────────────────
  for (const f of c.facts) {
    if (factIds.has(f.id)) errors.push(`duplicate fact id ${f.id}`);
    factIds.add(f.id);
  }
  const dup = <T>(items: T[], key: (x: T) => string, what: string) => {
    const seen = new Set<string>();
    for (const x of items) {
      const k = key(x);
      if (seen.has(k)) errors.push(`duplicate ${what} ${k}`);
      seen.add(k);
    }
  };
  dup(c.answerElements, (e) => e.id, 'answer element id');
  dup(c.wrongClaims, (w) => w.id, 'wrong claim id');
  dup(c.debate, (r) => r.id, 'debate round id');
  dup(c.reconstruction.panels, (p) => p.id, 'panel id');
  dup(c.scienceMemos, (m) => m.id, 'science memo id');
  dup(c.sources, (s) => s.id, 'source id');
  for (const r of c.debate) dup(r.statements, (s) => s.id, `statement id in ${r.id}:`);

  // probe duplicates (same normalised question)
  const probeByNorm = new Map<string, { answer: string; q: string }>();
  for (const p of c.probes) {
    const n = normalize(p.q);
    const prev = probeByNorm.get(n);
    if (prev) {
      if (prev.answer !== p.answer) errors.push(`conflicting probe labels for "${p.q}" (${prev.answer} vs ${p.answer})`);
      else warnings.push(`duplicate probe "${p.q}"`);
    } else probeByNorm.set(n, { answer: p.answer, q: p.q });
  }

  // ── fact references ───────────────────────────────────────────
  const ref = (id: string, where: string) => {
    if (!factIds.has(id)) errors.push(`${where} references unknown fact ${id}`);
  };
  c.probes.forEach((p, i) => p.facts.forEach((id) => ref(id, `probe #${i + 1} "${p.q}"`)));
  for (const f of c.facts) {
    f.requires.forEach((id) => ref(id, `${f.id}.requires`));
    f.related.forEach((id) => ref(id, `${f.id}.related`));
    if (f.requires.includes(f.id)) errors.push(`${f.id} requires itself`);
    if (f.importance >= 2 && f.spoilerLevel < 4 && !f.cardTitle) warnings.push(`${f.id} (importance ${f.importance}) has no cardTitle`);
    if (f.scienceMemo && !c.scienceMemos.some((m) => m.id === f.scienceMemo)) {
      warnings.push(`${f.id}.scienceMemo "${f.scienceMemo.slice(0, 20)}" is not a scienceMemos id — shown as an inline memo`);
    }
    if (f.visibleFromStart && f.spoilerLevel >= 3) warnings.push(`${f.id} is visibleFromStart but spoilerLevel ${f.spoilerLevel}`);
  }
  // requires cycles
  const visiting = new Set<string>();
  const done = new Set<string>();
  const cyc = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`requires cycle: ${[...path, id].join(' → ')}`);
      return;
    }
    visiting.add(id);
    for (const r of facts.get(id)?.requires ?? []) cyc(r, [...path, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const f of c.facts) cyc(f.id, []);
  c.science.foreshadowing.forEach((x, i) => ref(x.fact, `science.foreshadowing[${i}]`));
  c.probes.forEach((p, i) => {
    if ((p.answer === 'yes' || p.answer === 'no' || p.answer === 'partial') && p.facts.length === 0 && p.kind !== 'meta') {
      warnings.push(`probe #${i + 1} "${p.q}" is ${p.answer} but lists no facts (cannot unlock anything)`);
    }
  });

  // ── hints ─────────────────────────────────────────────────────
  if (c.hints.length !== 3) errors.push(`expected exactly 3 hints, got ${c.hints.length}`);
  const levels = c.hints.map((h) => h.level).sort().join(',');
  if (levels !== '1,2,3') errors.push(`hint levels must be 1,2,3 (got ${levels})`);

  // ── answer elements / solve rule ──────────────────────────────
  const elIds = new Set(c.answerElements.map((e) => e.id));
  for (const id of c.solveRule.required) if (!elIds.has(id)) errors.push(`solveRule.required references unknown element ${id}`);
  for (const id of c.solveRule.almost) if (!elIds.has(id)) errors.push(`solveRule.almost references unknown element ${id}`);
  for (const e of c.answerElements) {
    if (e.required && !c.solveRule.required.includes(e.id)) warnings.push(`element ${e.id} is required:true but not in solveRule.required`);
    if (!e.missingFeedback.trim()) errors.push(`element ${e.id} has empty missingFeedback`);
  }
  if (!c.solveRule.almost.every((id) => c.solveRule.required.includes(id))) warnings.push('solveRule.almost is not a subset of solveRule.required');
  // The truth itself must pass the rules verdict.
  const truthText = [c.truth.causeOfDeath, c.truth.summary, c.truth.mechanism].join('。');
  const tv = evaluateVerdict(c, truthText);
  if (tv.result !== 'correct') warnings.push(`truth text does not pass the rules verdict (${tv.result}; matched ${tv.matched.join(',') || 'none'}; wrong claims ${tv.wrongClaims.join(',') || 'none'}) — check keywordGroups`);

  // ── science / sources ─────────────────────────────────────────
  if (c.sources.length < 3) errors.push(`need ≥ 3 sources, got ${c.sources.length}`);
  for (const s of c.sources) if (!isHttps(s.url)) errors.push(`source ${s.id} url is not https: ${s.url}`);

  // ── debate ────────────────────────────────────────────────────
  for (const r of c.debate) {
    if (r.success.length === 0 || r.success.some((l) => !l.trim())) errors.push(`debate ${r.id}: success lines are missing or blank`);
    if (r.wrongShot.some((l) => !l.trim())) warnings.push(`debate ${r.id}: a wrongShot line is blank`);
    if (!r.hint.trim()) warnings.push(`debate ${r.id}: hint is blank`);
    const st = r.statements.find((s) => s.id === r.answer.statement);
    if (!st) {
      errors.push(`debate ${r.id}: answer.statement ${r.answer.statement} not found`);
    } else {
      const noise = parseSegments(st.text).filter((s) => s.noise).map((s) => s.text);
      if (!noise.some((n) => n.includes(r.answer.span))) errors.push(`debate ${r.id}: span "${r.answer.span}" is not inside [[...]] of ${st.id}`);
    }
    const reachable = (id: string, where: string, level: 'error' | 'warning') => {
      const f = facts.get(id);
      if (!f) return errors.push(`debate ${r.id}: ${where} references unknown fact ${id}`);
      if (f.spoilerLevel > 3 || f.importance < 1) (level === 'error' ? errors : warnings).push(`debate ${r.id}: ${where} fact ${id} is not usable as evidence (spoilerLevel ${f.spoilerLevel}, importance ${f.importance})`);
    };
    reachable(r.answer.fact, 'answer', 'error');
    r.alsoAccept.forEach((id) => reachable(id, 'alsoAccept', 'warning'));
    for (const s of r.statements) {
      if (!parseSegments(s.text).some((x) => x.noise)) info.push(`debate ${r.id}/${s.id} has no [[noise]] span`);
    }
  }

  // ── reconstruction / quiz ─────────────────────────────────────
  const choicePanels = c.reconstruction.panels.filter((p) => p.choice);
  if (choicePanels.length === 0) warnings.push('reconstruction has no choice panel');
  for (const p of choicePanels) {
    const n = p.choice!.options.filter((o) => o.correct).length;
    if (n !== 1) errors.push(`panel ${p.id}: ${n} correct options (expected exactly 1)`);
  }
  c.quiz.forEach((q, i) => {
    if (q.answer < 0 || q.answer >= q.choices.length) errors.push(`quiz #${i + 1}: answer index ${q.answer} out of range`);
  });

  // ── image files (warnings: art may land later than the case) ──
  if (opts.assetExists) {
    const images: [string, string | undefined][] = [
      ['assets.background', c.assets.background],
      ['victim.portrait', c.victim.portrait],
      ...c.reconstruction.panels.map((p) => [`panel ${p.id}.image`, p.image] as [string, string | undefined]),
    ];
    for (const [where, path] of images) {
      if (!path) continue;
      const rel = path.replace(/^\.?\//, '');
      if (/^(?:https?:)?\/\//i.test(path)) continue;
      if (!opts.assetExists(rel)) warnings.push(`${where}: image file not found: public/${rel}`);
    }
  }

  // ── leak terms in public fields ───────────────────────────────
  const publicFields: [string, string][] = [
    ['intro.summary', c.intro.summary],
    ['contentWarning', c.contentWarning ?? ''],
    ['intro.location', c.intro.location],
    ['intro.time', c.intro.time],
    ...c.intro.narration.map((t, i) => [`intro.narration[${i}]`, t] as [string, string]),
    ...c.intro.starterQuestions.map((t, i) => [`intro.starterQuestions[${i}]`, t] as [string, string]),
    ...c.intro.jane.map((t, i) => [`intro.jane[${i}]`, t] as [string, string]),
    ...c.intro.holma.map((t, i) => [`intro.holma[${i}]`, t] as [string, string]),
    // sent with the public case view (idle / near-core flavour during the investigation)
    ...c.holmaLines.idle.map((t, i) => [`holmaLines.idle[${i}]`, t] as [string, string]),
    ...c.holmaLines.nearCore.map((t, i) => [`holmaLines.nearCore[${i}]`, t] as [string, string]),
    ...c.scienceMemos.map((m) => [`scienceMemos.${m.id}`, `${m.title} ${m.text}`] as [string, string]),
    ...c.facts.filter((f) => f.spoilerLevel <= 2).flatMap((f) => [[`${f.id}.text`, f.text], [`${f.id}.cardTitle`, f.cardTitle ?? '']] as [string, string][]),
  ];
  const leak = c.leakTerms.map((t) => [t, normalize(t)] as const).filter(([, n]) => n.length > 0);
  for (const [where, text] of publicFields) {
    const n = normalize(text);
    for (const [t, nt] of leak) if (n.includes(nt)) errors.push(`leak term "${t}" appears in public field ${where}`);
  }

  // ── probe kinds ───────────────────────────────────────────────
  const kinds: Partial<Record<ProbeKind, number>> = {};
  for (const p of c.probes) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
  const missingKinds = REQUIRED_PROBE_KINDS.filter((k) => !kinds[k]);
  if (missingKinds.length > 0) errors.push(`probes missing kinds: ${missingKinds.join(', ')}`);
  const unusedKinds = PROBE_KINDS.filter((k) => !kinds[k] && !REQUIRED_PROBE_KINDS.includes(k));
  if (unusedKinds.length > 0) info.push(`optional probe kinds not covered: ${unusedKinds.join(', ')}`);

  // ── probe coverage per fact ───────────────────────────────────
  const touched = new Set(c.probes.flatMap((p) => p.facts));
  for (const f of c.facts) if (!touched.has(f.id) && !f.visibleFromStart) warnings.push(`no probe touches ${f.id} (${f.text.slice(0, 24)}…)`);

  // ── rules self-consistency ────────────────────────────────────
  const index = buildCaseIndex(c);
  const self = runProbes(c, index, false);
  if (self.rate < SELF_CONSISTENCY_MIN) {
    errors.push(`rules self-consistency ${(self.rate * 100).toFixed(1)}% < ${SELF_CONSISTENCY_MIN * 100}% (${self.mismatches.length} mismatches)`);
  }
  for (const m of self.mismatches.slice(0, 20)) warnings.push(`probe "${m.q}" [${m.kind}] expected ${m.expected}, rules gave ${m.got} via ${m.source}`);
  const gen = opts.skipGeneralization ? { total: 0, matched: 0, rate: 0, mismatches: [] } : runProbes(c, index, true);
  if (!opts.skipGeneralization) info.push(`rules generalisation (leave-one-out): ${(gen.rate * 100).toFixed(1)}% of ${gen.total}`);

  return {
    caseId: c.id,
    path: opts.path,
    ok: errors.length === 0,
    errors,
    warnings,
    info,
    stats: { facts: c.facts.length, probes: c.probes.length, kinds, selfConsistency: self, generalization: gen },
  };
}

/** Runs every probe through the rules judge (optionally with that probe left out of the bank). */
export function runProbes(c: Case, index: CaseIndex, leaveOneOut: boolean) {
  const mismatches: ProbeMismatch[] = [];
  let matched = 0;
  c.probes.forEach((p, i) => {
    const q = analyze(p.q);
    const idx: CaseIndex = leaveOneOut ? { ...index, probes: index.probes.filter((x) => x.index !== i) } : index;
    const d = judgeRules(q, retrieve(q, idx), idx);
    if (d.answerClass === p.answer) matched++;
    else mismatches.push({ q: p.q, kind: p.kind, expected: p.answer, got: d.answerClass, source: d.source, score: d.probe?.score });
  });
  const total = c.probes.length;
  return { total, matched, rate: total === 0 ? 1 : Math.round((matched / total) * 1000) / 1000, mismatches };
}
