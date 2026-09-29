/**
 * Content rules that the schema cannot express (docs/design-bible.md §2, content/VOICE.md).
 *
 *   - Debate success lines are Jane's corrected memory (the UI shows ShotResponse.lines as Jane):
 *     no Holma voice markers and no keigo in them, nor in Jane's debate statements.
 *   - Nothing the player can see before the verdict carries a case leak term (validate.ts does
 *     not cover the debate).
 *   - Holma's glass eye is amber (琥珀色), never red (changed 2026-09-24).
 *   - Case 3 is 「雪に残されたもの」 / WHAT WAS LEFT IN THE SNOW, and its pre-verdict text does not
 *     say the clothes were 「脱ぎ捨て」 (the wearer's own act — it would hint the first reversal).
 *   - c07 (2026-09-29) starts without telling whether "she" is a person or a rose: nothing the
 *     player sees before asking (card, intro, starting findings, hint 1, idle lines, nudges, the
 *     debate) names a flower, a vase or a plant, her shard mask is shapeless and her lit shards
 *     show a stand-in picture (victim.shardPortrait), not the rose.
 *   - Every case documents the safety filter with ≥ 8 authored SAFETY probes (cannot, kind meta).
 *   - 2026-09-25 content fixes (critics + AI playtest): hints carry no leak term; wrong-shot lines
 *     do not name a noise; choice options are balanced (the right one is never the only longest);
 *     Jane's lines fit a phone; no "painless death" wording; the science text is だ・である with
 *     「」 and half-width %; the line bank keeps VOICE.md's answer / ェァ / wrong-shot rules.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Case } from '../../shared/case-schema';
import { normalize } from '../../server/engine/normalize';
import { toSummary } from '../../server/engine/public-view';
import { contentRegistry } from './regression-harness';

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(here, '../../content');
const read = (p: string) => readFileSync(resolve(contentDir, p), 'utf8');

const cases: Case[] = contentRegistry()
  .list(true)
  .map((l) => l.data);

/** Holma's verbal tics (VOICE.md). Jane never uses them. */
const HOLMA_VOICE = /ですねェ|ですとも|ございま|クックック|ククッ|なさい|さァ|わたくし|私(?:は|の|が|も|に|を)|おやおや|いやはや|ましょう|審問官(?!さん)/u;
/** Jane does not use keigo (VOICE.md). */
const KEIGO = /(?:です|ます|でした|ました|ません|でしょう)(?=[。、…！？」』]|$)/u;

