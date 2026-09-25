/**
 * Verdict by difficulty: verdictSetup (views + debate assists), choice / cloze judging, the
 * HTTP route and the validator checks for verdictModes.
 */
import { describe, expect, it } from 'vitest';
import { ApiError, type VerdictSetupResponse } from '../../shared/api';
import type { Case } from '../../shared/case-schema';
import { GameService } from '../../server/engine/game';
import { ContentRegistry } from '../../server/engine/registry';
import { initialState } from '../../server/engine/state';
import { signToken } from '../../server/engine/token';
import { TraceRing } from '../../server/engine/trace';
import { verdictBlankOrder, verdictChoiceOrder, verdictSetupView } from '../../server/engine/public-view';
import { validateCase } from '../../server/engine/validate';
import { createApiHandler } from '../../server/http/handler';
import { createRuntime } from '../../server/http/runtime';
import { FIXTURE_ID, SECRET, fixtureCase, fixtureRaw, makeService } from './helpers';

type Raw = Record<string, any>;
const caseId = FIXTURE_ID;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ApiError ? e.code : 'unknown';
  }
}

/** A token with the given debate rounds cleared (and optionally already solved). */
async function tokenWith(cleared: string[], extra: Partial<ReturnType<typeof initialState>> = {}): Promise<string> {
  return signToken({ ...initialState(fixtureCase(), Date.now()), cleared, ...extra }, SECRET);
}

function serviceFor(mutate: (raw: Raw) => void) {
  const raw = fixtureRaw() as Raw;
  mutate(raw);
  const registry = ContentRegistry.fromRaw({ cases: [{ dir: FIXTURE_ID, path: 'tests/fixtures/case-fixture.json', data: raw }] });
  return new GameService({ content: () => registry, secret: SECRET, components: { mode: 'rules', warnings: [] } });
}

/** Displayed index of a blank's correct answer (what the test "player" would click). */
function rightIndex(c: Case, blankId: string): number {
  const b = c.verdictModes!.cloze.blanks.find((x) => x.id === blankId)!;
  return verdictBlankOrder(c, b).indexOf(b.answer);
}
function wrongIndex(c: Case, blankId: string): number {
  return rightIndex(c, blankId) === 0 ? 1 : 0;
}

