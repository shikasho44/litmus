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
import { PROTO_CASES } from '../../shared/proto.js';
import { caseShelf } from '../../shared/shelf.js';

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

  // A prototype case (shared/proto.ts) is checked like a published one. The browser mirrors its id
  // in PROTO_CASES (to keep its save out of the totals without the switch): they must agree.
  const shipped = c.publish || !!c.proto;
  if (c.proto && PROTO_CASES[c.id] !== c.proto) errors.push(`proto "${c.proto}": add "${c.id}": '${c.proto}' to PROTO_CASES in shared/proto.ts (the browser's copy)`);
  if (!c.proto && Object.prototype.hasOwnProperty.call(PROTO_CASES, c.id)) errors.push(`PROTO_CASES in shared/proto.ts lists ${c.id}, but the case has no proto field`);
  // the 事件ファイル shelf (shared/shelf.ts): the リトマス・ラボ holds only lab prototypes, and a lab
  // prototype never stands among the official shelves
  if (caseShelf(c) === 'lab' && c.proto !== 'lab') errors.push(`shelf "lab" needs proto: "lab" (the リトマス・ラボ shelf exists only behind ?proto=lab)`);
  if (c.proto === 'lab' && caseShelf(c) !== 'lab') errors.push(`proto "lab" on shelf "${caseShelf(c)}": a リトマス・ラボ puzzle stands on the lab shelf`);
  if (caseShelf(c) === 'kurare' && c.reviewStatus === 'draft-ai') warnings.push('shelf "kurare" with reviewStatus draft-ai: let the AI review run before it goes on the くられ先生監修 shelf');
  if (c.proto && c.publish) warnings.push(`proto "${c.proto}" with publish: true — keep publish: false, so the case stays out of the public list if the proto field is dropped`);

  // ── truth / core ──────────────────────────────────────────────
  if (!c.truth.summary.trim()) errors.push('truth.summary is empty');
  if (!c.truth.causeOfDeath.trim()) errors.push('truth.causeOfDeath is empty');
  if (!c.facts.some((f) => f.importance >= 3)) errors.push('no core fact (importance ≥ 3)');
  if (!c.facts.some((f) => f.spoilerLevel >= 4)) info.push('no spoilerLevel-4 fact (nearCore relies on closeness/progress only)');

  // ── manner of death / culprit seal (sealed again 2026-09-30) ──
  // The manner fact is sealed during the investigation (manner.ts): no question reaches it, only the
  // planned スペシャルヒント (mannerReveal). It must not be a starting card, a probe's finding or
  // inquest evidence.
  const mannerFacts = c.facts.filter((f) => f.manner);
  if (mannerFacts.length > 1) errors.push(`more than one manner fact (${mannerFacts.map((f) => f.id).join(', ')})`);
  if (mannerFacts.length === 0 && shipped) warnings.push('no manner fact (fact.manner): the planned special hint would have nothing to reveal');
  for (const f of mannerFacts) {
    if (f.spoilerLevel >= 4) errors.push(`${f.id}: the manner fact must be a card the special hint can show (spoilerLevel ≤ 3)`);
    if (f.visibleFromStart) errors.push(`${f.id}: the manner fact is sealed and must not be visibleFromStart`);
    c.probes.forEach((p, i) => {
      if (p.facts.includes(f.id)) errors.push(`probe #${i + 1} "${p.q}" references the sealed manner fact ${f.id}`);
    });
    for (const r of c.debate) if (r.answer.fact === f.id || r.alsoAccept.includes(f.id)) errors.push(`debate ${r.id} uses the sealed manner fact ${f.id} as evidence`);
    for (const g of c.facts) if (g.requires.includes(f.id)) errors.push(`${g.id} requires the sealed manner fact ${f.id}`);
  }
  if (c.truth.culpritSeal && mannerFacts.length > 0 && mannerFacts[0].manner !== 'homicide') {
    warnings.push(`truth.culpritSeal is set but the manner fact ${mannerFacts[0].id} says ${mannerFacts[0].manner} (the seal is for cases whose verdict names a culprit)`);
  }

  // ── PROTOTYPE I-005 (2026-10-03): サイエンスヒント・矛盾の一文・余話 ──────
  validatePrototypeI005(c, errors, warnings);

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

  // ── verdict modes (difficulty) ────────────────────────────────
  validateVerdictModes(c, errors, warnings, info);

  // ── no portrait art (2026-10-04, the I-001 リトマス・ラボ samples): the shard portrait draws the outline ──
  if (!c.victim.portrait.trim() && !/^[Mm]/.test(c.victim.silhouette ?? '')) {
    warnings.push('victim.portrait is empty but victim.silhouette is not an SVG path: the shard portrait would fall back to the bust of a person');
  }

  // ── image files (warnings: art may land later than the case) ──
  if (opts.assetExists) {
    const images: [string, string | undefined][] = [
      ['assets.background', c.assets.background],
      ['victim.portrait', c.victim.portrait],
      ['victim.shardPortrait', c.victim.shardPortrait],
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
    // 矛盾の一文 (prototype I-005): on the case file card and the intro title card, before anything is asked
    ['intro.hook', c.intro.hook ?? ''],
    ['contentWarning', c.contentWarning ?? ''],
    ['intro.location', c.intro.location],
    ['intro.time', c.intro.time],
    ...c.intro.narration.map((t, i) => [`intro.narration[${i}]`, t] as [string, string]),
    ...c.intro.starterQuestions.map((t, i) => [`intro.starterQuestions[${i}]`, t] as [string, string]),
    ...(c.intro.exampleQuestions ?? []).map((t, i) => [`intro.exampleQuestions[${i}]`, t] as [string, string]),
    ...c.intro.jane.map((t, i) => [`intro.jane[${i}]`, t] as [string, string]),
    ...c.intro.holma.map((t, i) => [`intro.holma[${i}]`, t] as [string, string]),
    // sent with the public case view (idle / near-core flavour during the investigation)
    ...c.holmaLines.idle.map((t, i) => [`holmaLines.idle[${i}]`, t] as [string, string]),
    ...c.holmaLines.nearCore.map((t, i) => [`holmaLines.nearCore[${i}]`, t] as [string, string]),
    // Holma's free nudges (shared/budget.ts), also sent with the public case view
    ...(c.nudges ?? []).map((t, i) => [`nudges[${i}]`, t] as [string, string]),
    ...c.scienceMemos.map((m) => [`scienceMemos.${m.id}`, `${m.title} ${m.text}`] as [string, string]),
    ...c.facts.filter((f) => f.spoilerLevel <= 2).flatMap((f) => [[`${f.id}.text`, f.text], [`${f.id}.cardTitle`, f.cardTitle ?? '']] as [string, string][]),
  ];
  const leak = c.leakTerms.map((t) => [t, normalize(t)] as const).filter(([, n]) => n.length > 0);
  for (const [where, text] of publicFields) {
    const n = normalize(text);
    for (const [t, nt] of leak) if (n.includes(nt)) errors.push(`leak term "${t}" appears in public field ${where}`);
  }
  // Holma's replies to a failed verdict and the verdict prompts are read BEFORE the solve (by the
  // players who have not found the answer yet), so they get the same scan (2026-09-30, the c07
  // wrong-verdict replies said 花／花びん／茎／バラ). The choice options and the cloze sentence /
  // options are not scanned here: they carry the answer by design (see secretTerms below).
  const vmPre = c.verdictModes;
  const replyFields: [string, string][] = [
    ...c.wrongClaims.map((w) => [`wrongClaims.${w.id}.feedback`, w.feedback] as [string, string]),
    ...c.answerElements.map((e) => [`answerElements.${e.id}.missingFeedback`, e.missingFeedback] as [string, string]),
    ...(vmPre
      ? ([
          ['verdictModes.choice.prompt', vmPre.choice.prompt],
          ['verdictModes.cloze.prompt', vmPre.cloze.prompt],
          ...vmPre.cloze.blanks.map((b) => [`verdictModes.cloze.${b.id}.label`, b.label] as [string, string]),
        ] as [string, string][])
      : []),
  ];
  for (const [where, text] of replyFields) {
    const n = normalize(text);
    for (const [t, nt] of leak) if (n.includes(nt)) errors.push(`leak term "${t}" appears in pre-solve reply ${where}`);
  }
  // secretTerms: words that must stay hidden even in the verdict choices and the cloze (e.g. c07's
  // identity — flower, stem, vase). Scanned over every text a player reads without having asked
  // for it (findings and science memos that open on the player's own question are exempt).
  const secret = (c.secretTerms ?? []).map((t) => [t, normalize(t)] as const).filter(([, n]) => n.length > 0);
  if (secret.length > 0) {
    const preSolve: [string, string][] = [
      ['title', c.title],
      ['titleEn', c.titleEn],
      ...c.categories.map((t, i) => [`categories[${i}]`, t] as [string, string]),
      ...publicFields.filter(([where]) => !/^(?:F\d+\.|scienceMemos\.)/.test(where)),
      ...c.facts.filter((f) => f.visibleFromStart).flatMap((f) => [[`${f.id}.text`, f.text], [`${f.id}.cardTitle`, f.cardTitle ?? '']] as [string, string][]),
      ...replyFields,
      ...c.hints.map((h) => [`hint ${h.level}`, h.text] as [string, string]),
      ...c.debate.flatMap((r) =>
        [r.title, ...r.intro, ...r.statements.map((s) => s.text), ...r.success, ...r.wrongShot, r.hint].map((t) => [`debate ${r.id}`, t] as [string, string]),
      ),
      ...(vmPre
        ? ([
            ...vmPre.choice.options.map((o) => [`verdictModes.choice.${o.id}`, o.text] as [string, string]),
            ['verdictModes.cloze.template', vmPre.cloze.template],
            ...vmPre.cloze.blanks.flatMap((b) => b.options.map((o, i) => [`verdictModes.cloze.${b.id}[${i}]`, o] as [string, string])),
          ] as [string, string][])
        : []),
    ];
    for (const [where, text] of preSolve) {
      const n = normalize(text);
      for (const [t, nt] of secret) if (n.includes(nt)) errors.push(`secret term "${t}" appears before the solve in ${where}`);
    }
  }
  // Debate lines must not bring in an object the player has never been shown (docs/decisions.md
  // 2026-09-30, the "abrupt pieces" audit). Cheap check: katakana nouns (≥ 3 letters) in debate
  // statements that appear nowhere in the pre-solve public text. Warning only.
  const introPool = normalize(
    [
      c.intro.summary,
      c.intro.location,
      c.intro.time,
      ...c.intro.narration,
      ...c.intro.jane,
      ...c.intro.holma,
      ...c.intro.starterQuestions,
      ...(c.intro.exampleQuestions ?? []),
      ...c.facts.filter((f) => f.visibleFromStart).map((f) => f.text),
    ].join('\n'),
  );
  for (const r of c.debate) {
    for (const s of r.statements) {
      const nouns = (s.text.replace(/\[\[|\]\]/g, '').match(/[ァ-ヴー]{3,}/gu) ?? []).filter((w) => !/^ク(?:ック)+$|^ククッ$/u.test(w));
      const unseen = [...new Set(nouns)].filter((w) => !introPool.includes(normalize(w)));
      if (unseen.length > 0) warnings.push(`debate ${r.id}/${s.id} names ${unseen.map((w) => `「${w}」`).join('')}, which the case file, intro and example questions never show (set it up before the inquest)`);
    }
  }

  // ── question budget override / nudges (shared/budget.ts) ──────
  const qb = c.questionBudget;
  if (qb) {
    if (qb.easy !== undefined && qb.normal !== undefined && qb.easy < qb.normal) warnings.push(`questionBudget: easy (${qb.easy}) is smaller than normal (${qb.normal})`);
    if (qb.normal !== undefined && qb.hard !== undefined && qb.normal < qb.hard) warnings.push(`questionBudget: normal (${qb.normal}) is smaller than hard (${qb.hard})`);
  }
  if (c.nudges && new Set(c.nudges).size !== c.nudges.length) warnings.push('nudges: duplicate lines (each is said at most once per run)');

  // ── example questions (the 「質問の例」 cards, 2026-09-29) ─────────────
  // Each one is a probe, so the rules self-consistency below checks the judge answers it as labelled.
  const exampleSeen = new Set(c.intro.starterQuestions.map((q) => normalize(q)));
  (c.intro.exampleQuestions ?? []).forEach((q, i) => {
    const n = normalize(q);
    if (!probeByNorm.has(n)) errors.push(`intro.exampleQuestions[${i}] "${q}" has no probe (add one so the rules judge's answer is checked)`);
    if (exampleSeen.has(n)) warnings.push(`intro.exampleQuestions[${i}] "${q}" repeats a starter or another example`);
    exampleSeen.add(n);
  });

  // ── probe kinds ───────────────────────────────────────────────
  const kinds: Partial<Record<ProbeKind, number>> = {};
  for (const p of c.probes) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
  const missingKinds = REQUIRED_PROBE_KINDS.filter((k) => !kinds[k]);
  if (missingKinds.length > 0) errors.push(`probes missing kinds: ${missingKinds.join(', ')}`);
  const unusedKinds = PROBE_KINDS.filter((k) => !kinds[k] && !REQUIRED_PROBE_KINDS.includes(k));
  if (unusedKinds.length > 0) info.push(`optional probe kinds not covered: ${unusedKinds.join(', ')}`);

  // ── probe coverage per fact ───────────────────────────────────
  const touched = new Set(c.probes.flatMap((p) => p.facts));
  for (const f of c.facts) if (!touched.has(f.id) && !f.visibleFromStart && !f.manner) warnings.push(`no probe touches ${f.id} (${f.text.slice(0, 24)}…)`);

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

/** Dose / lethality wording that an aside (a story told after the solve) must never carry. */
const ASIDE_DANGER = /致死量|致死濃度|致死率|ld50|ld 50|mg\/kg|ミリグラム毎|何グラムで|何ミリで|作り方|作りかた|入手方法/iu;

/**
 * PROTOTYPE I-005 (docs/decisions.md 2026-10-03): the optional data of the four ideas from the
 * supervisor's original design. The hook's leakTerms / secretTerms scan runs with the other public
 * fields below (it is pre-solve text); the aside is post-solve (shown with the science), so it is
 * not scanned for leakTerms, but it gets the safety and sources checks here.
 */
function validatePrototypeI005(c: Case, errors: string[], warnings: string[]): void {
  // サイエンスヒント: at most one, a finding the player earns by asking, never the answer itself
  const hints = c.facts.filter((f) => f.scienceHint);
  if (hints.length > 1) errors.push(`more than one scienceHint fact (${hints.map((f) => f.id).join(', ')}) — the case has one サイエンスヒント`);
  for (const f of hints) {
    if (f.manner) errors.push(`${f.id}: the scienceHint must not be the sealed manner fact`);
    if (f.spoilerLevel >= 4 || f.importance >= 4) errors.push(`${f.id}: the scienceHint is the answer itself (importance ${f.importance}, spoilerLevel ${f.spoilerLevel}) — mark a finding that leads there`);
    if (f.visibleFromStart) errors.push(`${f.id}: the scienceHint must be earned by asking (not visibleFromStart)`);
  }
  // 矛盾の一文: a restatement of the case file; never a finding's card title (cheap check)
  const hook = c.intro.hook?.trim();
  if (hook) {
    const nh = normalize(hook);
    if (nh === normalize(c.title)) errors.push('intro.hook repeats the title');
    for (const f of c.facts) {
      const t = f.cardTitle ? normalize(f.cardTitle) : '';
      if (!f.visibleFromStart && t.length >= 4 && nh.includes(t)) warnings.push(`intro.hook names the finding ${f.id} 「${f.cardTitle}」 — the hook may only restate the case file and the prologue`);
    }
  }
  // 余話: true, sourced, nothing dangerous; its sources do not collide with the case's
  const aside = c.science.aside;
  if (aside) {
    if (ASIDE_DANGER.test(`${aside.title} ${aside.text}`)) errors.push('science.aside: dose / lethality / how-to wording (an aside tells history and science, never methods or amounts)');
    const caseIds = new Set(c.sources.map((s) => s.id));
    const seen = new Set<string>();
    for (const s of aside.sources) {
      if (!isHttps(s.url)) errors.push(`science.aside source ${s.id} url is not https: ${s.url}`);
      if (caseIds.has(s.id) || seen.has(s.id)) errors.push(`science.aside source id ${s.id} is not unique`);
      seen.add(s.id);
    }
  }
}

/** Option ids are sent to the browser: an id that names its own correctness gives the answer away. */
const TELLTALE_ID = /(?:^|[-_])(?:correct|incorrect|right|wrong|answer|true|false|dummy|decoy|fake|trap|seikai|fuseikai|hazure|atari|ok|ng)(?:$|[-_\d])/;
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * verdictModes (choice / cloze / assists). They are only shown at the verdict, so leakTerms may
 * appear in them (not scanned). A published case without them only warns (UI falls back to free).
 */
function validateVerdictModes(c: Case, errors: string[], warnings: string[], info: string[]): void {
  const vm = c.verdictModes;
  if (!vm) {
    if (c.publish || c.proto) warnings.push('no verdictModes: easy / normal difficulty fall back to the free-text verdict');
    return;
  }
  // choice
  const opts = vm.choice.options;
  const nCorrect = opts.filter((o) => o.correct).length;
  if (nCorrect !== 1) errors.push(`verdictModes.choice: ${nCorrect} correct options (expected exactly 1)`);
  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();
  for (const o of opts) {
    if (seenIds.has(o.id)) errors.push(`verdictModes.choice: duplicate option id ${o.id}`);
    seenIds.add(o.id);
    if (!o.text.trim()) errors.push(`verdictModes.choice: option ${o.id} has empty text`);
    else if (seenTexts.has(normalize(o.text))) errors.push(`verdictModes.choice: option ${o.id} repeats another option's text`);
    seenTexts.add(normalize(o.text));
    if (TELLTALE_ID.test(o.id.toLowerCase())) errors.push(`verdictModes.choice: option id "${o.id}" hints at its correctness (ids are sent to the browser — use neutral ids)`);
  }
  if (!vm.choice.prompt.trim()) warnings.push('verdictModes.choice.prompt is empty');
  const right = opts.find((o) => o.correct);
  const wrongOpts = opts.filter((o) => !o.correct);
  if (right && wrongOpts.length > 0) {
    const longestWrong = Math.max(...wrongOpts.map((o) => [...o.text].length));
    const len = [...right.text].length;
    if (len >= longestWrong * 1.4 && len - longestWrong >= 6) warnings.push(`verdictModes.choice: the correct option (${len} chars) is much longer than every wrong one (≤ ${longestWrong}) — players pick the longest`);
    const rv = evaluateVerdict(c, right.text);
    if (rv.wrongClaims.length > 0) warnings.push(`verdictModes.choice: the correct option ${right.id} affirms wrong claim(s) ${rv.wrongClaims.join(',')}`);
  }
  for (const o of wrongOpts) {
    if (evaluateVerdict(c, o.text).result === 'correct') warnings.push(`verdictModes.choice: wrong option ${o.id} passes the free-text verdict as correct — is it mislabelled?`);
  }

  // cloze
  const blanks = vm.cloze.blanks;
  const blankIds = new Set<string>();
  for (const b of blanks) {
    if (blankIds.has(b.id)) errors.push(`verdictModes.cloze: duplicate blank id ${b.id}`);
    blankIds.add(b.id);
    if (b.answer >= b.options.length) errors.push(`verdictModes.cloze: blank ${b.id} answer index ${b.answer} out of range (${b.options.length} options)`);
    const texts = b.options.map(normalize);
    if (new Set(texts).size !== texts.length) errors.push(`verdictModes.cloze: blank ${b.id} has duplicate options`);
    if (b.options.some((t) => !t.trim())) errors.push(`verdictModes.cloze: blank ${b.id} has an empty option`);
    if (!b.label.trim()) warnings.push(`verdictModes.cloze: blank ${b.id} has an empty label`);
  }
  const used = [...vm.cloze.template.matchAll(PLACEHOLDER)].map((m) => m[1]);
  for (const id of new Set(used)) if (!blankIds.has(id)) errors.push(`verdictModes.cloze: template placeholder {{${id}}} has no blank`);
  for (const id of blankIds) {
    const n = used.filter((u) => u === id).length;
    if (n === 0) errors.push(`verdictModes.cloze: blank ${id} is not in the template`);
    else if (n > 1) warnings.push(`verdictModes.cloze: blank ${id} appears ${n} times in the template`);
  }
  if (/\{\{|\}\}/.test(vm.cloze.template.replace(PLACEHOLDER, ''))) errors.push('verdictModes.cloze: template has an unbalanced {{ or }}');
  if (errors.every((e) => !e.startsWith('verdictModes.cloze'))) {
    const filled = vm.cloze.template.replace(PLACEHOLDER, (_, id: string) => {
      const b = blanks.find((x) => x.id === id);
      return b ? b.options[b.answer] : '';
    });
    const fv = evaluateVerdict(c, filled);
    if (fv.result !== 'correct') info.push(`verdictModes.cloze: the completed sentence is "${fv.result}" under the free-text verdict (matched ${fv.matched.join(',') || 'none'})`);
  }

  // assists
  const rounds = new Set(c.debate.map((r) => r.id));
  const elements = new Set(c.answerElements.map((e) => e.id));
  const removed = new Set<string>();
  const filledBlanks = new Set<string>();
  const revealed = new Set<string>();
  vm.assists.forEach((a, i) => {
    const at = `verdictModes.assists[${i}]`;
    if (!rounds.has(a.round)) errors.push(`${at}: unknown debate round ${a.round}`);
    if (!a.removeOption && !a.fillBlank && !a.element) warnings.push(`${at}: gives nothing (no removeOption / fillBlank / element)`);
    if (a.removeOption) {
      const o = opts.find((x) => x.id === a.removeOption);
      if (!o) errors.push(`${at}: removeOption ${a.removeOption} is not a choice option`);
      else if (o.correct) errors.push(`${at}: removeOption ${a.removeOption} is the CORRECT option (must be a wrong one)`);
      else if (removed.has(o.id)) warnings.push(`${at}: option ${o.id} is already removed by another assist`);
      removed.add(a.removeOption);
    }
    if (a.fillBlank) {
      if (!blankIds.has(a.fillBlank)) errors.push(`${at}: fillBlank ${a.fillBlank} is not a cloze blank`);
      else if (filledBlanks.has(a.fillBlank)) warnings.push(`${at}: blank ${a.fillBlank} is already filled by another assist`);
      filledBlanks.add(a.fillBlank);
    }
    if (a.element) {
      if (!elements.has(a.element)) errors.push(`${at}: element ${a.element} is not an answer element`);
      else if (revealed.has(a.element)) warnings.push(`${at}: element ${a.element} is already revealed by another assist`);
      revealed.add(a.element);
    }
  });
  if (wrongOpts.length > 0 && wrongOpts.every((o) => removed.has(o.id))) warnings.push('verdictModes.assists remove every wrong choice option (the choice verdict answers itself once all rounds are cleared)');
  if (blanks.length > 0 && blanks.every((b) => filledBlanks.has(b.id))) warnings.push('verdictModes.assists fill every cloze blank (the cloze verdict answers itself once all rounds are cleared)');
  const noAssist = c.debate.filter((r) => !vm.assists.some((a) => a.round === r.id)).map((r) => r.id);
  if (noAssist.length > 0 && vm.assists.length > 0) info.push(`verdictModes: debate round(s) ${noAssist.join(', ')} earn no assist`);
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
