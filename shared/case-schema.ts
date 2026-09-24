/**
 * Case data contract — the single source of truth for what a case file contains.
 *
 * A case is a small, closed knowledge base. Everything the game can ever say about
 * the case must be derivable from this file. The AI never invents truth; it only
 * classifies questions against these facts and (optionally) phrases the answer.
 *
 * Secret vs public: the server strips everything marked SECRET before sending a case
 * to the browser (see server/engine/public-view.ts). Only facts the player has
 * unlocked, and the solution after the verdict is accepted, ever leave the server.
 */
import { z } from 'zod';
import { ANSWER_CLASSES, FACT_CATEGORIES, PROBE_KINDS } from './constants';

// The enum constants live in the zod-free ./constants (the browser imports them from there);
// re-exported here so server code and scripts can keep a single import site.
export { ANSWER_CLASSES, FACT_CATEGORIES, PROBE_KINDS };
export type { AnswerClass, FactCategory, ProbeKind } from './constants';

const id = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const FactSchema = z.object({
  id: z.string().regex(/^F\d{2,3}$/),
  /** The fact as a plain, true, player-facing sentence. Shown on the 所見 card once unlocked. */
  text: z.string().min(4),
  category: z.enum(FACT_CATEGORIES),
  /** 0 atmosphere · 1 supporting · 2 important · 3 core · 4 practically the answer */
  importance: z.number().int().min(0).max(4),
  /**
   * 0 answer freely · 1 only when asked · 2 only when asked specifically ·
   * 3 never volunteered, unlock only on a specific matching question ·
   * 4 never unlocked during investigation (revealed at the solution only)
   */
  spoilerLevel: z.number().int().min(0).max(4),
  visibleFromStart: z.boolean().default(false),
  /** Retrieval vocabulary: words, synonyms, kana variants, common misspellings. */
  keywords: z.array(z.string().min(1)).min(1),
  /**
   * Offline (rules) judge polarity: the right answer when a player asks an affirmative
   * question about this fact's topic. e.g. topic 毒 → fact "毒物は検出されなかった" → 'no'.
   */
  ifAsked: z.enum(['yes', 'no', 'partial']),
  /** Facts that must already be unlocked before this one can unlock. */
  requires: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  /** Short card title (≤14 chars) for 所見 cards. Required when importance ≥ 2. */
  cardTitle: z.string().max(18).optional(),
  /** Icon key for the card (see src/ui/icons.ts). */
  icon: z.string().optional(),
  /** Science memo unlocked together with this fact. */
  scienceMemo: z.string().optional(),
  /** SECRET. Extra context for the judge model only (never shown). */
  judgeNote: z.string().optional(),
});
export type Fact = z.infer<typeof FactSchema>;

export const ProbeSchema = z.object({
  q: z.string().min(2),
  answer: z.enum(ANSWER_CLASSES),
  /** Facts this question is about (empty for irrelevant / meta). */
  facts: z.array(z.string()).default([]),
  kind: z.enum(PROBE_KINDS),
  note: z.string().optional(),
});
export type Probe = z.infer<typeof ProbeSchema>;

export const AnswerElementSchema = z.object({
  id: z.string().regex(/^[A-Z]$/),
  label: z.string(),                         // e.g. 直接死因
  description: z.string(),                   // what a correct deduction must express
  required: z.boolean(),
  /** Rules matching: element matches if ANY group has ALL of its words (after normalisation). */
  keywordGroups: z.array(z.array(z.string().min(1)).min(1)).min(1),
  /** Proposition for the judge model: "推理文は〜と述べている". */
  judgeClaim: z.string(),
  /** Holma's nudge when this element is missing (must not give the answer away). */
  missingFeedback: z.string(),
});
export type AnswerElement = z.infer<typeof AnswerElementSchema>;

export const WrongClaimSchema = z.object({
  id: z.string(),
  keywordGroups: z.array(z.array(z.string().min(1)).min(1)).min(1),
  judgeClaim: z.string(),
  feedback: z.string(),
});