describe('verdictSetup', () => {
  it('needs a valid token and a known mode', async () => {
    const { svc } = makeService();
    expect(await code(svc.verdictSetup({ caseId, token: '', mode: 'choice' }))).toBe('bad_token');
    const t = (await svc.newToken(caseId)).token;
    expect(await code(svc.verdictSetup({ caseId, token: t.slice(0, -3) + 'abc', mode: 'choice' }))).toBe('bad_token');
    expect(await code(svc.verdictSetup({ caseId, token: t, mode: 'essay' as never }))).toBe('bad_request');
    expect(await code(svc.verdictSetup({ caseId, token: t } as never))).toBe('bad_request');
    expect(await code(svc.verdictSetup({ caseId: 'c00-nope', token: t, mode: 'free' }))).toBe('bad_request');
  });

  it('choice: shuffled options, no correctness, wrong options struck out per cleared round', async () => {
    const { svc } = makeService();
    const c = fixtureCase();
    const fresh = await svc.verdictSetup({ caseId, token: await tokenWith([]), mode: 'choice' });
    expect(fresh).toMatchObject({ mode: 'choice', available: true, assistsEarned: 0, assistsTotal: 2 });
    expect(fresh.cloze).toBeUndefined();
    expect(fresh.free).toBeUndefined();
    const order = verdictChoiceOrder(c, c.verdictModes!);
    expect(fresh.choice!.options.map((o) => o.id)).toEqual(order.map((i) => c.verdictModes!.choice.options[i].id));
    expect(fresh.choice!.options.map((o) => o.id)).not.toEqual(['co', 'cold', 'poison', 'heart']); // not the authored order
    expect(fresh.choice!.options.every((o) => o.removed === false)).toBe(true);
    const json = JSON.stringify(fresh);
    expect(json).not.toContain('"correct"');
    expect(JSON.stringify(fresh.choice)).not.toContain('true'); // no flag that could single out the answer
    expect(Object.keys(fresh.choice!.options[0]).sort()).toEqual(['id', 'removed', 'text']);

    const one = await svc.verdictSetup({ caseId, token: await tokenWith(['R1']), mode: 'choice' });
    expect(one.assistsEarned).toBe(1);
    expect(one.choice!.options.filter((o) => o.removed).map((o) => o.id)).toEqual(['cold']);
    const both = await svc.verdictSetup({ caseId, token: await tokenWith(['R1', 'R2']), mode: 'choice' });
    expect(both.assistsEarned).toBe(2);
    expect(both.choice!.options.filter((o) => o.removed).map((o) => o.id).sort()).toEqual(['cold', 'heart']);
    expect(both.choice!.options.find((o) => o.id === 'co')!.removed).toBe(false);
  });

  it('choice: an assist that points at the correct option never removes it', () => {
    const c = fixtureCase();
    c.verdictModes!.assists = [{ round: 'R1', removeOption: 'co' }, { round: 'R2', removeOption: 'nope' }];
    const v = verdictSetupView(c, ['R1', 'R2'], 'choice');
    expect(v.choice!.options.some((o) => o.removed)).toBe(false);
    expect(v.assistsTotal).toBe(0);
  });

  it('cloze: shuffled options per blank, filled = displayed index of the answer only when assisted', async () => {
    const { svc } = makeService();
    const c = fixtureCase();
    const fresh = await svc.verdictSetup({ caseId, token: await tokenWith([]), mode: 'cloze' });
    expect(fresh).toMatchObject({ mode: 'cloze', available: true, assistsEarned: 0, assistsTotal: 2 });
    expect(fresh.cloze!.template).toBe(c.verdictModes!.cloze.template);
    expect(fresh.cloze!.blanks.map((b) => b.id)).toEqual(['place', 'source', 'cause']);
    for (const b of c.verdictModes!.cloze.blanks) {
      const view = fresh.cloze!.blanks.find((x) => x.id === b.id)!;
      expect(view.label).toBe(b.label);
      expect(view.options).toEqual(verdictBlankOrder(c, b).map((i) => b.options[i]));
      expect(view.filled).toBeUndefined();
    }
    // The fixture's answers are all authored first; the shuffle moves at least some of them.
    expect(fresh.cloze!.blanks.some((b, i) => b.options[0] !== c.verdictModes!.cloze.blanks[i].options[0])).toBe(true);
    expect(JSON.stringify(fresh)).not.toContain('"answer"');

    const both = await svc.verdictSetup({ caseId, token: await tokenWith(['R1', 'R2']), mode: 'cloze' });
    expect(both.assistsEarned).toBe(2);
    for (const b of both.cloze!.blanks) {
      if (b.id === 'cause') expect(b.filled).toBeUndefined();
      else expect(b.options[b.filled!]).toBe(c.verdictModes!.cloze.blanks.find((x) => x.id === b.id)!.options[0]);
    }
  });

  it('free: element labels and the elements revealed by cleared rounds', async () => {
    const { svc } = makeService();
    const fresh = await svc.verdictSetup({ caseId, token: await tokenWith([]), mode: 'free' });
    expect(fresh).toEqual({ mode: 'free', available: true, assistsEarned: 0, assistsTotal: 2, free: { labels: { A: '直接死因', B: '原因となった出来事', C: '科学的な仕組み' }, revealed: [] } });
    const r2 = await svc.verdictSetup({ caseId, token: await tokenWith(['R2']), mode: 'free' });
    expect(r2.free!.revealed).toEqual(['B']);
    const both = await svc.verdictSetup({ caseId, token: await tokenWith(['R1', 'R2']), mode: 'free' });
    expect(both.free!.revealed).toEqual(['B', 'C']);
    // only ids and labels: no element descriptions / keywords
    expect(JSON.stringify(both)).not.toContain('一酸化炭素');
  });

  it('falls back to free (available: false) for a case without verdictModes', async () => {
    const svc = serviceFor((raw) => delete raw.verdictModes);
    const t = await tokenWith(['R1']);
    for (const mode of ['choice', 'cloze', 'free'] as const) {
      const v: VerdictSetupResponse = await svc.verdictSetup({ caseId, token: t, mode });
      expect(v).toEqual({ mode: 'free', available: false, assistsEarned: 0, assistsTotal: 0, free: { labels: { A: '直接死因', B: '原因となった出来事', C: '科学的な仕組み' }, revealed: [] } });
    }
    // choice / cloze verdicts are refused there; free still works
    expect(await code(svc.verdict({ caseId, token: t, mode: 'choice', choice: 'co' }))).toBe('bad_request');
    expect(await code(svc.verdict({ caseId, token: t, mode: 'cloze', blanks: {} }))).toBe('bad_request');
    expect((await svc.verdict({ caseId, token: t, mode: 'free', text: '心臓発作' })).result).toBe('wrong');
  });

  it('puts the correct option in a middle position, varying across cases', () => {
    const base = fixtureCase();
    const n = base.verdictModes!.choice.options.length;
    const positions = new Set<number>();
    for (let i = 10; i < 70; i++) {
      const c = { ...base, id: `c${i}-shuffle` };
      const pos = verdictChoiceOrder(c, base.verdictModes!).indexOf(0); // authored index 0 = correct
      expect(pos).toBeGreaterThan(0);
      expect(pos).toBeLessThan(n - 1);
      positions.add(pos);
    }
    expect(positions.size).toBe(n - 2);
  });
});

