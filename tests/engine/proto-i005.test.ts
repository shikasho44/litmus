/**
 * PROTOTYPE I-005 (2026-10-03, docs/decisions.md 「I-005 の試作」): the server side of the four
 * ideas from the supervisor's original design.
 *   - 近い・遠い: closeness per verdict mode, derived only from the judge (server/engine/closeness.ts)
 *     and carried on every judged VerdictResponse
 *   - サイエンスヒント (fact.scienceHint → PublicFact.science), 矛盾の一文 (intro.hook → CaseSummary.hook),
 *     余話 (science.aside, post-solve only): schema, public views, validator checks
 *   - the authored content: one hook per case, one サイエンスヒント per case, asides for c08 and c01,
 *     one 「先生のひとこと」 sample frame (c01) and never any words of his
 */
import { describe, expect, it } from 'vitest';
import { CaseSchema, type Case } from '../../shared/case-schema';
import { choiceCloseness, clozeCloseness, freeCloseness, partialCloseness, NEAR_AT } from '../../server/engine/closeness';
import { evaluateVerdict } from '../../server/engine/verdict';
import { publicFact, solutionView, toPublic, toSummary } from '../../server/engine/public-view';
import { initialState } from '../../server/engine/state';
import { signToken } from '../../server/engine/token';
import { validateCase } from '../../server/engine/validate';
import { verdictBlankOrder } from '../../server/engine/public-view';
import { contentRegistry } from '../content/regression-harness';
import { FIXTURE_ID, SECRET, fixtureCase, fixtureRaw, makeService } from './helpers';

type Raw = Record<string, any>;
const caseId = FIXTURE_ID;
const cases: Case[] = contentRegistry()
  .list(true)
  .map((l) => l.data);
const byKey = (k: string) => cases.find((c) => c.id.startsWith(k))!;

async function tokenWith(extra: Partial<ReturnType<typeof initialState>> = {}): Promise<string> {
  return signToken({ ...initialState(fixtureCase(), Date.now()), ...extra }, SECRET);
}
const freeOf = (c: Case, text: string) => freeCloseness(c, evaluateVerdict(c, text));

describe('I-005 closeness: free text (教授)', () => {
  const c = fixtureCase(); // required A, B · optional C · wrong claims W1 (poison) / W2 (murder)

  it('nothing matched → far, ratio 0', () => {
    expect(freeOf(c, '心臓発作だった')).toEqual({ level: 'far', ratio: 0 });
  });

  it('half of the required elements → near (the almost verdict)', () => {
    const ev = evaluateVerdict(c, '一酸化炭素中毒で亡くなった');
    expect(ev.result).toBe('almost');
    expect(freeCloseness(c, ev)).toEqual({ level: 'near', ratio: 0.5 });
  });

  it('accepted with the required elements only → correct; with the optional one too → perfect', () => {
    expect(freeOf(c, 'テントの中で炭火を使い、一酸化炭素中毒になった')).toEqual({ level: 'correct', ratio: 1 });
    expect(freeOf(c, c.truth.summary)).toEqual({ level: 'perfect', ratio: 1 });
  });

  it('a false story the judge answers 「違う」 stays far, however many elements it names', () => {
    const ev = evaluateVerdict(c, '犯人がテントの七輪で一酸化炭素中毒にした');
    expect(ev.wrongClaims).toEqual(['W2']);
    expect(ev.result).toBe('missing');
    expect(freeCloseness(c, ev)).toEqual({ level: 'far', ratio: 1 });
  });

  it('an optional element alone is not closeness (ratio counts the required ones)', () => {
    const ev = evaluateVerdict(c, '換気をしていなかった');
    expect(ev.matched).toEqual(['C']);
    expect(freeCloseness(c, ev)).toEqual({ level: 'far', ratio: 0 });
  });

  it('near starts at half', () => {
    expect(NEAR_AT).toBe(0.5);
    expect(partialCloseness(0.499, false).level).toBe('far');
    expect(partialCloseness(0.5, false).level).toBe('near');
    expect(partialCloseness(0.9, true).level).toBe('far');
    expect(partialCloseness(2, false)).toEqual({ level: 'near', ratio: 1 });
  });
});

