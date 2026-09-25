/**
 * 難易度 (difficulty) — chosen per case when it starts (DifficultyChooser), remembered in the
 * save (CaseProgress.difficulty), changeable from the investigation menu until the inquest opens.
 *
 *   easy   見習い TRAINEE    choice verdict · 10 lights · game over → back to the start of the inquest
 *   normal 審問官 CORONER    cloze verdict  ·  3 lights · game over → the case starts over (default)
 *   hard   教授   PROFESSOR  free verdict   ·  3 lights · game over → the case starts over
 *
 * The rules themselves live in shared/api.ts (VERDICT_MODE_BY_DIFFICULTY, LIVES_BY_DIFFICULTY).
 */
import type { Difficulty, VerdictMode } from '../../../shared/api';
import { LIVES_BY_DIFFICULTY, VERDICT_MODE_BY_DIFFICULTY } from '../../../shared/api';
import type { CaseProgress } from '../../state/types';

export interface DifficultyMeta {
  id: Difficulty;
  jp: string;
  en: string;
  /** The one-line rule summary shown on the chooser card. */
  rule: string;
  /** Verdict format, short (badge). */
  modeJp: string;
  /** Holma's line when the card is focused. */
  holma: string;
  lives: number;
  mode: VerdictMode;
  recommended?: boolean;
  /** What a game over does (shown on the chooser and the game-over screen). */
  gameOverRule: string;
}

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];

export const DIFFICULTY_META: Record<Difficulty, DifficultyMeta> = {
  easy: {
    id: 'easy',
    jp: '見習い',
    en: 'TRAINEE',
    rule: '死因を選択肢から選ぶ・やり直し10回・失敗しても審問の最初から',
    modeJp: '選択式',
    holma: 'まずは肩慣らし。真実は、並べた選択肢のどれかにありますとも。',
    lives: LIVES_BY_DIFFICULTY.easy,
    mode: VERDICT_MODE_BY_DIFFICULTY.easy,
    gameOverRule: '灯が尽きても、審問の最初から。捜査の記録はそのまま残ります。',
  },
  normal: {
    id: 'normal',
    jp: '審問官',
    en: 'CORONER',
    rule: '穴埋め式・やり直し3回',
    modeJp: '穴埋め式',
    holma: '宣告文の空欄を、所見で埋めていく。……それが審問官の仕事ですよ。',
    lives: LIVES_BY_DIFFICULTY.normal,
    mode: VERDICT_MODE_BY_DIFFICULTY.normal,
    recommended: true,
    gameOverRule: '灯が尽きると、この事件は最初からやり直し。ほかの事件の記録は残ります。',
  },
  hard: {
    id: 'hard',
    jp: '教授',
    en: 'PROFESSOR',
    rule: '自分の言葉で自由記述・やり直し3回',
    modeJp: '自由記述',
    holma: '答えは、すべてあなたの言葉で。ククッ……お手並み拝見といきましょう。',
    lives: LIVES_BY_DIFFICULTY.hard,
    mode: VERDICT_MODE_BY_DIFFICULTY.hard,
    gameOverRule: '灯が尽きると、この事件は最初からやり直し。ほかの事件の記録は残ります。',
  },
};

/** The reward a cleared noise-break round gives in the verdict, per verdict format. */
export const ASSIST_TEXT: Record<VerdictMode, string> = {
  choice: '死因宣告で選択肢が1つ消えます',
  cloze: '死因宣告で空欄が1つ埋まります',
  free: '死因宣告で、答えの要素がひとつ明かされます',
};

/** The difficulty can change only until the inquest has opened (and never after the solve). */
export function canChangeDifficulty(p: CaseProgress | undefined): boolean {
  if (!p) return true;
  if (p.inquest || p.snapshot?.solved) return false;
  return p.stage === 'new' || p.stage === 'intro' || p.stage === 'investigation' || p.stage === 'complete';
}