describe('verdict: choice', () => {
  it('judges the picked option, counts every attempt, never reveals the answer', async () => {
    const traces = new TraceRing(20);
    const { svc } = makeService({ traces });
    const c = fixtureCase();
    let t = await tokenWith([]);
    const wrong = await svc.verdict({ caseId, token: t, mode: 'choice', choice: 'poison' });
    expect(wrong.result).toBe('wrong');
    expect(wrong.matched).toEqual([]);
    expect(wrong.labels).toEqual({ A: '直接死因', B: '原因となった出来事', C: '科学的な仕組み' });
    expect(wrong.progress.verdictAttempts).toBe(1);
    expect(wrong.progress.solved).toBe(false);
    // the option names poisoning → Holma answers that wrong claim (authored, answer-free)
    expect(wrong.lines).toContain(c.wrongClaims.find((w) => w.id === 'W1')!.feedback);
    expect(JSON.stringify(wrong)).not.toContain('一酸化炭素');
    expect(JSON.stringify(wrong)).not.toContain('"co"');
    expect(traces.list()[0]).toMatchObject({ kind: 'verdict', input: 'choice:poison', result: ['wrong'] });
    t = wrong.token;

    const cold = await svc.verdict({ caseId, token: t, mode: 'choice', choice: 'cold' });
    expect(cold.result).toBe('wrong');
    expect(cold.lines).toHaveLength(1);
    expect(cold.progress.verdictAttempts).toBe(2);
    t = cold.token;

    const ok = await svc.verdict({ caseId, token: t, mode: 'choice', choice: 'co' });
    expect(ok.result).toBe('correct');
    expect(ok.matched).toEqual(['A', 'B', 'C']);
    expect(ok.progress).toMatchObject({ solved: true, verdictAttempts: 3, nearCore: true });
    expect(ok.lines).toHaveLength(1);
    // solved: the solution opens; further verdicts are not counted
    expect((await svc.solution({ caseId, token: ok.token })).truth.causeOfDeath).toBe('一酸化炭素中毒');
    const again = await svc.verdict({ caseId, token: ok.token, mode: 'choice', choice: 'heart' });
    expect(again.result).toBe('correct');
    expect(again.progress.verdictAttempts).toBe(3);
  });

  it('refuses missing, unknown and struck-out picks without counting them', async () => {
    const { svc } = makeService();
    const t = await tokenWith(['R1']);
    expect(await code(svc.verdict({ caseId, token: t, mode: 'choice' }))).toBe('bad_request');
    expect(await code(svc.verdict({ caseId, token: t, mode: 'choice', choice: '' }))).toBe('bad_request');
    expect(await code(svc.verdict({ caseId, token: t, mode: 'choice', choice: 'nope' }))).toBe('bad_request');
    expect(await code(svc.verdict({ caseId, token: t, mode: 'choice', choice: 3 as never }))).toBe('bad_request');
    expect(await code(svc.verdict({ caseId, token: t, mode: 'choice', choice: 'cold' }))).toBe('bad_request'); // removed by R1
    expect(await code(svc.verdict({ caseId, token: t, mode: 'banana' as never, choice: 'co' }))).toBe('bad_request');
    expect(await code(svc.verdict({ caseId, token: 'j1.x.y', mode: 'choice', choice: 'co' }))).toBe('bad_token');
    // 'heart' is only removed after R2
    const heart = await svc.verdict({ caseId, token: t, mode: 'choice', choice: 'heart' });
    expect(heart.result).toBe('wrong');
    expect(heart.progress.verdictAttempts).toBe(1);
  });
});