describe('I-005 closeness: cloze (審問官) and choice (見習い)', () => {
  it('cloze: blanks right / blanks; every blank = the full truth sentence = perfect', () => {
    expect(clozeCloseness(0, 3)).toEqual({ level: 'far', ratio: 0 });
    expect(clozeCloseness(1, 3)).toEqual({ level: 'far', ratio: 0.333 });
    expect(clozeCloseness(2, 3)).toEqual({ level: 'near', ratio: 0.667 });
    expect(clozeCloseness(3, 3)).toEqual({ level: 'perfect', ratio: 1 });
    expect(clozeCloseness(1, 2)).toEqual({ level: 'near', ratio: 0.5 });
  });

  it('choice: the right option is correct (one picked sentence has no "perfect")', () => {
    const c = fixtureCase();
    const right = c.verdictModes!.choice.options.find((o) => o.correct)!;
    expect(choiceCloseness(c, right)).toEqual({ level: 'correct', ratio: 1 });
  });

  it('choice: a wrong option is judged by its own text — far when it states a false story or shares too little', () => {
    const c = fixtureCase();
    const opt = (id: string) => c.verdictModes!.choice.options.find((o) => o.id === id)!;
    expect(choiceCloseness(c, opt('poison'))).toEqual({ level: 'far', ratio: 0 }); // W1
    expect(choiceCloseness(c, opt('cold'))).toEqual({ level: 'far', ratio: 0 });
    expect(choiceCloseness(c, opt('heart'))).toEqual({ level: 'far', ratio: 0 });
  });

  it('choice in the real cases: every wrong option is far or near, never more; a right one is correct', () => {
    for (const c of cases) {
      for (const o of c.verdictModes!.choice.options) {
        const cl = choiceCloseness(c, o);
        if (o.correct) expect(cl, `${c.id} ${o.id}`).toEqual({ level: 'correct', ratio: 1 });
        else expect(['far', 'near'], `${c.id} ${o.id}`).toContain(cl.level);
      }
    }
    // c08: 「昼ごはんの食べ物に、急にアレルギーが出た」 names the reaction but states the false food story
    const c08 = byKey('c08');
    const food = c08.verdictModes!.choice.options.find((o) => o.text.includes('昼ごはん'))!;
    expect(choiceCloseness(c08, food).level).toBe('far');
    // c06: the scarf made the neck melt, but not by sunlight — shares the mechanism, no false story → near
    const c06 = byKey('c06');
    const self = c06.verdictModes!.choice.options.find((o) => o.text.includes('自分で熱'))!;
    expect(choiceCloseness(c06, self)).toEqual({ level: 'near', ratio: 0.5 });
  });

  it('the truth text of every case is perfect', () => {
    for (const c of cases) {
      const truth = [c.truth.causeOfDeath, c.truth.summary, c.truth.mechanism].join('。');
      expect(freeOf(c, truth), c.id).toEqual({ level: 'perfect', ratio: 1 });
    }
  });
});

