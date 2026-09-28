/**
 * Manner of death and the culprit seal (2026-09-28, docs/decisions.md).
 *
 * Murder / accident / suicide questions — and the same thing in other words (a culprit exists,
 * intent, blame, tampering) — are ANSWERED TRUTHFULLY during the investigation: the rules judge
 * answers them from the case's manner fact (fact.manner, manner.ts). The one seal left is naming
 * the culprit, only in cases that opt in with truth.culpritSeal (culprit.ts, CASE 04): 「犯人は誰？」
 * 「編集者が混ぜた？」「老人は怪しい？」 get 'cannot' (meta 'culprit'); evidence about named people
 * and the manner with nobody named stay answered.
 */
import { describe, expect, it } from 'vitest';
import { detectManner, mannerProposal, proposalHolds } from '../../server/engine/manner';
import { compileCulpritSeal, detectCulprit } from '../../server/engine/culprit';
import { detectSafety } from '../../server/engine/safety';
import { detectMeta, normalize, analyze } from '../../server/engine/normalize';
import { buildCaseIndex } from '../../server/engine/case-index';
import { judgeText } from '../../server/engine/rules-judge';
import { GameService } from '../../server/engine/game';
import { TraceRing } from '../../server/engine/trace';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs';
import { CaseSchema } from '../../shared/case-schema';
import type { Judge, JudgeDecision } from '../../server/engine/judge-types';
import type { EngineTrace } from '../../server/engine/trace';
import { FIXTURE_ID, SECRET, fixtureRaw, makeService } from './helpers';

/* ------------------------------------------------------------------ */
/* Analysis: what is a manner question, and what does it propose       */
/* ------------------------------------------------------------------ */

const MANNER = [
  // murder, suicide, accident, incident
  '彼女は誰かに殺されたのですか？', '他殺ですか？', '殺人事件？', 'ころされたの？', '毒殺ですか',
  '自殺ですか？', '自殺じゃないですよね？', '自ら命を絶ったのですか', 'ジサツ？',
  '事故ですか？', '事故死ですか', 'ただの事故？', '交通事故ですか？', 'ジコですか？', '事故が起きたのですか', '事故ではないですよね？',
  '事件ですか？', '事件性はありますか', '偶然ですか？', 'たまたまですか',
  // culprit, blame, motive
  '犯人はいますか？', '犯人は誰？', '犯人って誰なの', '誰がやったの？', '誰のせいですか', '誰のせいでもないのですか？',
  '同僚のせいですか？', '弟さんのせいで死んだの？', '捜索隊が悪いの？', '友人は悪くない？', '変質者の仕業ですか？', '強盗に遭いましたか？',
  '動機はありますか', '誰かに狙われていましたか？',
  // done to her, intent, tampering
  '毒を盛られましたか？', '薬を飲まされた？', '何者かに襲撃された形跡はありますか？', '誰にも襲われていないですよね？',
  'わざと液体窒素をこぼしたのですか？', '故意にこぼしたのですか？', '弟はわざとボールをぶつけましたか？', '弟はわざとじゃないですよね？',
  '誰かがバルブを開けたのですか？', '誰かが酸素濃度計の電池を抜いたのですか？', '何者かにバルブを開けられた？', '液体窒素をわざとまいたの？',
  // named people: blame, violence, responsibility, involvement, suspicion
  '真柴さんのせいですか？', '両親のせいですか？', 'あの男が悪いのですか？', '男に殴られたのですか？', '帽子の男が彼女を殴ったのですか？',
  '弟に責任はありますか？', '弟を責めるべきですか？', '誰か逮捕されましたか？', 'もう一人の人は関係ありますか？', '同僚は事件に関係ありますか？',
  'その学生は怪しいですか？', '編集者は怪しいですか？', '服は無理やり脱がされたのですか？', '隙間に押し込まれたのですか？',
  // a poison mixed into food: a named person mixing, the mix-up as the accident, grudges
  '編集者が小鉢にトリカブトを混ぜましたか？', '隣の老人が毒を入れたのですか？', '編集者がやったの？', '小鉢に毒が混ぜられていましたか？', '毒を盛ったのですか？',
  '採り違えですか？', '彼女は間違えてトリカブトを摘みましたか？', '誤食ですか？', 'うっかり摘んだのですか？', '見間違えたのですか？', '編集者は彼女を恨んでいましたか？', '事故に見せかけたのですか？',
];