export const DebateStatementSchema = z.object({
  id: id,
  speaker: z.enum(['jane', 'holma']),
  /** Text with noise spans marked as [[...]]. e.g. "きっと[[毒]]を盛られたのよ" */
  text: z.string(),
});
export const DebateRoundSchema = z.object({
  id: id,
  title: z.string(),                         // e.g. 記憶のノイズ ①
  intro: z.array(z.string()).min(1),         // Holma/Jane lines before the round
  statements: z.array(DebateStatementSchema).min(3).max(6),
  /** The single correct shot: statement id + the exact noise span text + fact id. */
  answer: z.object({ statement: z.string(), span: z.string(), fact: z.string() }),
  /** Also-acceptable fact ids for the same span (optional). */
  alsoAccept: z.array(z.string()).default([]),
  success: z.array(z.string()).min(1),       // lines after a correct refutation
  wrongShot: z.array(z.string()).min(1),     // Holma teases on a wrong shot
  hint: z.string(),                          // shown after 2 misses
});
export type DebateRound = z.infer<typeof DebateRoundSchema>;

export const PanelSchema = z.object({
  id: id,
  image: z.string().optional(),              // path under public/, e.g. cases/c01/panel-1.webp
  /** Visual fallback description (also the image-generation brief). */
  scene: z.string(),
  caption: z.string(),                       // narration shown under the panel once filled
  /** If present, the panel starts blank and the player must pick the right piece. */
  choice: z.object({
    prompt: z.string(),
    options: z.array(z.object({ text: z.string(), correct: z.boolean() })).min(3).max(4),
  }).optional(),
});

export const QuizSchema = z.object({
  q: z.string(),
  choices: z.array(z.string()).min(3).max(4),
  answer: z.number().int().min(0),
  explain: z.string(),
});

export const SourceSchema = z.object({
  id: id,
  title: z.string(),
  organization: z.string(),
  url: z.string().url(),
  publicationDate: z.string().optional(),
  accessedDate: z.string(),
  type: z.enum(['government', 'academic', 'medical', 'society', 'university', 'other']),
  /** Which statements in the science section this source supports. */
  supports: z.string(),
});

export const DiagramSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('levels'),               // vertical ladder of thresholds (O2 %, body temp …)
    title: z.string(),
    unit: z.string(),
    min: z.number(), max: z.number(),
    levels: z.array(z.object({ value: z.number(), label: z.string(), detail: z.string(), tone: z.enum(['safe', 'warn', 'danger', 'fatal', 'note']) })).min(2),
    marker: z.object({ value: z.number(), label: z.string() }).optional(),
    source: z.string(),
  }),
  z.object({
    kind: z.literal('ecg'),                  // ECG trace with a highlighted vulnerable window
    title: z.string(),
    windowLabel: z.string(),
    windowDetail: z.string(),
    /** Name + one-line explanation of the rhythm after the impact (case data, so the answer
     *  never sits in the Science JS chunk; the diagram falls back to neutral wording). */
    rhythmLabel: z.string().optional(),
    rhythmDetail: z.string().optional(),
    source: z.string(),
  }),
  z.object({
    kind: z.literal('ratio'),                // "1 → 700" style expansion / comparison
    title: z.string(),
    from: z.object({ value: z.string(), label: z.string() }),
    to: z.object({ value: z.string(), label: z.string() }),
    detail: z.string(),
    source: z.string(),
  }),
]);

export const ScienceSchema = z.object({
  title: z.string(),                         // この事件の科学: 〜
  causeName: z.string(),                     // 今回の死因（正式名）
  lead: z.string(),                          // one-paragraph plain summary
  /** 原因 → 科学現象 → 人体への影響 → 結果 */
  chain: z.array(z.object({ stage: z.enum(['原因', '科学現象', '人体への影響', '結果']), title: z.string(), detail: z.string() })).length(4),
  body: z.string(),                          // 何が身体で起きたのか
  whyHere: z.string(),                       // なぜこの状況で起きたのか
  foreshadowing: z.array(z.object({ fact: z.string(), meaning: z.string() })).min(2),
  mechanism: z.array(z.object({ heading: z.string(), text: z.string() })).min(2),
  diagrams: z.array(DiagramSchema).min(1),
  misconceptions: z.array(z.object({ myth: z.string(), truth: z.string() })).min(2),
  everyday: z.array(z.string()).min(2),
  takeaways: z.array(z.string()).min(2).max(4),
  safetyNote: z.string(),                    // prevention / what to do (never how to harm)
});