describe('I-005 closeness on the wire (GameService.verdict)', () => {
  it('free / choice / cloze responses carry it; the support reply does not', async () => {
    const { svc } = makeService();
    const c = fixtureCase();
    const t = await tokenWith();
    expect((await svc.verdict({ caseId, token: t, mode: 'free', text: '心臓発作' })).closeness).toEqual({ level: 'far', ratio: 0 });
    expect((await svc.verdict({ caseId, token: t, mode: 'free', text: '一酸化炭素中毒' })).closeness).toEqual({ level: 'near', ratio: 0.5 });
    expect((await svc.verdict({ caseId, token: t, mode: 'free', text: c.truth.summary })).closeness).toEqual({ level: 'perfect', ratio: 1 });
    expect((await svc.verdict({ caseId, token: t, mode: 'choice', choice: 'poison' })).closeness).toEqual({ level: 'far', ratio: 0 });
    expect((await svc.verdict({ caseId, token: t, mode: 'choice', choice: 'co' })).closeness).toEqual({ level: 'correct', ratio: 1 });
    const idx = (id: string, right: boolean) => {
      const b = c.verdictModes!.cloze.blanks.find((x) => x.id === id)!;
      const order = verdictBlankOrder(c, b);
      const at = order.indexOf(b.answer);
      return right ? at : at === 0 ? 1 : 0;
    };
    const some = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { place: idx('place', true), source: idx('source', false), cause: idx('cause', true) } });
    expect(some.result).toBe('missing');
    expect(some.closeness).toEqual({ level: 'near', ratio: 0.667 });
    const all = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { place: idx('place', true), source: idx('source', true), cause: idx('cause', true) } });
    expect(all.closeness).toEqual({ level: 'perfect', ratio: 1 });
    const support = await svc.verdict({ caseId, token: t, mode: 'free', text: 'もう死にたい' });
    expect(support.notice).toBe('support');
    expect(support.closeness).toBeUndefined();
  });

  it('never names what is missing: only a level and a share', async () => {
    const { svc } = makeService();
    const r = await svc.verdict({ caseId, token: await tokenWith(), mode: 'free', text: '一酸化炭素中毒' });
    expect(Object.keys(r.closeness!).sort()).toEqual(['level', 'ratio']);
  });
});

describe('I-005 data: schema and public views', () => {
  it('accepts the optional fields and keeps them optional', () => {
    const raw = fixtureRaw() as Raw;
    expect(CaseSchema.safeParse(raw).success).toBe(true); // none of them
    raw.intro.hook = 'テントで眠っただけ。それなのに、朝は来なかった。';
    raw.facts.find((f: Raw) => !f.visibleFromStart).scienceHint = true;
    raw.science.aside = {
      title: '余話の題',
      text: 'これは余話の本文です。じゅうぶんな長さの、本当の話を書く欄で、出典をかならず添える。四十字をこえる長さにしておく。',
      sources: [{ ...raw.sources[0], id: 'aside-x' }],
      supervisorNote: 'placeholder',
    };
    expect(CaseSchema.safeParse(raw).success).toBe(true);
  });

  it('the 「先生のひとこと」 slot only takes the placeholder — never a written comment', () => {
    const raw = fixtureRaw() as Raw;
    raw.science.aside = { title: '題', text: 'あ'.repeat(60), sources: [{ ...raw.sources[0], id: 'aside-x' }], supervisorNote: '「科学は楽しい」——くられ' };
    expect(CaseSchema.safeParse(raw).success).toBe(false);
  });

  it('bounds the hook and the aside', () => {
    const raw = fixtureRaw() as Raw;
    raw.intro.hook = 'あ'.repeat(65);
    expect(CaseSchema.safeParse(raw).success).toBe(false);
    const raw2 = fixtureRaw() as Raw;
    raw2.science.aside = { title: '題名', text: 'みじかい', sources: [{ ...raw2.sources[0], id: 'aside-x' }] };
    expect(CaseSchema.safeParse(raw2).success).toBe(false);
  });

  it('PublicFact.science only on the サイエンスヒント; CaseSummary.hook only when authored; the aside only in the solution', () => {
    const c08 = byKey('c08');
    const hint = c08.facts.find((f) => f.scienceHint)!;
    const other = c08.facts.find((f) => !f.scienceHint)!;
    expect(publicFact(hint).science).toBe(true);
    expect('science' in publicFact(other)).toBe(false);
    expect(toSummary(c08).hook).toBe(c08.intro.hook);
    expect('hook' in toSummary(fixtureCase())).toBe(false);
    // pre-solve views never carry the aside; the solution does
    expect(JSON.stringify(toPublic(c08))).not.toContain(c08.science.aside!.title);
    expect(solutionView(c08, new Set()).science.aside?.title).toBe(c08.science.aside!.title);
    // the サイエンスヒント is not a starting card (its mark is earned by asking)
    expect(toPublic(c08).startingFacts.some((f) => f.science)).toBe(false);
  });
});

