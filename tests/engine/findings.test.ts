/**
 * Engine fixes from the 2026-09-25 critic / audit pass, on a fixture extended with the shapes
 * that went wrong in c01 / c02 (the real cases are covered by tests/content/regression):
 *   - a ruled-out qualifier: 「毒ガスが出ていましたか？」 was はい (the gas fact) although the case
 *     says the gas is not poisonous → 一部そう with the ruling-out card first
 *   - 「酸素のメーター」 unlocked the supply gauge (「メーター」) instead of the oxygen meter;
 *     「計器は動いていましたか？」 answered the existence fact (はい) instead of the working state
 *   - open questions: a polar label for 「犯人は誰ですか？」 / 「どこで見つかったの？」, and the
 *     generic 「具体的に」 lines instead of one rephrasing move per wh-word
 */
import { describe, expect, it } from 'vitest';
import { CaseSchema } from '../../shared/case-schema';
import { buildCaseIndex, keywordVariants } from '../../server/engine/case-index';
import { analyze, isWhQuestion, normalize, whKindOf } from '../../server/engine/normalize';
import { retrieve } from '../../server/engine/retrieve';
import { judgeText } from '../../server/engine/rules-judge';
import { ContentRegistry } from '../../server/engine/registry';
import { GameService } from '../../server/engine/game';
import { OPEN_LINES } from '../../server/engine/default-lines';
import { composeLine, LineBank, texts } from '../../server/engine/lines';
import { mapAskDecision, buildAskRequest } from '../../server/engine/ai/jev-judge';
import { judgeRules } from '../../server/engine/rules-judge';
import type { DecisionResult } from '../../server/engine/providers/types';
import { FIXTURE_ID, fixtureRaw, SECRET } from './helpers';

function extendedRaw(): Record<string, unknown> {
  const raw = fixtureRaw() as { facts: Record<string, unknown>[]; probes: Record<string, unknown>[] };
  const fact = (id: string, text: string, keywords: string[], ifAsked: string, extra: Record<string, unknown> = {}) => ({
    id, text, keywords, ifAsked, importance: 1, spoilerLevel: 0, category: '物品', ...extra,
  });
  raw.facts.push(
    fact('F19', 'ポットから湯気が出ていた', ['湯気が出', '湯気'], 'yes'),
    fact('F20', '湯気そのものに毒はない', ['有毒', '毒性', '有害'], 'no'),
    fact('F21', '壁に酸素メーターが取り付けられていた', ['酸素メーター', '計器', '壁に'], 'yes'),
    fact('F22', '酸素メーターは電池が切れて止まっていた', ['電池'], 'no', { spoilerLevel: 1 }),
    fact('F23', 'ボンベの残量メーターは空だった', ['メーター', '残量'], 'yes'),
  );
  // An authored polar label on a wh-question (c02 had 「犯人は誰ですか？」 → いいえ).
  raw.probes.push({ q: 'どこで見つかりましたか？', answer: 'yes', facts: ['F01'], kind: 'yes' });
  return raw;
}

const data = CaseSchema.parse(extendedRaw());
const index = buildCaseIndex(data);
const judge = (q: string) => judgeText(analyze(q), index);

describe('ruled-out qualifier (「毒ガス」)', () => {
  it('lowers はい to 一部そう and puts the ruling-out fact first', () => {
    const d = judge('有毒な湯気が出ていましたか？');
    expect(d.answerClass).toBe('partial');
    expect(d.factIds).toEqual(['F20', 'F19']);
    expect(d.qualifier).toBe('有毒');
  });
  it('leaves the plain and the negated question alone', () => {
    expect(judge('湯気が出ていましたか？')).toMatchObject({ answerClass: 'yes', factIds: ['F19'] });
    expect(judge('毒じゃない湯気が出ていた？').answerClass).toBe('yes');
    // the qualifier as the predicate: いいえ, not 一部そう
    expect(judge('湯気は有毒ですか？')).toMatchObject({ answerClass: 'no', factIds: ['F20', 'F19'] });
  });
});

describe('compound keywords and object siblings (「酸素のメーター」)', () => {
  it('matches the spoken 「の」 form of a kanji + katakana keyword', () => {
    expect(keywordVariants(['酸素メーター', '窒素ガス', '酸素濃度計', 'メーター'])).toEqual([
      { form: normalize('酸素のメーター'), keyword: normalize('酸素メーター') },
      { form: normalize('窒素のガス'), keyword: normalize('窒素ガス') },
    ]);
  });
  it('routes to the oxygen meter, not the gauge whose shorter keyword is inside the phrase', () => {
    const c = retrieve(analyze('壁に酸素のメーターみたいなのはあった？'), index);
    expect(c.facts[0].id).toBe('F21');
    expect(c.facts.find((f) => f.id === 'F23')?.hits ?? []).toEqual([]);
    expect(judge('酸素のメーターはありましたか？')).toMatchObject({ answerClass: 'yes', factIds: ['F21'] });
    // one extra character (a particle) does not shadow another fact's keyword
    expect(judge('残量メーターはありましたか？').factIds).toEqual(['F23']);
  });
  it('answers a state question from the sibling fact that states it', () => {
    expect(judge('計器は動いていましたか？')).toMatchObject({ answerClass: 'no', factIds: ['F22', 'F21'] });
    expect(judge('計器は止まっていましたか？').answerClass).toBe('yes');
  });
});