const EVIDENCE = [
  // people as evidence
  '部屋に他の人はいましたか？', '誰かが部屋に入ってきましたか？', '周りに大人はいましたか？', '誰かが心臓マッサージをしましたか？',
  '誰かが胸を押しましたか？', '誰かが彼女の後をつけていましたか？', '現場にほかの人の足跡はありましたか？', '何か盗まれていましたか？',
  '彼女がボタンを押しましたか？', '本人が扉を閉めたのですか？',
  // causes, animals, things
  '熊に襲われましたか？', '毒を飲みましたか？', '毒ですか？', '暑さのせいですか？', 'ボールのせいで死んだのですか？', '換気が止まっていたせいで酸素が減ったのですか？',
  '寒さのせいで死んだのですか？', '救急車のせいですか？', '捜索が遅れたせいですか？', 'わざと服を脱いだのですか？', '服は目印にするためにわざと置いたのですか？',
  '殺虫剤が関係していますか？', '事故の前に警報は鳴りましたか？', '事件当日は雨でしたか？', '事故を防ぐ装置はありましたか？',
  '動悸はありましたか？', 'どうきはありましたか？', '自転車をこいでいましたか？', '争った跡はありますか？', 'ココアは事件に関係ありますか？',
  '編集者の車の色は関係ありますか？', '安全管理の責任者は誰ですか？', '殴られた跡はありますか？', '病院に運ばれましたか？', 'ボールは関係ありますか？',
  '部屋に怪しいものはありましたか？', '酵母は関係ありますか？', '手すりにつかまっていましたか？', 'その人は学生ですか？',
  '彼女は鍋にニリンソウを入れましたか？', '編集者が盛り付けをしましたか？', 'ニリンソウとトリカブトは間違えやすいですか？', '小鉢に何か混ざっていましたか？',
  'おひたしにトリカブトが入っていましたか？', '編集者ははさみを持っていましたか？', '彼女はトリカブトを摘みましたか？', '部屋の空気は入れ替わっていましたか？',
  '心臓がけいれんしていましたか？', '隣人と口論していましたか？', '小鉢を運んだのは編集者ですか？',
];

describe('detectManner (analysis only — nothing is refused)', () => {
  it.each(MANNER)('recognises the manner question 「%s」', (q) => {
    expect(detectManner(q), q).toBeDefined();
  });
  it.each(EVIDENCE)('leaves the evidence question 「%s」 alone', (q) => {
    expect(detectManner(q), q).toBeUndefined();
    expect(mannerProposal(q), q).toBeUndefined();
  });
});