describe('content rules', () => {
  it('loads all seven cases', () => {
    expect(cases.map((c) => c.id).sort()).toEqual([
      'c01-room-without-breath', 'c02-ball-at-dusk', 'c03-shed-in-snow', 'c04-white-flower-supper',
      'c05-tiptoe-milk-bottle', 'c06-snowman-below-zero', 'c07-rose-that-bowed',
    ]);
  });

  it('opens with the three short intro cases (CASE 01–03), then the four full cases (04–07)', () => {
    const byNumber = [...cases].sort((a, b) => a.number - b.number);
    expect(byNumber.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(byNumber.slice(0, 3).map((c) => c.id)).toEqual(['c05-tiptoe-milk-bottle', 'c06-snowman-below-zero', 'c07-rose-that-bowed']);
    for (const c of byNumber.slice(0, 3)) {
      expect(c.difficulty, c.id).toBe(1);
      expect(c.estimatedMinutes, c.id).toBeLessThanOrEqual(15);
      expect(c.debate, c.id).toHaveLength(1);
      // an object soul: its own shard mask and profile rows, no human wording in the science chain.
      // c07 hides what she is until the verdict (2026-09-29): a shapeless mask instead of the rose.
      if (c.id === 'c07-rose-that-bowed') expect(c.victim.silhouette, c.id).toBe('none');
      else expect(c.victim.silhouette, c.id).toMatch(/^M/);
      expect(c.victim.profile?.length, c.id).toBeGreaterThan(0);
      expect(c.science.chain.map((x) => x.stage), c.id).not.toContain('人体への影響');
    }
  });

  describe.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    it('debate success lines are in Jane’s voice', () => {
      // ShotResponse.lines has no speaker; the inquest UI (src/features/inquest/session.ts
      // successSpeaker) also reads 「あなた」「審問官」 as Holma, so success lines avoid them too.
      const bad = c.debate.flatMap((r) =>
        r.success.filter((t) => HOLMA_VOICE.test(t) || KEIGO.test(t) || /あなた|審問官/u.test(t)).map((t) => `${r.id}: ${t}`),
      );
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('Jane’s debate statements are in Jane’s voice', () => {
      const bad = c.debate.flatMap((r) =>
        r.statements.filter((s) => s.speaker === 'jane' && (HOLMA_VOICE.test(s.text) || KEIGO.test(s.text))).map((s) => `${r.id}/${s.id}: ${s.text}`),
      );
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('debate text carries no leak term (it is shown before the verdict)', () => {
      const texts = c.debate.flatMap((r) => [r.title, ...r.intro, ...r.statements.map((s) => s.text), ...r.success, ...r.wrongShot, r.hint]);
      const bad: string[] = [];
      for (const t of texts) for (const term of c.leakTerms) if (normalize(term) && normalize(t).includes(normalize(term))) bad.push(`"${term}" in ${t}`);
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('hints carry no leak term (they steer the question, not the vocabulary)', () => {
      const bad: string[] = [];
      for (const h of c.hints) for (const term of c.leakTerms) if (normalize(term) && normalize(h.text).includes(normalize(term))) bad.push(`hint ${h.level}: "${term}"`);
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('wrong-shot lines never name a noise of their round (the 2-miss hint does that)', () => {
      const bad: string[] = [];
      for (const r of c.debate) {
        const spans = r.statements.flatMap((s) => [...s.text.matchAll(/\[\[([^\]]+)\]\]/gu)].map((m) => m[1]));
        for (const w of r.wrongShot) for (const sp of spans) if (w.includes(sp)) bad.push(`${r.id}: 「${sp}」 in ${w}`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('choice options are balanced: the right one is never the only longest, lengths within 4 characters', () => {
      const items = [
        ...c.quiz.map((q, i) => ({ id: `quiz ${i + 1}`, texts: q.choices, right: q.answer })),
        ...c.reconstruction.panels
          .filter((p) => p.choice)
          .map((p) => ({ id: `panel ${p.id}`, texts: p.choice!.options.map((o) => o.text), right: p.choice!.options.findIndex((o) => o.correct) })),
        // verdict by difficulty (見習い choice / 審問官 cloze blanks)
        ...(c.verdictModes
          ? [
              { id: 'verdict choice', texts: c.verdictModes.choice.options.map((o) => o.text), right: c.verdictModes.choice.options.findIndex((o) => o.correct) },
              ...c.verdictModes.cloze.blanks.map((b) => ({ id: `verdict blank ${b.id}`, texts: b.options, right: b.answer })),
            ]
          : []),
      ];
      const bad: string[] = [];
      for (const it of items) {
        const len = it.texts.map((t) => [...t].length);
        const max = Math.max(...len);
        if (len[it.right] === max && len.filter((l) => l === max).length === 1) bad.push(`${it.id}: the right option is the longest (${len.join('/')})`);
        if (max - Math.min(...len) > 4) bad.push(`${it.id}: lengths ${len.join('/')}`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('Jane’s lines fit a phone (≤ 40 characters; split longer ones into array entries)', () => {
      const lines = [
        ...c.intro.jane,
        ...c.victim.farewell,
        ...c.debate.flatMap((r) => [...r.statements.filter((s) => s.speaker === 'jane').map((s) => s.text.replace(/\[\[|\]\]/gu, '')), ...r.success]),
      ];
      const bad = lines.filter((t) => [...t].length > 40);
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('never says or implies the death was painless (safe messaging, VOICE.md)', () => {
      const narrative = [
        ...c.victim.farewell,
        ...c.hints.map((h) => h.text),
        ...c.reconstruction.finale,
        ...c.reconstruction.panels.map((p) => p.caption),
        ...c.holmaLines.solved,
        ...c.debate.flatMap((r) => r.success),
      ];
      const bad = narrative.filter((t) => /苦しくなかった(?!の(?:では|じゃ))|苦しまず(?:に|で)(?:済|死|亡|眠)|楽に(?:死|逝|亡)|楽だった/u.test(t));
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('the science text is plain だ・である, 「」 for terms, half-width %, no honorific for the victim', () => {
      const s = c.science;
      const texts: [string, string][] = [
        ['title', s.title], ['lead', s.lead], ['body', s.body], ['whyHere', s.whyHere], ['safetyNote', s.safetyNote],
        ...s.chain.map((x, i): [string, string] => [`chain ${i}`, x.detail]),
        ...s.mechanism.map((x, i): [string, string] => [`mechanism ${i}`, `${x.heading} ${x.text}`]),
        ...s.misconceptions.map((x, i): [string, string] => [`myth ${i}`, `${x.myth} ${x.truth}`]),
        ...s.everyday.map((x, i): [string, string] => [`everyday ${i}`, x]),
        ...s.takeaways.map((x, i): [string, string] => [`takeaway ${i}`, x]),
        ...s.foreshadowing.map((x): [string, string] => [`clue ${x.fact}`, x.meaning]),
        ...c.scienceMemos.map((m): [string, string] => [`memo ${m.id}`, `${m.title} ${m.text}`]),
        ...c.quiz.map((q, i): [string, string] => [`quiz ${i + 1}`, `${q.q} ${q.explain}`]),
      ];
      const names = c.victim.name.split(/\s+/u).filter(Boolean);
      const bad: string[] = [];
      for (const [where, t] of texts) {
        if (KEIGO.test(t)) bad.push(`${where}: です・ます — ${t.slice(0, 40)}`);
        if (/[『』％]/u.test(t)) bad.push(`${where}: 『』 or ％ — ${t.slice(0, 40)}`);
        for (const n of names) if (t.includes(`${n}さん`)) bad.push(`${where}: ${n}さん`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('has verdict modes for every difficulty: one right choice ≤ 40 chars, an assist per debate round', () => {
      const vm = c.verdictModes;
      expect(vm, 'verdictModes').toBeDefined();
      if (!vm) return;
      const right = vm.choice.options.filter((o) => o.correct);
      expect(right).toHaveLength(1);
      expect([...right[0].text].length).toBeLessThanOrEqual(40);
      expect(vm.assists.map((a) => a.round).sort()).toEqual(c.debate.map((r) => r.id).sort());
      const bad = vm.assists.flatMap((a) => {
        const o = vm.choice.options.find((x) => x.id === a.removeOption);
        return [
          ...(!o || o.correct ? [`${a.round}: removeOption ${a.removeOption} must be a wrong option`] : []),
          ...(!vm.cloze.blanks.some((b) => b.id === a.fillBlank) ? [`${a.round}: fillBlank ${a.fillBlank}`] : []),
          ...(!c.answerElements.some((e) => e.id === a.element) ? [`${a.round}: element ${a.element}`] : []),
        ];
      });
      expect(bad, bad.join('\n')).toEqual([]);
    });

    it('has ≥ 8 authored SAFETY probes (cannot, kind meta, no facts)', () => {
      const safety = c.probes.filter((p) => (p.note ?? '').startsWith('SAFETY:'));
      expect(safety.length).toBeGreaterThanOrEqual(8);
      const bad = safety.filter((p) => p.answer !== 'cannot' || p.kind !== 'meta' || p.facts.length > 0).map((p) => p.q);
      expect(bad, bad.join('\n')).toEqual([]);
    });
  });
});

describe('Holma’s line bank (VOICE.md)', () => {
  const bank = JSON.parse(read('holma-lines.json')) as Record<string, unknown>;
  const texts = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(texts) : v && typeof v === 'object' ? ('text' in v && typeof (v as { text: unknown }).text === 'string' ? [(v as { text: string }).text] : Object.values(v).flatMap(texts)) : [];
  const answer = bank.answer as Record<string, unknown>;

  it('uses ェ／ァ at most once per line and laughs only クックック／ククッ', () => {
    const bad = texts(bank).filter((t) => (t.match(/[ェァ]/gu) ?? []).length > 1 || /ハハ|アハ|ワハ/u.test(t));
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('answer lines say their class', () => {
    const rules: Record<string, RegExp> = { yes: /はい|ええ|その通り/u, no: /いいえ|違います/u, partial: /一部|半分|部分的/u, irrelevant: /関係/u };
    const bad = Object.entries(rules).flatMap(([cls, re]) => texts(answer[cls]).filter((t) => !re.test(t)).map((t) => `${cls}: ${t}`));
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('a “no” never writes off the whole avenue, and no answer praises a trivial question', () => {
    const bad = [
      ...texts(answer.no).filter((t) => /行き止まり|思い込み|扉は、開きません|悪い問いではない|訊いたことに意味/u.test(t)),
      ...texts(answer.yes).filter((t) => /よく訊けました|いい質問|覚えておくと/u.test(t)),
    ];
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('fallback wrong-shot lines never say whether the target or the card was wrong', () => {
    const bad = texts((bank.inquest as Record<string, unknown>).wrongShot).filter((t) => /的違い|的が違|狙いは悪くない|所見が違う|どこを狙|横をすり抜け/u.test(t));
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe('prologue (content/prologue.json)', () => {
  type L = { speaker: string; text: string; fx?: string };
  const lines = (JSON.parse(read('prologue.json')) as { lines: L[] }).lines;

  it('stays short (16–20 lines; the first case teaches the controls in play)', () => {
    expect(lines.length).toBeGreaterThanOrEqual(16);
    expect(lines.length).toBeLessThanOrEqual(20);
  });

  it('keeps the cues src/scenes/Prologue relies on', () => {
    // practice: the line before the first 「はい」 stamp quotes a question to send
    const yes = lines.findIndex((l) => l.fx === 'stamp-yes');
    expect(yes).toBeGreaterThan(0);
    expect(lines[yes - 1].text).toMatch(/『[^』]+？』/u);
    // the other stamps quote their question first, so the stamp lands on the answer
    for (const fx of ['stamp-no', 'stamp-irrelevant']) expect(lines.find((l) => l.fx === fx)?.text.startsWith('『'), fx).toBe(true);
    // after Jane appears, a Holma line promises that findings light her shards
    const jane = lines.findIndex((l) => l.speaker === 'jane');
    expect(lines.some((l, k) => k > jane && l.speaker === 'holma' && /破片/u.test(l.text) && /灯/u.test(l.text))).toBe(true);
    expect(lines.at(-1)).toMatchObject({ fx: 'cutin', text: 'さァ——解剖（しらべ）を始めましょう' });
  });

  it('introduces the rules, the optional debate, the three difficulties and the fade-out', () => {
    const all = lines.map((l) => l.text).join('\n');
    for (const w of ['嘘をつけません', '訊かれたことにしか答えません', '反証', '見習い', '審問官', '教授', '選択式', '穴埋め式', '自由記述', '消えて']) expect(all, w).toContain(w);
  });
});

describe('Holma’s eye is amber', () => {
  const RED_EYE = /赤い(?:ガラス|目|瞳|義眼|眼)|(?:目|瞳|眼|ガラス玉)(?:は|が)?赤|紅い(?:目|瞳)/u;
  const files = ['holma-lines.json', 'prologue.json', 'VOICE.md', ...cases.map((c) => `cases/${c.id}/case.json`)];

  it.each(files)('%s never calls it red', (f) => {
    expect(read(f)).not.toMatch(RED_EYE);
  });

  it('the line bank and VOICE.md call it amber', () => {
    expect(read('holma-lines.json')).toContain('琥珀色のガラス玉');
    expect(read('VOICE.md')).toContain('琥珀色');
  });
});

describe('c07 keeps what she is a secret until the player asks (2026-09-29)', () => {
  const c7 = cases.find((c) => c.id === 'c07-rose-that-bowed')!;
  // 言葉 / 屋根 are not leaves or roots
  const PLANT = /花|植物|茎|(?<!言)葉|(?<!屋)根|つぼみ|バラ|ばら|薔薇|かびん|rose|flower|vase|plant|petal|stem|bloom|bouquet/iu;

  it('the case card, intro, starting findings, hint 1, idle lines, nudges and the debate name no flower, vase or plant', () => {
    const pre: [string, string][] = [
      ['title', c7.title],
      ['titleEn', c7.titleEn],
      ...c7.categories.map((t, i): [string, string] => [`categories[${i}]`, t]),
      ['contentWarning', c7.contentWarning ?? ''],
      ['intro.summary', c7.intro.summary],
      ['intro.location', c7.intro.location],
      ['intro.time', c7.intro.time],
      ...c7.intro.narration.map((t, i): [string, string] => [`intro.narration[${i}]`, t]),
      ...c7.intro.jane.map((t, i): [string, string] => [`intro.jane[${i}]`, t]),
      ...c7.intro.holma.map((t, i): [string, string] => [`intro.holma[${i}]`, t]),
      ...c7.intro.starterQuestions.map((t, i): [string, string] => [`intro.starterQuestions[${i}]`, t]),
      ...c7.hints.filter((h) => h.level === 1).map((h): [string, string] => ['hint 1', h.text]),
      ...c7.holmaLines.idle.map((t, i): [string, string] => [`holmaLines.idle[${i}]`, t]),
      ...c7.holmaLines.nearCore.map((t, i): [string, string] => [`holmaLines.nearCore[${i}]`, t]),
      ...(c7.nudges ?? []).map((t, i): [string, string] => [`nudges[${i}]`, t]),
      ...c7.facts.filter((f) => f.visibleFromStart).flatMap((f): [string, string][] => [[`${f.id}.text`, f.text], [`${f.id}.cardTitle`, f.cardTitle ?? '']]),
      ...c7.debate.flatMap((r): [string, string][] =>
        [r.title, ...r.intro, ...r.statements.map((s) => s.text), ...r.success, ...r.wrongShot, r.hint].map((t): [string, string] => [`debate ${r.id}`, t]),
      ),
    ];
    const bad = pre.filter(([, t]) => PLANT.test(t)).map(([w, t]) => `${w}: ${t}`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('her shard mask is shapeless before the solve (not a rose, not a person)', () => {
    expect(c7.victim.silhouette).toBe('none');
  });

  it('her lit shards show the dawn dining room, not the rose portrait (victim.shardPortrait)', () => {
    const shards = c7.victim.shardPortrait;
    expect(shards).toBeTruthy();
    expect(shards).not.toBe(c7.victim.portrait);
    expect(toSummary(c7).portrait).toBe(shards);
    expect(existsSync(resolve(here, '../../public', shards!))).toBe(true);
  });

  it('the rose and vase words are leak terms (never in public text, never in a model reply before the player holds them)', () => {
    for (const t of ['バラ', '薔薇', '花びん', '花瓶', '切り花']) expect(c7.leakTerms).toContain(t);
  });
});

describe('case 3 title', () => {
  const c3 = cases.find((c) => c.id === 'c03-shed-in-snow')!;

  it('is 「雪に残されたもの」 / WHAT WAS LEFT IN THE SNOW', () => {
    expect(c3.title).toBe('雪に残されたもの');
    expect(c3.titleEn).toBe('WHAT WAS LEFT IN THE SNOW');
  });

  it('the old title appears nowhere in player content', () => {
    for (const f of ['holma-lines.json', 'prologue.json', ...cases.map((c) => `cases/${c.id}/case.json`)]) expect(read(f), f).not.toContain('雪に脱ぎ捨てたもの');
  });

  it('pre-verdict text does not say the clothes were 「脱ぎ捨て」', () => {
    const pre = [
      c3.title,
      c3.intro.summary,
      ...c3.intro.narration,
      ...c3.intro.jane,
      ...c3.intro.holma,
      ...c3.intro.starterQuestions,
      ...c3.hints.map((h) => h.text),
      ...c3.debate.flatMap((r) => [r.title, ...r.intro, ...r.statements.map((s) => s.text), ...r.success, ...r.wrongShot, r.hint]),
      ...c3.holmaLines.nearCore,
      ...c3.holmaLines.idle,
      ...c3.scienceMemos.map((m) => `${m.title} ${m.text}`),
      ...c3.facts.filter((f) => f.spoilerLevel <= 3).flatMap((f) => [f.text, f.cardTitle ?? '']),
    ];
    const bad = pre.filter((t) => t.includes('脱ぎ捨て'));
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