describe('I-005 validator: hook = pre-solve text, aside = post-solve text, one サイエンスヒント', () => {
  const run = (mutate: (c: Raw) => void) => {
    const raw = fixtureRaw() as Raw;
    mutate(raw);
    return validateCase(raw, { skipGeneralization: true });
  };

  it('scans the hook for leakTerms (it is shown before anything is asked)', () => {
    const r = run((c) => (c.intro.hook = '一酸化炭素のない朝。それなのに、目を覚まさなかった。'));
    expect(r.errors).toContain('leak term "一酸化炭素" appears in public field intro.hook');
  });

  it('scans the hook for secretTerms', () => {
    const r = run((c) => {
      c.secretTerms = ['テント'];
      c.intro.hook = 'テントで眠っただけ。それなのに、朝は来なかった。';
    });
    expect(r.errors.some((e) => e.startsWith('secret term "テント"') && e.endsWith('intro.hook'))).toBe(true);
  });

  it('warns when the hook names a finding (it may only restate the case file)', () => {
    const raw = fixtureRaw() as Raw;
    const f = raw.facts.find((x: Raw) => !x.visibleFromStart && x.cardTitle && [...x.cardTitle].length >= 4);
    const r = run((c) => (c.intro.hook = `${f.cardTitle}があった。それなのに、誰も気づかなかった。`));
    expect(r.warnings.some((w) => w.startsWith(`intro.hook names the finding ${f.id}`))).toBe(true);
  });

  it('does not scan the aside for leakTerms (post-solve) but refuses doses and how-to', () => {
    const aside = (text: string) => (c: Raw) => (c.science.aside = { title: '題名', text, sources: [{ ...c.sources[0], id: 'aside-x' }] });
    const ok = run(aside('一酸化炭素は、色もにおいもない。昔は炭鉱でカナリアを連れていき、異変にいち早く気づく見張り役にしたという話が残っている。'));
    expect(ok.errors).toEqual([]);
    const bad = run(aside('一酸化炭素の致死量は、とても少ない。だから見張りの機械が必要になる。昔は炭鉱でカナリアを連れていったという。'));
    expect(bad.errors.some((e) => e.startsWith('science.aside: dose'))).toBe(true);
  });

  it('checks the aside sources (https, ids unique beside the case sources)', () => {
    const r = run((c) => (c.science.aside = { title: '題名', text: 'あ'.repeat(60), sources: [{ ...c.sources[0] }, { ...c.sources[0], id: 'aside-y', url: 'http://example.com/a' }] }));
    expect(r.errors).toContain(`science.aside source id ${(fixtureRaw() as Raw).sources[0].id} is not unique`);
    expect(r.errors).toContain('science.aside source aside-y url is not https: http://example.com/a');
  });

  it('one サイエンスヒント per case, earned by asking, never the answer or the sealed manner', () => {
    const two = run((c) => c.facts.filter((f: Raw) => !f.visibleFromStart).slice(0, 2).forEach((f: Raw) => (f.scienceHint = true)));
    expect(two.errors.some((e) => e.startsWith('more than one scienceHint fact'))).toBe(true);
    const start = run((c) => (c.facts.find((f: Raw) => f.visibleFromStart).scienceHint = true));
    expect(start.errors.some((e) => e.endsWith('(not visibleFromStart)'))).toBe(true);
    const answer = run((c) => {
      const f = c.facts.find((x: Raw) => !x.visibleFromStart);
      f.scienceHint = true;
      f.importance = 4;
      f.spoilerLevel = 4;
    });
    expect(answer.errors.some((e) => e.includes('the scienceHint is the answer itself'))).toBe(true);
  });
});