describe('mannerProposal', () => {
  const P = (q: string) => mannerProposal(q);
  it('reads the kind of death a question proposes', () => {
    expect(P('殺されたの？')).toMatchObject({ proposes: 'homicide', agent: 'none', pure: true });
    expect(P('誰かに殺されたの？')).toMatchObject({ proposes: 'homicide', agent: 'someone' });
    expect(P('同僚が犯人ですか？')).toMatchObject({ proposes: 'homicide', agent: 'named' });
    expect(P('熊に殺されたの？')).toMatchObject({ proposes: 'homicide', agent: 'other' });
    expect(P('事故ですか？')).toMatchObject({ proposes: 'accident', pure: true });
    expect(P('自殺ですか？')).toMatchObject({ proposes: 'suicide' });
    expect(P('彼女はわざとこぼしたの？')).toMatchObject({ proposes: 'suicide', agent: 'victim' });
    expect(P('彼女は毒を盛られた？')).toMatchObject({ proposes: 'homicide', agent: 'none' });
    expect(P('採り違えですか？')).toMatchObject({ proposes: 'accident', weak: true });
    expect(P('弟さんは悪くないですか？')).toMatchObject({ proposes: 'homicide', agent: 'named', denies: true });
  });
  it('takes the last proposal in the sentence (the predicate comes last)', () => {
    expect(P('他殺ではなく事故ですか？')).toMatchObject({ proposes: 'accident' });
    expect(P('事故に見せかけたのですか？')).toMatchObject({ proposes: 'homicide', rule: 'staged' });
  });
  it('proposes nothing where the manner alone cannot decide (a third party\'s neutral act, a specific type)', () => {
    for (const q of ['誰かがストッパーを外したの？', '交通事故ですか？', '強盗に遭いましたか？', 'もう一人の人は関係ありますか？', '警察は事件として捜査しましたか？', '弟は胸を狙って投げたのですか？']) {
      expect(P(q), q).toBeUndefined();
    }
  });
  it('decides a proposal from the case\'s manner', () => {
    const p = (q: string) => mannerProposal(q)!;
    expect(proposalHolds(p('殺されたの？'), 'accident')).toBe(false);
    expect(proposalHolds(p('殺されたの？'), 'homicide')).toBe(true);
    expect(proposalHolds(p('同僚が犯人ですか？'), 'accident')).toBe(false);
    expect(proposalHolds(p('同僚が犯人ですか？'), 'homicide')).toBeUndefined(); // which person: evidence or the seal
    expect(proposalHolds(p('事故ですか？'), 'accident')).toBe(true);
    expect(proposalHolds(p('採り違えですか？'), 'accident')).toBeUndefined(); // a mix-up in an accident case is evidence
    expect(proposalHolds(p('採り違えですか？'), 'homicide')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The culprit seal (culprit.ts)                                         */
/* ------------------------------------------------------------------ */

const seal = compileCulpritSeal({ people: ['お隣', '幼なじみ', '看護師'] });
const SEALED = [
  '犯人は誰？', '誰がやったの？', '誰が毒を入れたの？', '誰のせいですか？', '毒を入れたのは誰？', '混ぜたのは編集者ですか？',
  '犯人は編集者？', '犯人は女性ですか？', '犯人は隣のおじいさん？',
  '編集者が小鉢に混ぜた？', '老人が毒を入れたの？', '編集者がトリカブトを入れた？', '友人が毒を混ぜましたか？', '編集者がやったの？',
  '編集者のせい？', '老人は怪しい？', 'おじいさんが一番怪しいですか？', '友人は関係ある？', '編集者は彼女を恨んでいましたか？',
  '編集者がトリカブトを切ったのですか？', '幼なじみは関係ありますか？', 'お隣が混ぜたの？', '看護師のせいですか？', '彼女は編集者に毒を盛られた？',
];
const ANSWERED = [
  '殺されたの？', '事故ですか？', '採り違えですか？', '誰かが毒を混ぜたの？', '事故に見せかけた？', '犯人はいますか？', '犯人がいるの？', '毒を盛られたのですか？',
  '編集者が盛り付けをしましたか？', 'おひたしを盛ったのは編集者ですか？', '老人はおひたしを食べましたか？', '編集者ははさみを持っていましたか？',
  '編集者の証言は本当ですか？', '友人は天ぷらを揚げましたか？', '老人の小鉢に毒はありましたか？', '彼女はトリカブトを摘みましたか？', '編集者と彼女は揉めていましたか？',
  'ニリンソウを摘んだのは彼女ですか？', '老人の手土産は関係ありますか？', '編集者は午後、沢へ出かけましたか？',
];

describe('detectCulprit', () => {
  it.each(SEALED)('seals the culprit-naming question 「%s」', (q) => {
    expect(detectCulprit(q, seal), q).toBeDefined();
  });
  it.each(ANSWERED)('answers 「%s」 (the manner with nobody named, or evidence about people)', (q) => {
    expect(detectCulprit(q, seal), q).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Real cases                                                           */
/* ------------------------------------------------------------------ */

const registry = loadRegistry(resolveContentRoot({}));
const cases = registry.list(true);

describe.skipIf(cases.length === 0)('real cases', () => {
  it('answers every authored manner probe; only culprit-naming probes of a sealed case are refused', () => {
    const wrong: string[] = [];
    let manner = 0;
    let culprit = 0;
    for (const loaded of cases) {
      const c = loaded.data;
      const s = loaded.index.culpritSeal;
      for (const p of c.probes) {
        const note = p.note ?? '';
        if (note.startsWith('SAFETY')) continue;
        if (note.startsWith('MANNER')) wrong.push(`${c.id}: ${p.q} still carries the old MANNER seal`);
        const isCulprit = note.startsWith('CULPRIT');
        const sealed = !!s && !!detectCulprit(p.q, s);
        if (isCulprit) {
          culprit++;
          if (!s) wrong.push(`${c.id}: ${p.q} is labelled CULPRIT but the case has no truth.culpritSeal`);
          if (!sealed) wrong.push(`${c.id}: ${p.q} is labelled CULPRIT but the seal does not catch it`);
          if (p.answer !== 'cannot' || p.facts.length > 0) wrong.push(`${c.id}: ${p.q} CULPRIT probe must be cannot with no facts`);
        } else if (sealed) wrong.push(`${c.id}: ${p.q} (${p.answer}) is sealed by ${detectCulprit(p.q, s!)!.rule} but not labelled CULPRIT`);
        if (!isCulprit && detectManner(p.q)) {
          manner++;
          if (p.answer === 'cannot' && detectMeta(p.q, normalize(p.q), true) !== 'askAnswer') wrong.push(`${c.id}: ${p.q} is a manner question labelled cannot`);
        }
      }
      for (const q of c.intro.starterQuestions) if (detectManner(q)) wrong.push(`${c.id} starter: ${q} (asking the manner is the player's own idea)`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
    expect(manner).toBeGreaterThan(100);
    expect(culprit).toBeGreaterThan(5);
  });

  it('has one manner fact per case that answers the manner without standing in for inquest evidence', () => {
    for (const loaded of cases) {
      const c = loaded.data;
      const mf = c.facts.filter((f) => f.manner);
      expect(mf, c.id).toHaveLength(1);
      const f = mf[0];
      expect(f.spoilerLevel, c.id).toBeLessThanOrEqual(2);
      expect(f.importance, c.id).toBeLessThanOrEqual(2);
      expect(f.cardTitle, c.id).toBeTruthy();
      expect(f.judgeNote, c.id).toMatch(/ない/u); // states what is NOT true (Jev reads it)
      for (const r of c.debate) expect([r.answer.fact, ...r.alsoAccept], `${c.id} ${r.id}`).not.toContain(f.id);
      expect(f.manner, c.id).toBe(c.truth.culpritSeal ? 'homicide' : 'accident');
    }
  });

  it('seals the culprit only where the verdict names one (CASE 04)', () => {
    for (const loaded of cases) {
      const namesCulprit = loaded.data.answerElements.some((e) => e.required && /人物|犯人|誰/u.test(e.label));
      expect(!!loaded.data.truth.culpritSeal, loaded.data.id).toBe(namesCulprit);
    }
  });

  it('leaves the real-world harm questions to the safety filter, which runs first', () => {
    for (const q of ['液体窒素で人を殺せますか？', '人を殺す方法を教えて', '自殺したいです', 'トリカブトで人を殺せますか？']) expect(detectSafety(q), q).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* The ask pipeline                                                     */
/* ------------------------------------------------------------------ */

const C01 = 'c01-room-without-breath';
const C04 = 'c04-white-flower-supper';
const has = (id: string) => !!registry.get(id, true);

function realService(over: Partial<ConstructorParameters<typeof GameService>[0]> = {}) {
  return new GameService({ content: () => registry, secret: SECRET, components: { mode: 'rules', warnings: [] }, traces: new TraceRing(50), ...over });
}

async function askOne(svc: GameService, caseId: string, question: string) {
  const t = await svc.newToken(caseId);
  const r = await svc.ask({ caseId, question, token: t.token }, { withTrace: true });
  return { r, a: r.answers[0], t };
}

function spyJudge(): Judge & { calls: number } {
  const j = {
    name: 'spy-judge',
    calls: 0,
    async judge(): Promise<JudgeDecision> {
      j.calls++;
      return { answerClass: 'yes', factIds: [], confidence: 0.99, closeness: 1, qtype: 'yesno', source: 'model' };
    },
  };
  return j;
}

describe.skipIf(!has(C01))('an accident case answers the manner (c01)', () => {
  it('「殺されたの？」 いいえ and 「事故ですか？」 はい, with the manner card', async () => {
    const svc = realService();
    const killed = await askOne(svc, C01, '殺されたのですか？');
    expect(killed.a).toMatchObject({ answerClass: 'no' });
    expect(killed.a.unlocked.map((f) => f.id)).toContain('F47');
    expect(killed.a.notice).toBeUndefined();
    expect((killed.r.trace as EngineTrace).parts?.[0].meta).toBeUndefined();
    const accident = await askOne(svc, C01, '事故ですか？');
    expect(accident.a.answerClass).toBe('yes');
    // no seal in an accident case: a named person's part is simply answered
    expect((await askOne(svc, C01, '同僚が犯人ですか？')).a.answerClass).toBe('no');
  });
});

describe.skipIf(!has(C04))('a murder case answers the manner and seals only the culprit (c04)', () => {
  const svc = realService();
  it.each([
    ['殺されたの？', 'yes'],
    ['事故ですか？', 'no'],
    ['採り違えですか？', 'no'],
    ['誰かが毒を混ぜたの？', 'yes'],
    ['事故に見せかけた？', 'yes'],
    ['犯人はいますか？', 'yes'],
    ['自殺ですか？', 'no'],
    ['編集者が盛り付けをしましたか？', 'yes'],
    ['老人はおひたしを食べましたか？', 'no'],
  ])('answers 「%s」 → %s', async (q, expected) => {
    const { a } = await askOne(svc, C04, q);
    expect(a.answerClass, q).toBe(expected);
  });

  it.each(['犯人は誰？', '誰がやったの？', '編集者が小鉢に混ぜた？', '老人が毒を入れたの？', '編集者のせい？', '老人は怪しい？', '友人は関係ある？', '犯人は編集者？'])(
    'seals 「%s」 with a canned culprit line, no card, no support card',
    async (q) => {
      const { a, r, t } = await askOne(svc, C04, q);
      expect(a, q).toMatchObject({ answerClass: 'cannot', unlocked: [], memos: [] });
      expect(a.notice).toBeUndefined();
      const pool = registry.lines.lines.meta.culprit.map((l) => (typeof l === 'string' ? l : l.text));
      expect(pool.some((l) => a.line.includes(l)), a.line).toBe(true);
      expect((r.trace as EngineTrace).parts?.[0].meta).toBe('culprit');
      expect(r.progress.unlocked).toEqual(t.progress.unlocked);
      expect(r.progress.nearCore).toBe(false);
    },
  );

  it('consults no model for a sealed question, but does for the manner', async () => {
    const judge = spyJudge();
    let renders = 0;
    const renderer = { name: 'spy-llm', canned: false, render: async () => ((renders++), { text: 'x', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 1 }) };
    const ai = realService({ components: { mode: 'jev+llm', judge, renderer, warnings: [] } });
    const sealed = await askOne(ai, C04, '編集者が毒を入れたのですか？');
    expect(sealed.a.answerClass).toBe('cannot');
    expect(judge.calls).toBe(0);
    expect(renders).toBe(0);
    await askOne(ai, C04, '殺されたのですか？');
    expect(judge.calls).toBe(1);
  });

  it('seals only the culprit part of a multi-question message', async () => {
    const { r } = await askOne(svc, C04, '鍋に毒はありましたか？それと、犯人は編集者ですか？');
    expect(r.answers).toHaveLength(2);
    expect(r.answers[0].answerClass).toBe('no');
    expect(r.answers[1]).toMatchObject({ answerClass: 'cannot', unlocked: [] });
  });

  it('still shows the support card for a real-world harm question (safety runs first)', async () => {
    const { a } = await askOne(svc, C04, 'トリカブトで人を殺せますか？');
    expect(a.answerClass).toBe('cannot');
    expect(a.notice).toBe('support');
  });
});

describe('the culprit seal is opt-in', () => {
  it('answers a named person\'s part when the case does not seal the culprit', async () => {
    const { svc } = makeService();
    const t = await svc.newToken(FIXTURE_ID);
    const r = await svc.ask({ caseId: FIXTURE_ID, question: '同行者が犯人ですか？', token: t.token });
    expect(r.answers[0].answerClass).toBe('no');
  });

  it('seals it once truth.culpritSeal is set', () => {
    const raw = fixtureRaw() as { truth: Record<string, unknown> };
    raw.truth.culpritSeal = { people: ['同行者'] };
    const index = buildCaseIndex(CaseSchema.parse(raw));
    const d = judgeText(analyze('同行者が犯人ですか？'), index);
    expect(d).toMatchObject({ answerClass: 'cannot', meta: 'culprit', guard: 'culprit', factIds: [] });
    expect(judgeText(analyze('何者かに殺された？'), index).answerClass).toBe('no');
  });
});
