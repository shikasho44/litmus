/**
 * Validator extensions: leak scan of contentWarning / intro.location / intro.time, debate
 * success lines, image files (warnings only, via the injected asset check).
 * 2026-09-30: the leak scan also covers Holma's replies to a failed verdict (wrongClaims,
 * missingFeedback) and the verdict prompts; secretTerms cover every pre-solve text including the
 * verdict choices and the cloze; debate lines that name an object the intro never showed warn.
 */
import { describe, expect, it } from 'vitest';
import { validateCase } from '../../server/engine/validate';
import { fixtureRaw } from './helpers';

type Raw = Record<string, any>;
const run = (mutate: (c: Raw) => void, assetExists?: (p: string) => boolean) => {
  const raw = fixtureRaw() as Raw;
  mutate(raw);
  return validateCase(raw, { skipGeneralization: true, assetExists });
};

describe('validate: extended checks', () => {
  it('passes the fixture as is', () => {
    const r = run(() => {});
    expect(r.errors).toEqual([]);
  });

  it('scans contentWarning, intro.location and intro.time for leak terms', () => {
    const r = run((c) => {
      c.contentWarning = '一酸化炭素の話です';
      c.intro.location = '一酸化炭素の部屋';
      c.intro.time = 'CO中毒の朝';
    });
    expect(r.errors.filter((e) => e.startsWith('leak term')).map((e) => e.split(' in public field ')[1]).sort()).toEqual(['contentWarning', 'intro.location', 'intro.time']);
  });

  it('scans wrong-verdict replies, missing-element feedback and the verdict prompts for leak terms', () => {
    const blank = (fixtureRaw() as Raw).verdictModes.cloze.blanks[0].id;
    const r = run((c) => {
      c.wrongClaims[0].feedback = '一酸化炭素ではありませんよ';
      c.answerElements[1].missingFeedback = '一酸化炭素のことを、ひと言。';
      c.verdictModes.choice.prompt = '一酸化炭素を選びなさい';
      c.verdictModes.cloze.blanks[0].label = '一酸化炭素';
    });
    const where = r.errors.filter((e) => e.startsWith('leak term')).map((e) => e.split(' in pre-solve reply ')[1]);
    expect(where).toEqual(['wrongClaims.W1.feedback', 'answerElements.B.missingFeedback', 'verdictModes.choice.prompt', `verdictModes.cloze.${blank}.label`]);
  });

  it('leaves the verdict choices to secretTerms, which also cover hints and the debate but not findings the player asked for', () => {
    const optId = (fixtureRaw() as Raw).verdictModes.choice.options[0].id;
    const base = run((c) => {
      c.verdictModes.choice.options[0].text = '一酸化炭素を吸った';
    });
    expect(base.errors.filter((e) => e.includes('一酸化炭素'))).toEqual([]);
    const r = run((c) => {
      c.secretTerms = ['練炭'];
      c.verdictModes.choice.options[0].text = '練炭の煙を吸った';
      c.hints[c.hints.length - 1].text = '練炭を思い出して';
      c.debate[0].intro[0] = '練炭の話をしましょう';
      const f = c.facts.find((x: Raw) => !x.visibleFromStart);
      f.text = `${f.text}練炭`;
    });
    const secret = r.errors.filter((e) => e.startsWith('secret term'));
    expect(secret.some((e) => e.endsWith(`verdictModes.choice.${optId}`))).toBe(true);
    expect(secret.some((e) => e.includes(' in hint '))).toBe(true);
    expect(secret.some((e) => e.includes(' in debate '))).toBe(true);
    expect(secret.some((e) => / in F\d+\./.test(e))).toBe(false);
  });

  it('warns (never errors) when a debate line names a katakana object the intro never showed', () => {
    const r = run((c) => {
      c.debate[0].statements[1].text = 'だって、[[ストッパー]]が外れていたもの。';
    });
    expect(r.warnings.some((w) => w.includes('「ストッパー」'))).toBe(true);
    expect(run(() => {}).warnings.some((w) => w.includes('never show'))).toBe(false);
  });

  it('requires non-blank debate success lines', () => {
    const r = run((c) => {
      c.debate[0].success = ['  '];
    });
    expect(r.errors.some((e) => e.includes('success lines'))).toBe(true);
  });

  it('warns (never errors) about missing image files when an asset check is given', () => {
    const seen: string[] = [];
    const r = run(
      (c) => {
        c.reconstruction.panels[0].image = 'cases/c90/panel-1.webp';
      },
      (p) => (seen.push(p), p.startsWith('cases/c90/bg')),
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes('image file not found: public/cases/c90/panel-1.webp'))).toBe(true);
    expect(seen).toContain('cases/c90/panel-1.webp');
    // without the check nothing is reported
    expect(run((c) => (c.reconstruction.panels[0].image = 'cases/nope.webp')).warnings.some((w) => w.includes('image file'))).toBe(false);
  });
});
