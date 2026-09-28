/**
 * Holma's canned line bank + scripted scenes.
 *
 * content/holma-lines.json and content/prologue.json are written by the content builder.
 * They are pulled in with import.meta.glob so the build never breaks if a file is missing;
 * a tiny in-code fallback keeps every key usable. Shape: shared/lines-schema.ts.
 */
import type { HolmaLines, Line, Mood, Script } from '../../shared/lines-schema';
import { shuffle } from './rng';

const lineMods = import.meta.glob('../../content/holma-lines.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const prologueMods = import.meta.glob('../../content/prologue.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/* Fallback: only used when content is missing or a key is absent. Kept deliberately short. */
const FALLBACK = {
  answer: {
    yes: [{ text: 'ええ、その通りですとも。', mood: 'laugh' }],
    no: ['いいえ。残念でしたねェ。'],
    partial: ['一部は、そうですねェ。'],
    irrelevant: ['それは、この死には関係ありませんよ。'],
    cannot: ['今は、お答えできませんねェ。'],
    vague: ['もう少し、具体的にお願いしますよ。'],
  },
  unlock: [{ text: 'おや……所見がひとつ、増えましたねェ。', mood: 'surprised' }],
  unlockCore: [{ text: '……ククッ。核心に、指がかかりましたよ。', mood: 'serious' }],
  nearCore: ['……ほう。近い。近いですねェ。'],
  multi: ['一度にたくさん。順番にお答えしましょう。'],
  meta: {
    askAnswer: ['答えは、あなたの口から聞くものですよ。'],
    askHint: ['囁きが欲しければ、ヒントの札をどうぞ。'],
    offtopic: ['雑談は、死者が眠ってからにしましょう。'],
    aboutHolma: ['私の話など、つまらないものですよ。'],
    rude: ['おやおや。審問官らしくありませんねェ。'],
    empty: ['……何も聞こえませんでしたよ？'],
    tooLong: ['長すぎます。短く、鋭く。'],
    culprit: ['犯人の名は、宣告のときにあなたが口にするもの。証拠のほうから、どうぞ。'],
  },
  error: {
    network: ['……声が届きませんでした。もう一度どうぞ。'],
    degraded: ['少々、耳の調子が。簡易の判定でお答えします。'],
    rateLimited: ['急かさないでくださいよ。少し待ってから。'],
  },
  investigation: {
    idle: ['さァ、次の質問を。'],
    hintIntro: ['仕方ありませんねェ。囁いてあげましょう。'],
    inquestConfirmLow: ['……証拠がずいぶん心許ないようですが？'],
    inquestConfirm: ['よろしい。審問を開きますか？'],
  },
  inquest: {
    open: [{ text: '開廷ですとも！', mood: 'laugh' }],
    roundStart: ['さァ、彼女の記憶を聞きましょう。'],
    wrongShot: ['外れですねェ。'],
    grant: ['仕方ありません。この所見をお貸ししましょう。'],
    composureLow: ['集中が切れかけていますよ？'],
    suspended: ['審問は中断です。捜査に戻りましょう。'],
    verdictPrompt: ['彼女に何が起きたのか。あなたの言葉で。'],
    verdictCorrect: [{ text: '……お見事。', mood: 'serious' }],
    verdictAlmost: ['惜しい。核は合っていますよ。'],
    verdictMissing: ['まだ、何かが足りませんねェ。'],
    verdictWrong: ['いいえ。推理を続けましょう。'],
    reconstructionIntro: ['真相を、組み直しましょう。'],
    reconstructionWrong: ['そのコマは、違いますねェ。'],
    reconstructionDone: ['これで、全部つながりました。'],
  },
  resolution: {
    identity: [{ text: '彼女の名前が、戻りますよ。', mood: 'serious' }],
    farewell: [{ text: '……おやすみなさい。', mood: 'serious' }],
  },
  science: { intro: ['では、科学の解剖を。'], outro: ['覚えて帰ってくださいねェ。'] },
  quiz: { correct: ['正解ですとも。'], wrong: ['おや、もう一度。'], complete: ['記憶、定着ですねェ。'] },
  title: {
    idle: [
      'ようこそ、零番安置室へ。',
      { text: '午前0時。扉は、もう開いていますよ。', mood: 'laugh' },
      '名前のない方が、お待ちかねです。',
      '私は嘘をつけません。訊かれたことにしか、答えませんけどねェ。',
      { text: 'さァ——解剖を始めましょう。', mood: 'laugh' },
    ],
  },
} satisfies Record<string, unknown>;

const FALLBACK_PROLOGUE: Script = {
  id: 'prologue-fallback',
  background: 'art/bg-room-zero.webp',
  lines: [
    { speaker: 'narration', text: '午前0時。どこにもない地下の、どこにもない部屋。', bgm: 'title' },
    { speaker: 'narration', text: '死因の定まらない魂は、名前を失って、ここへ流れ着く。' },
    { speaker: 'holma', mood: 'laugh', text: 'ようこそ、零番安置室へ。新任の審問官どの。', fx: 'shake' },
    { speaker: 'holma', mood: 'normal', text: '私はホルマ。ここの管理人をしております。見ての通り、ただの標本ですがねェ。' },
    { speaker: 'holma', mood: 'normal', text: '掟はひとつ。私は、嘘をつけません。', fx: 'stamp-yes' },
    { speaker: 'holma', mood: 'serious', text: 'そして——訊かれたことにしか、答えません。', fx: 'stamp-no' },
    { speaker: 'jane', text: '……わたし、は……だれ……？' },
    { speaker: 'holma', mood: 'laugh', text: 'さァ——解剖を始めましょう。', fx: 'cutin', bgm: 'investigation' },
  ],
};

function pickModule(mods: Record<string, unknown>): unknown {
  const keys = Object.keys(mods);
  return keys.length ? mods[keys[0]] : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge the loaded bank over the fallback so every key exists. */
function mergeBank(base: unknown, over: unknown): unknown {
  if (Array.isArray(base)) return Array.isArray(over) && over.length ? over : base;
  if (isObj(base)) {
    const out: Record<string, unknown> = { ...base };
    if (isObj(over)) {
      for (const k of Object.keys(over)) out[k] = k in base ? mergeBank(base[k], over[k]) : over[k];
    }
    return out;
  }
  return over ?? base;
}

export const LINES = mergeBank(FALLBACK, pickModule(lineMods)) as HolmaLines;
export const LINES_FROM_CONTENT = Object.keys(lineMods).length > 0;

function validScript(v: unknown): v is Script {
  return isObj(v) && Array.isArray(v.lines) && v.lines.length > 0 && v.lines.every((l) => isObj(l) && typeof l.text === 'string' && typeof l.speaker === 'string');
}
const loadedPrologue = pickModule(prologueMods);
export const PROLOGUE: Script = validScript(loadedPrologue) ? loadedPrologue : FALLBACK_PROLOGUE;
export const PROLOGUE_FROM_CONTENT = validScript(loadedPrologue);

export interface ResolvedLine {
  text: string;
  mood: Mood;
}

export function resolveLine(line: Line | undefined, defaultMood: Mood = 'normal'): ResolvedLine {
  if (!line) return { text: '……', mood: defaultMood };
  if (typeof line === 'string') return { text: line, mood: defaultMood };
  return { text: line.text, mood: line.mood ?? defaultMood };
}

/** Access a bank by dotted path, e.g. 'answer.yes', 'title.idle', 'inquest.open'. */
export function bank(path: string): Line[] {
  let cur: unknown = LINES;
  for (const part of path.split('.')) {
    if (!isObj(cur)) return [];
    cur = cur[part];
  }
  return Array.isArray(cur) ? (cur as Line[]) : [];
}

/* Shuffle-bag per path so lines don't repeat until the bag is exhausted. */
const bags = new Map<string, Line[]>();
const lastPicked = new Map<string, Line>();

export function pickLine(path: string, defaultMood: Mood = 'normal'): ResolvedLine {
  const all = bank(path);
  if (!all.length) return resolveLine(undefined, defaultMood);
  let bag = bags.get(path);
  if (!bag || !bag.length) {
    bag = shuffle(all);
    // avoid the same line twice in a row across bag refills
    if (bag.length > 1 && bag[bag.length - 1] === lastPicked.get(path)) bag.unshift(bag.pop()!);
    bags.set(path, bag);
  }
  const line = bag.pop()!;
  lastPicked.set(path, line);
  return resolveLine(line, defaultMood);
}
