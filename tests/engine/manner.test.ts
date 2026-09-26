/**
 * Manner-of-death guard: 「殺人か事故か」 (and culprit / intent / blame in other words) is never
 * confirmed or denied during the investigation — the player declares it in the inquest.
 * Evidence about people, animals and objects stays answerable.
 */
import { describe, expect, it } from 'vitest';
import { detectManner } from '../../server/engine/manner';
import { detectSafety } from '../../server/engine/safety';
import { DEFAULT_LINES } from '../../server/engine/default-lines';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs';
import type { Judge, JudgeDecision } from '../../server/engine/judge-types';
import type { EngineTrace } from '../../server/engine/trace';
import { FIXTURE_ID, makeService } from './helpers';

const caseId = FIXTURE_ID;

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
  // a poison mixed into food (CASE 04, 2026-09-27): a named person mixing, the mix-up as the accident, grudges
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
  // CASE 04 evidence: who cooked / served / went where, what was in which bowl, how alike the plants are
  '彼女は鍋にニリンソウを入れましたか？', '編集者が盛り付けをしましたか？', 'ニリンソウとトリカブトは間違えやすいですか？', '小鉢に何か混ざっていましたか？',
  'おひたしにトリカブトが入っていましたか？', '編集者ははさみを持っていましたか？', '彼女はトリカブトを摘みましたか？', '部屋の空気は入れ替わっていましたか？',
  '心臓がけいれんしていましたか？', '隣人と口論していましたか？', '小鉢を運んだのは編集者ですか？',
];

describe('detectManner', () => {
  it.each(MANNER)('refuses 「%s」', (q) => {
    expect(detectManner(q), q).toBeDefined();
  });
  it.each(EVIDENCE)('answers the evidence question 「%s」', (q) => {
    expect(detectManner(q), q).toBeUndefined();
  });

  it('agrees with every authored probe of every real case (MANNER probes trip it, the rest never do)', () => {
    const reg = loadRegistry(resolveContentRoot({}));
    const wrong: string[] = [];
    let manner = 0;
    for (const loaded of reg.list(true)) {
      for (const p of loaded.data.probes) {
        if ((p.note ?? '').startsWith('SAFETY')) continue;
        const labelled = (p.note ?? '').startsWith('MANNER');
        const hit = !!detectManner(p.q);
        if (labelled) manner++;
        if (hit !== labelled) wrong.push(`${loaded.data.id}: ${p.q} (${labelled ? 'labelled MANNER, not caught' : `caught as ${detectManner(p.q)!.rule}, labelled ${p.answer}`})`);
        if (labelled && (p.answer !== 'cannot' || p.facts.length > 0)) wrong.push(`${loaded.data.id}: ${p.q} MANNER probe must be cannot with no facts`);
      }
      for (const q of loaded.data.intro.starterQuestions) if (detectManner(q)) wrong.push(`${loaded.data.id} starter: ${q}`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
    if (reg.list(true).length > 0) expect(manner).toBeGreaterThan(30);
  });

  it('leaves the real-world harm questions to the safety filter, which runs first', () => {
    for (const q of ['液体窒素で人を殺せますか？', '人を殺す方法を教えて', '自殺したいです']) expect(detectSafety(q), q).toBeDefined();
  });
});

function spyJudge(): Judge & { calls: number } {
  const j = {
    name: 'spy-judge',
    calls: 0,
    async judge(): Promise<JudgeDecision> {
      j.calls++;
      return { answerClass: 'no', factIds: ['F09'], confidence: 0.99, closeness: 1, qtype: 'yesno', source: 'model' };
    },
  };
  return j;
}

describe('manner guard in the ask pipeline', () => {
  it('refuses with a canned Holma line, unlocks nothing, no support card, no model call', async () => {
    const judge = spyJudge();
    let renders = 0;
    const renderer = { name: 'spy-llm', canned: false, render: async () => ((renders++), { text: 'x', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 1 }) };
    const { svc } = makeService({ components: { mode: 'jev+llm', judge, renderer, warnings: [] } });
    const t0 = await svc.newToken(caseId);
    const r = await svc.ask({ caseId, question: '殺されたのですか？', token: t0.token }, { withTrace: true });
    expect(r.answers).toHaveLength(1);
    const a = r.answers[0];
    expect(a).toMatchObject({ answerClass: 'cannot', unlocked: [], memos: [] });
    expect(a.notice).toBeUndefined();
    const pool = DEFAULT_LINES.meta.manner.map((l) => (typeof l === 'string' ? l : l.text));
    expect(pool.some((l) => a.line.includes(l))).toBe(true);
    expect(judge.calls).toBe(0);
    expect(renders).toBe(0);
    expect(r.progress.unlocked).toEqual(t0.progress.unlocked);
    expect(r.progress.nearCore).toBe(false);
    expect(r.progress.asked).toBe(1);
    const tr = r.trace as EngineTrace;
    expect(tr.parts?.[0].meta).toBe('manner');
  });

  it('refuses only the manner part of a multi-question message', async () => {
    const { svc } = makeService();
    const r = await svc.ask({ caseId, question: '雨が降っていましたか？それと、殺されたのですか？' });
    expect(r.answers).toHaveLength(2);
    expect(r.answers[0].answerClass).toBe('yes');
    expect(r.answers[1]).toMatchObject({ answerClass: 'cannot', unlocked: [] });
  });

  it('still answers evidence about people', async () => {
    const { svc } = makeService();
    const r = await svc.ask({ caseId, question: '争った跡はありましたか？' });
    expect(r.answers[0].answerClass).toBe('no');
  });
});