describe('I-005 authored content', () => {
  const HINTS: Record<string, string> = { c08: 'F15', c05: 'F18', c06: 'F11', c07: 'F28', c01: 'F19', c02: 'F12', c03: 'F30', c04: 'F08' };

  it('every case has a 矛盾の一文 in the 「それなのに」 form', () => {
    for (const c of cases) {
      expect(c.intro.hook, c.id).toBeTruthy();
      expect(c.intro.hook!, c.id).toMatch(/それなのに|ではなく/u);
    }
    // the approved drafts are used as written
    expect(byKey('c08').intro.hook).toBe('洗濯物をたたんでいただけ。それなのに、二度と起き上がらなかった。');
    expect(byKey('c07').intro.hook).toBe('水はすぐそばにあった。それなのに、渇いて死んだ。');
    expect(byKey('c01').intro.hook).toBe('傷も、争った跡もない。それなのに、彼女は二度と目を覚まさなかった。');
    expect(byKey('c02').intro.hook).toBe('ただのキャッチボールだった。それなのに、少女は二度と起き上がらなかった。');
    expect(byKey('c03').intro.hook).toBe('氷点下の雪山。命を守るはずの上着は、彼女の体ではなく、雪の上にあった。');
  });

  it('the hooks never name the answer: no leakTerm, no secretTerm, no manner word', () => {
    for (const c of cases) {
      const hook = c.intro.hook!;
      for (const t of [...c.leakTerms, ...(c.secretTerms ?? [])]) expect(hook.includes(t), `${c.id}: ${t}`).toBe(false);
      expect(hook, c.id).not.toMatch(/殺|事故|犯人|自殺|自死|毒/u);
    }
  });

  it('exactly one サイエンスヒント per case — the chosen findings (docs/decisions.md 2026-10-03)', () => {
    for (const c of cases) {
      const marked = c.facts.filter((f) => f.scienceHint).map((f) => f.id);
      expect(marked, c.id).toEqual([HINTS[c.id.slice(0, 3)]]);
      const f = c.facts.find((x) => x.scienceHint)!;
      expect(f.importance, c.id).toBeLessThan(4);
      expect(f.spoilerLevel, c.id).toBeLessThan(4);
      expect(f.manner, c.id).toBeUndefined();
      expect(f.visibleFromStart, c.id).toBe(false);
      expect(c.probes.some((p) => p.facts.includes(f.id) && ['yes', 'partial', 'no'].includes(p.answer)), `${c.id}: a question reaches ${f.id}`).toBe(true);
    }
  });

  it('asides for CASE 01 (c08) and CASE 05 (c01) only, sourced; the sample frame of 「先生のひとこと」 in c01 only', () => {
    const withAside = cases.filter((c) => c.science.aside).map((c) => c.id.slice(0, 3)).sort();
    expect(withAside).toEqual(['c01', 'c08']);
    for (const c of cases.filter((x) => x.science.aside)) {
      const a = c.science.aside!;
      expect(a.sources.length, c.id).toBeGreaterThanOrEqual(2);
      for (const s of a.sources) {
        expect(s.url, c.id).toMatch(/^https:\/\//);
        expect(s.accessedDate, c.id).toBe('2026-10-03');
        expect(s.supports.length, c.id).toBeGreaterThan(20);
      }
      // nothing is attributed to the supervisor: no quote marks around his name, no 「くられ」 at all
      expect(`${a.title}${a.text}`, c.id).not.toMatch(/くられ|先生/u);
    }
    expect(cases.filter((c) => c.science.aside?.supervisorNote === 'placeholder').map((c) => c.id.slice(0, 3))).toEqual(['c01']);
  });
});