describe('open questions', () => {
  it('detects wh-arguments but not indefinites / quantities', () => {
    for (const q of ['どこで見つかったの？', 'いつ倒れたの？', '何を吸ったの？', '誰がやったの？', 'どんな音がしたの？', '部屋はどうなっていましたか？', '犯人は誰？', 'なぜ倒れたの？'])
      expect(isWhQuestion(normalize(q)), q).toBe(true);
    for (const q of ['何かありましたか？', '誰にも会わなかった？', 'どこにも傷はなかった？', 'いつも一人でしたか？', '何分もたってから倒れましたか？', '誰のせいでもないですか？', '毒かどうか分かりますか？', '何となく眠かった？'])
      expect(isWhQuestion(normalize(q)), q).toBe(false);
  });
  it('names the wh-word for the rephrasing line', () => {
    const k = (q: string) => whKindOf(normalize(q));
    expect([k('なぜ倒れたの？'), k('どうやって入ったの？'), k('どこで見つかったの？'), k('いつ倒れたの？'), k('犯人は誰？'), k('何を吸ったの？')]).toEqual([
      'why', 'how', 'where', 'when', 'who', 'what',
    ]);
  });
  it('never stamps a polar answer on a wh-question, not even from a verbatim probe', () => {
    expect(judge('どこで見つかりましたか？')).toMatchObject({ answerClass: 'vague', meta: 'open', factIds: [], source: 'probe' });
    expect(judge('誰がテントを閉じたの？')).toMatchObject({ answerClass: 'vague', meta: 'open' });
  });
  it('answers with the rephrasing line of that wh-word', async () => {
    const registry = ContentRegistry.fromRaw({ cases: [{ dir: FIXTURE_ID, path: 'x.json', data: extendedRaw() }] });
    const svc = new GameService({ content: () => registry, secret: SECRET, components: { mode: 'rules', warnings: [] } });
    const { token } = await svc.newToken(FIXTURE_ID, { admin: true });
    const r = await svc.ask({ caseId: FIXTURE_ID, question: 'どこで見つかったの？', token }, { admin: true });
    expect(r.answers[0].answerClass).toBe('vague');
    expect(texts(OPEN_LINES.where)).toContain(r.answers[0].line);
    const who = await svc.ask({ caseId: FIXTURE_ID, question: '誰がテントを閉じたの？', token: r.token }, { admin: true });
    expect(texts(OPEN_LINES.who)).toContain(who.answers[0].line);
  });
  it('keeps every open line fact-free and in the yes/no-template voice', () => {
    for (const [kind, lines] of Object.entries(OPEN_LINES)) {
      expect(lines.length, kind).toBeGreaterThanOrEqual(2);
      for (const l of texts(lines)) expect(l, kind).toMatch(/『[^』]*〜[^』]*？』/u);
    }
    const bank = LineBank.default();
    const line = composeLine(bank, { answerClass: 'vague', meta: 'open', whKind: 'why', unlockedCore: false, unlocked: false, nearCore: false, part: 0, parts: 1, degraded: false, seed: 3 });
    expect(texts(OPEN_LINES.why)).toContain(line.text);
  });
});

describe('Jev mapping guards', () => {
  const decision = (answer: string, fact: Record<string, number>): DecisionResult => ({
    answers: {
      answer: { type: 'choice', choice: answer, confidence: 0.9, probabilities: { [answer]: 0.9 } },
      fact: { type: 'choice', choice: Object.keys(fact)[0], confidence: 0.9, probabilities: fact },
      qtype: { type: 'choice', choice: 'yesno', confidence: 0.9, probabilities: { yesno: 0.9 } },
      closeness: { type: 'score', score: 1, probabilities: {}, confidence: 0.9 },
      selfHarm: { type: 'noul', noul: 0 },
      directAnswer: { type: 'noul', noul: 0 },
      offtopic: { type: 'noul', noul: 0 },
    },
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    latencyMs: 1,
  } as DecisionResult);
  const input = (q: string) => {
    const question = analyze(q);
    const candidates = retrieve(question, index);
    return { caseData: data, index, question, candidates, rules: judgeRules(question, candidates, index), unlocked: new Set<string>() };
  };

  it('does not let Jev confirm a qualifier the case rules out', () => {
    const inp = input('有毒な湯気が出ていましたか？');
    const d = mapAskDecision(decision('yes', { F19: 0.9 }), buildAskRequest(inp, 'all+prior'), inp, 'all+prior');
    expect(d.answerClass).toBe('partial');
    expect(d.factIds[0]).toBe('F20');
  });
  it('turns a polar Jev answer to a wh-question into the open rephrasing', () => {
    const inp = input('どこで見つかったの？');
    const d = mapAskDecision(decision('yes', { F01: 0.9 }), buildAskRequest(inp, 'all+prior'), inp, 'all+prior');
    expect(d).toMatchObject({ answerClass: 'vague', meta: 'open' });
  });
});