describe('verdict: cloze', () => {
  it('maps displayed indices through the shuffle: all → correct, some → missing, none → wrong', async () => {
    const { svc } = makeService();
    const c = fixtureCase();
    const labels = { place: '場所', source: '燃やした物', cause: '直接死因' };
    let t = await tokenWith([]);

    const none = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { place: wrongIndex(c, 'place'), source: wrongIndex(c, 'source'), cause: wrongIndex(c, 'cause') } });
    expect(none.result).toBe('wrong');
    expect(none.matched).toEqual([]);
    expect(none.labels).toEqual(labels);
    expect(none.progress.verdictAttempts).toBe(1);
    t = none.token;

    const some = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { place: rightIndex(c, 'place'), source: wrongIndex(c, 'source'), cause: rightIndex(c, 'cause') } });
    expect(some.result).toBe('missing');
    expect(some.matched).toEqual(['place', 'cause']);
    expect(some.labels).toEqual(labels);
    expect(some.progress).toMatchObject({ verdictAttempts: 2, solved: false });
    expect(some.lines.length).toBeGreaterThan(0);
    t = some.token;

    // the authored index would be 0 for every answer — only the displayed index counts
    const authored = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { place: 0, source: 0, cause: 0 } });
    const expectAuthored = ['place', 'source', 'cause'].filter((id) => rightIndex(c, id) === 0);
    expect(authored.matched).toEqual(expectAuthored);
    t = authored.token;

    const all = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { place: rightIndex(c, 'place'), source: rightIndex(c, 'source'), cause: rightIndex(c, 'cause') } });
    expect(all.result).toBe('correct');
    expect(all.matched).toEqual(['place', 'source', 'cause']);
    expect(all.progress).toMatchObject({ solved: true, verdictAttempts: 4, nearCore: true });
    const again = await svc.verdict({ caseId, token: all.token, mode: 'cloze', blanks: { place: 0, source: 0, cause: 0 } });
    expect(again.result).toBe('correct');
    expect(again.progress.verdictAttempts).toBe(4);
  });

  it('agrees with the setup view: picking what the view pre-filled is right', async () => {
    const { svc } = makeService();
    const t = await tokenWith(['R1', 'R2']);
    const view = await svc.verdictSetup({ caseId, token: t, mode: 'cloze' });
    const c = fixtureCase();
    const picks: Record<string, number> = {};
    for (const b of view.cloze!.blanks) picks[b.id] = b.filled ?? b.options.indexOf(c.verdictModes!.cloze.blanks.find((x) => x.id === b.id)!.options[0]);
    expect((await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: picks })).result).toBe('correct');
    // assisted blanks may be left out (they count as filled); the rest may not
    const partial = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { cause: picks.cause } });
    expect(partial.result).toBe('correct');
    expect(await code(svc.verdict({ caseId, token: t, mode: 'cloze', blanks: { place: picks.place } }))).toBe('bad_request');
  });

  it('refuses malformed picks without counting them', async () => {
    const { svc } = makeService();
    const t = await tokenWith([]);
    const ok = { place: 0, source: 0, cause: 0 };
    for (const blanks of [
      undefined,
      null,
      [0, 0, 0],
      'place=0',
      { place: 0, source: 0 }, // cause missing (not assisted)
      { ...ok, cause: 4 }, // out of range (4 options)
      { ...ok, cause: -1 },
      { ...ok, cause: 1.5 },
      { ...ok, cause: '1' },
      { ...ok, extra: 0 }, // unknown blank
      { ...ok, constructor: 0 },
    ]) {
      expect(await code(svc.verdict({ caseId, token: t, mode: 'cloze', blanks: blanks as never })), JSON.stringify(blanks)).toBe('bad_request');
    }
    const counted = await svc.verdict({ caseId, token: t, mode: 'cloze', blanks: ok });
    expect(counted.progress.verdictAttempts).toBe(1);
  });
});