export const ScienceMemoSchema = z.object({
  id: id,
  title: z.string(),
  /** Related concept only — must not state the cause of death. */
  text: z.string(),
});

export const CaseSchema = z.object({
  id: z.string().regex(/^c\d{2}-[a-z0-9-]+$/),
  number: z.number().int().min(1),
  title: z.string(),                         // e.g. 息のない部屋
  titleEn: z.string(),                       // e.g. THE ROOM WITHOUT BREATH
  difficulty: z.number().int().min(1).max(3),
  categories: z.array(z.string()).min(1),    // e.g. ['化学', '生理学']
  estimatedMinutes: z.number().int().min(5),
  publish: z.boolean(),
  reviewStatus: z.enum(['draft-ai', 'ai-reviewed', 'human-reviewed']),
  contentWarning: z.string().optional(),

  intro: z.object({
    summary: z.string(),                     // 2–4 sentence case card text, ends with a question
    location: z.string(),
    time: z.string(),
    narration: z.array(z.string()).min(3),   // cinematic intro lines (discovery scene)
    jane: z.array(z.string()).min(2),        // Jane Doe's fragmented first words
    holma: z.array(z.string()).min(2),       // Holma's opening lines
    starterQuestions: z.array(z.string()).min(3).max(6), // suggestion chips for newcomers
  }),

  /** SECRET until solved (except codename & look). */
  victim: z.object({
    codename: z.string(),                    // ジェーン・ドゥ #01
    name: z.string(),
    nameKana: z.string(),
    age: z.number().int(),
    occupation: z.string(),
    portrait: z.string(),                    // public path
    lookBrief: z.string(),                   // appearance brief for art (public: silhouette only)
    farewell: z.array(z.string()).min(2),    // her last words once her identity is restored
  }),

  assets: z.object({
    background: z.string(),                  // case scene background (public path)
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),

  /** SECRET */
  truth: z.object({
    summary: z.string(),
    causeOfDeath: z.string(),
    mechanism: z.string(),
    timeline: z.array(z.object({ time: z.string(), event: z.string() })).min(4),
  }),

  facts: z.array(FactSchema).min(15),
  probes: z.array(ProbeSchema).min(50),
  hints: z.array(z.object({ level: z.number().int().min(1).max(3), text: z.string() })).length(3),

  answerElements: z.array(AnswerElementSchema).min(2).max(5),
  wrongClaims: z.array(WrongClaimSchema).default([]),
  /** Element ids that must all match for a full solve. */
  solveRule: z.object({ required: z.array(z.string()).min(1), almost: z.array(z.string()).min(1) }),

  debate: z.array(DebateRoundSchema).min(1).max(3),
  reconstruction: z.object({
    intro: z.string(),
    panels: z.array(PanelSchema).min(4).max(6),
    finale: z.array(z.string()).min(2),      // Holma's closing narration over the full strip
  }),

  science: ScienceSchema,
  scienceMemos: z.array(ScienceMemoSchema).min(2),
  quiz: z.array(QuizSchema).min(2).max(4),
  sources: z.array(SourceSchema).min(3),

  /** Case-specific Holma flavour lines (used in addition to the global line bank). */
  holmaLines: z.object({
    nearCore: z.array(z.string()).min(1),    // closeness is high
    idle: z.array(z.string()).min(1),        // player idle / stuck
    solved: z.array(z.string()).min(1),
  }),
  /** SECRET. Terms that must never appear in model-written replies before the solution. */
  leakTerms: z.array(z.string()).min(1),
});

export type Case = z.infer<typeof CaseSchema>;
export type CaseInput = z.input<typeof CaseSchema>;
