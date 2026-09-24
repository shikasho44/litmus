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
 *   - Every case documents the safety filter with ≥ 8 authored SAFETY probes (cannot, kind meta).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Case } from '../../shared/case-schema';
import { normalize } from '../../server/engine/normalize';
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
  it('loads all three cases', () => {
    expect(cases.map((c) => c.id).sort()).toEqual(['c01-room-without-breath', 'c02-ball-at-dusk', 'c03-shed-in-snow']);
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

    it('has ≥ 8 authored SAFETY probes (cannot, kind meta, no facts)', () => {
      const safety = c.probes.filter((p) => (p.note ?? '').startsWith('SAFETY:'));
      expect(safety.length).toBeGreaterThanOrEqual(8);
      const bad = safety.filter((p) => p.answer !== 'cannot' || p.kind !== 'meta' || p.facts.length > 0).map((p) => p.q);
      expect(bad, bad.join('\n')).toEqual([]);
    });
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