describe('verdict: free (default mode) is unchanged', () => {
  it('still needs text and judges it', async () => {
    const { svc } = makeService();
    const t = await tokenWith([]);
    expect(await code(svc.verdict({ caseId, token: t }))).toBe('bad_request');
    expect(await code(svc.verdict({ caseId, token: t, mode: 'free', choice: 'co' }))).toBe('bad_request');
    const r = await svc.verdict({ caseId, token: t, mode: 'free', text: 'テントの中で炭火を燃やして一酸化炭素中毒になった' });
    expect(r.result).toBe('correct');
    const d = await svc.verdict({ caseId, token: t, text: '一酸化炭素中毒' });
    expect(d.result).toBe('almost');
  });
});

describe('HTTP: verdict-setup and verdict modes', () => {
  function setup() {
    const raw = fixtureRaw();
    const registry = ContentRegistry.fromRaw({ cases: [{ dir: FIXTURE_ID, path: 'tests/fixtures/case-fixture.json', data: raw }] });
    const rt = createRuntime({ env: { APP_ENV: 'production', SESSION_SECRET: 'handler-test-secret-0123456789abcdef' }, content: () => registry });
    const handle = createApiHandler(rt);
    return async (path: string, body: unknown) => {
      const r = await handle(new Request('http://game.test' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      return { status: r.status, body: (await r.json()) as any };
    };
  }

  it('routes setup, choice and cloze verdicts', async () => {
    const post = setup();
    const tok = (await post('/api/token', { caseId })).body.token;
    const s = await post('/api/inquest/verdict-setup', { caseId, token: tok, mode: 'choice' });
    expect(s.status).toBe(200);
    expect(s.body.choice.options).toHaveLength(4);
    expect(JSON.stringify(s.body)).not.toContain('"correct"');
    expect((await post('/api/inquest/verdict-setup', { caseId, token: tok, mode: 'x' })).status).toBe(400);
    expect((await post('/api/inquest/verdict-setup', { caseId, token: 'j1.a.b', mode: 'free' })).status).toBe(401);

    const w = await post('/api/inquest/verdict', { caseId, token: tok, mode: 'choice', choice: 'heart' });
    expect(w.status).toBe(200);
    expect(w.body.result).toBe('wrong');
    expect(w.body.trace).toBeUndefined();
    const ok = await post('/api/inquest/verdict', { caseId, token: w.body.token, mode: 'choice', choice: 'co' });
    expect(ok.body.result).toBe('correct');
    expect(ok.body.progress.verdictAttempts).toBe(2);

    const c = fixtureCase();
    const cz = await post('/api/inquest/verdict', { caseId, token: tok, mode: 'cloze', blanks: { place: rightIndex(c, 'place'), source: wrongIndex(c, 'source'), cause: rightIndex(c, 'cause') } });
    expect(cz.body.result).toBe('missing');
    expect(cz.body.matched).toEqual(['place', 'cause']);
    expect((await post('/api/inquest/verdict', { caseId, token: tok, mode: 'cloze', blanks: { place: 9 } })).status).toBe(400);
    // free mode keeps its checks (text required, 600 chars) and needs no mode field
    expect((await post('/api/inquest/verdict', { caseId, token: tok })).status).toBe(400);
    expect((await post('/api/inquest/verdict', { caseId, token: tok, mode: 'free', text: 'あ'.repeat(601) })).status).toBe(400);
    expect((await post('/api/inquest/verdict', { caseId, token: tok, text: '心臓発作' })).body.result).toBe('wrong');
    expect((await post('/api/inquest/verdict', { caseId, token: tok, mode: 'essay', text: 'x' })).status).toBe(400);
  });
});

describe('validate: verdictModes', () => {
  const run = (mutate: (c: Raw) => void) => {
    const raw = fixtureRaw() as Raw;
    mutate(raw);
    return validateCase(raw, { skipGeneralization: true });
  };
  const vmErrors = (mutate: (c: Raw) => void) => run(mutate).errors.filter((e) => e.includes('verdictModes'));

  it('accepts the fixture, including leak terms inside verdictModes', () => {
    const r = run(() => {});
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.includes('verdictModes'))).toEqual([]);
    expect(JSON.stringify(fixtureRaw().verdictModes)).toContain('一酸化炭素'); // a leak term, allowed here
  });

  it('warns (never errors) when a published case has none', () => {
    const r = run((c) => delete c.verdictModes);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith('no verdictModes'))).toBe(true);
    const draft = run((c) => {
      delete c.verdictModes;
      c.publish = false;
    });
    expect(draft.warnings.some((w) => w.startsWith('no verdictModes'))).toBe(false);
  });

  it('choice: exactly one correct option, unique ids, neutral ids', () => {
    expect(vmErrors((c) => (c.verdictModes.choice.options[1].correct = true)).join()).toContain('2 correct options');
    expect(vmErrors((c) => (c.verdictModes.choice.options[0].correct = false)).join()).toContain('0 correct options');
    expect(vmErrors((c) => (c.verdictModes.choice.options[2].id = 'cold')).join()).toContain('duplicate option id cold');
    expect(vmErrors((c) => (c.verdictModes.choice.options[0].id = 'correct')).join()).toContain('hints at its correctness');
    expect(vmErrors((c) => (c.verdictModes.choice.options[3].id = 'wrong-2')).join()).toContain('hints at its correctness');
    expect(vmErrors((c) => (c.verdictModes.choice.options[2].id = 'smoke'))).toEqual([]);
  });

  it('choice: warns about a mislabelled wrong option and a giveaway-long correct one', () => {
    const w1 = run((c) => (c.verdictModes.choice.options[1].text = 'テントの中で炭火を燃やして一酸化炭素中毒になった')).warnings;
    expect(w1.some((w) => w.includes('wrong option cold passes the free-text verdict'))).toBe(true);
    const w2 = run((c) => (c.verdictModes.choice.options[0].text = 'テントの中で燃やした炭火のコンロから出た一酸化炭素が、閉め切った空間に少しずつ溜まって起きた中毒')).warnings;
    expect(w2.some((w) => w.includes('much longer'))).toBe(true);
  });

  it('cloze: placeholders and blanks match both ways, answers in range', () => {
    expect(vmErrors((c) => (c.verdictModes.cloze.template = '彼女は{{place}}で{{source}}を燃やした。{{when}}')).join('|')).toMatch(/placeholder \{\{when\}\} has no blank.*blank cause is not in the template|blank cause is not in the template.*placeholder \{\{when\}\}/);
    expect(vmErrors((c) => (c.verdictModes.cloze.blanks[2].answer = 4)).join()).toContain('answer index 4 out of range');
    expect(vmErrors((c) => (c.verdictModes.cloze.blanks[1].id = 'place')).join()).toContain('duplicate blank id place');
    expect(vmErrors((c) => (c.verdictModes.cloze.blanks[0].options[1] = 'テントの中')).join()).toContain('duplicate options');
    expect(vmErrors((c) => (c.verdictModes.cloze.template += '{{')).join()).toContain('unbalanced');
  });

  it('assists: known rounds, a WRONG option, a real blank and element', () => {
    const errs = vmErrors((c) => {
      c.verdictModes.assists = [
        { round: 'R9', removeOption: 'cold' },
        { round: 'R1', removeOption: 'co' },
        { round: 'R1', removeOption: 'nope', fillBlank: 'when', element: 'Z' },
      ];
    }).join('\n');
    expect(errs).toContain('unknown debate round R9');
    expect(errs).toContain('removeOption co is the CORRECT option');
    expect(errs).toContain('removeOption nope is not a choice option');
    expect(errs).toContain('fillBlank when is not a cloze blank');
    expect(errs).toContain('element Z is not an answer element');
    const warns = run((c) => {
      c.verdictModes.assists = [
        { round: 'R1', removeOption: 'cold', fillBlank: 'place' },
        { round: 'R2', removeOption: 'heart', fillBlank: 'source' },
        { round: 'R2', removeOption: 'poison', fillBlank: 'cause' },
        { round: 'R2' },
      ];
    }).warnings.join('\n');
    expect(warns).toContain('remove every wrong choice option');
    expect(warns).toContain('fill every cloze blank');
    expect(warns).toContain('gives nothing');
  });
});
