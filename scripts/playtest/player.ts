/**
 * The LLM player: turns what a player can SEE (public case intro, its own Q&A log, the cards it
 * holds, hints it asked for, the inquest screen) into a prompt, and the model's JSON back into an
 * action. It never sees traces, probes, truth or any secret field.
 */
import type { AnswerClass } from '../../shared/case-schema.js';
import type { CasePublic, InquestRoundView, PublicFact } from '../../shared/api.js';
import type { Persona } from './personas.js';
import type { AskPart, HintEvent, ShotEvent, VerdictEvent } from './types.js';

export const STAMP: Record<AnswerClass, string> = {
  yes: 'はい',
  no: 'いいえ',
  partial: '一部そう',
  irrelevant: '関係ない',
  cannot: '答えられない',
  vague: '具体的に',
};

export const MAX_QUESTIONS = 40;
export const MAX_HINTS = 3;
/** Q&A turns shown verbatim in the prompt (older ones are summarised to the question + stamp). */
const FULL_LOG_TURNS = 18;

export function systemPrompt(p: Persona): string {
  return [
    'あなたは、ブラウザの推理ゲーム『リトマス審問』を遊んでいる人間のプレイヤーです。',
    '案内役ホルマ（白ウサギの剥製）は、はい／いいえで答えられる質問にだけ、判定スタンプ（はい・いいえ・一部そう・関係ない・答えられない・具体的に）と短い一言で答えます。',
    '目的: 身元不明の女性（ジェーン・ドゥ）が、何が起きて、なぜ死んだのかを推理し、最後に自分の言葉で死因を宣告すること。',
    '質問で新しい事実が分かると「所見」カードが手に入ります。',
    '',
    'ルール:',
    `- 1回の返事で行動は1つ。質問は全部で最大${MAX_QUESTIONS}回。同じ質問はくり返さない。`,
    `- ヒント「ホルマの囁き」は最大${MAX_HINTS}回（使うと評価が少し下がる）。`,
    '- 画面に表示されたこと以外は知らない。ゲームの裏側やデータは見られない。',
    '- 返事は必ず JSON オブジェクト1つだけ（前後に文章を書かない）。',
    '',
    `あなたの人物像（${p.label}）: ${p.brief}`,
  ].join('\n');
}

function factLine(f: PublicFact): string {
  return `・${f.cardTitle ? `【${f.cardTitle}】` : ''}${f.text}`;
}

export interface InvestigationView {
  pub: CasePublic;
  held: PublicFact[];
  asks: AskPart[];
  hints: HintEvent[];
  asked: number;
  hintsUsed: number;
  verdicts: VerdictEvent[];
  labels: Record<string, string>;
  note?: string;
}

export function caseHeader(pub: CasePublic): string {
  return [
    `【事件】${pub.title}（${pub.titleEn}）`,
    pub.summary,
    `場所: ${pub.location}／時刻: ${pub.time}`,
    '',
    '【導入】',
    ...pub.narration,
    ...pub.janeIntro.map((l) => `ジェーン「${l}」`),
    ...pub.holmaIntro.map((l) => `ホルマ「${l}」`),
    '',
    `【質問の例】${pub.starterQuestions.join('／')}`,
  ].join('\n');
}

export function logLines(asks: readonly AskPart[], full = FULL_LOG_TURNS): string[] {
  const turns = [...new Set(asks.map((a) => a.turn))];
  const cut = turns.length > full ? turns[turns.length - full] : -Infinity;
  const out: string[] = [];
  for (const t of turns) {
    const parts = asks.filter((a) => a.turn === t);
    if (t < cut) {
      out.push(`Q${t} ${parts[0].message} → ${parts.map((p) => `【${STAMP[p.answer]}】`).join('')}`);
      continue;
    }
    out.push(`Q${t} あなた: ${parts[0].message}`);
    for (const p of parts) {
      const who = parts.length > 1 ? `（${p.question}）` : '';
      out.push(`   → ${who}【${STAMP[p.answer]}】ホルマ: ${p.line.replace(/\n/g, ' ')}`);
      for (const u of p.unlocked) out.push(`   ★所見入手: ${u.title}`);
    }
  }
  return out;
}

export function investigationPrompt(v: InvestigationView): string {
  const lines = [
    caseHeader(v.pub),
    '',
    '【手元の所見】',
    ...(v.held.length > 0 ? v.held.map(factLine) : ['（まだない）']),
  ];
  if (v.hints.length > 0) {
    lines.push('', '【もらったヒント】');
    for (const h of v.hints) lines.push(`・囁き${h.level}: ${h.text}`);
  }
  lines.push('', '【これまでの質問と答え】');
  lines.push(...(v.asks.length > 0 ? logLines(v.asks) : ['（まだない）']));
  if (v.verdicts.length > 0) {
    lines.push('', '【これまでの死因宣告】');
    for (const x of v.verdicts) lines.push(`・「${x.text}」→ ${verdictLabel(x)}／ホルマ: ${x.lines.join(' ')}`, `  チェック: ${checklist(x, v.labels)}`);
  }
  lines.push(
    '',
    `【状況】質問 ${v.asked}/${MAX_QUESTIONS}、ヒント ${v.hintsUsed}/${MAX_HINTS}`,
    ...(v.note ? [v.note] : []),
    '',
    '次の行動を JSON で返してください:',
    '{"think":"内心のメモ（40字以内・短く）","action":"ask","question":"ホルマへの質問"}',
    'または {"think":"…","action":"hint"}（ヒントをもらう）',
    'または {"think":"…","action":"inquest"}（死因を説明できると思ったら審問を開く）',
  );
  return lines.join('\n');
}

export function verdictLabel(v: VerdictEvent): string {
  return { correct: '正解', almost: 'ほぼ正解', missing: '要素が足りない', wrong: '推理が違う' }[v.result];
}

export function checklist(v: VerdictEvent, labels: Record<string, string>): string {
  return Object.entries(labels).map(([id, l]) => `${l}${v.matched.includes(id) ? '✔' : '？'}`).join(' ');
}

export function debatePrompt(pub: CasePublic, round: InquestRoundView, evidence: PublicFact[], history: ShotEvent[], held: PublicFact[]): string {
  // The UI shows bands, not ids: the player refers to a statement by its number (1-based).
  const statements = round.statements.map((s, i) => {
    const who = s.speaker === 'jane' ? 'ジェーン' : 'ホルマ';
    const text = s.segments.map((g) => (g.noise ? `《${g.text}》` : g.text)).join('');
    return `発言${i + 1}（${who}）「${text}」`;
  });
  const lines = [
    `【審問 反証】${pub.title}`,
    'ジェーンの記憶には誤りが混じっています。発言の中の《誤差》（《》で囲まれた部分）から、所見と矛盾するものを1つ選び、それを打ち消す所見を当てます（正しければ「反応あり」）。',
    `ラウンド: ${round.title}`,
    ...round.intro,
    '',
    '【発言】',
    ...statements,
    '',
    '【当てられる所見】',
    ...evidence.map((f) => `${f.id}: ${f.cardTitle ? `【${f.cardTitle}】` : ''}${f.text}`),
  ];
  if (history.length > 0) {
    lines.push('', '【このラウンドの結果】');
    for (const h of history) {
      if (h.kind === 'grant') lines.push(`・泣きついた → 所見 ${h.granted ?? ''} をもらった。ホルマ: ${h.lines.join(' ')}`);
      else if (h.kind === 'invalid') lines.push(`・発言${h.statement}の《${h.span}》に${h.fact}を当てようとしたが、当てられなかった（${h.error ?? '無効'}）`);
      else lines.push(`・発言${h.statement}の《${h.span}》に${h.fact}を当てた → 反応なし。ホルマ: ${h.lines.join(' ')}${h.hint ? `（ヒント: ${h.hint}）` : ''}`);
    }
  }
  void held;
  lines.push(
    '',
    'JSON で返してください: {"think":"40字以内","statement":発言の番号(数字),"span":"《》の中の文字列そのまま","fact":"所見のID（例 F01）"}',
    'どの所見も当てはまらないと思ったら {"think":"…","action":"grant"}（ホルマに泣きついて所見を1枚もらう。評価が少し下がる）',
  );
  return lines.join('\n');
}

export function verdictPrompt(v: InvestigationView, canInvestigate: boolean): string {
  const lines = [
    caseHeader(v.pub),
    '',
    '【手元の所見】',
    ...v.held.map(factLine),
    '',
    '【これまでの質問と答え】',
    ...logLines(v.asks, 40),
  ];
  if (v.hints.length > 0) lines.push('', '【もらったヒント】', ...v.hints.map((h) => `・囁き${h.level}: ${h.text}`));
  if (v.verdicts.length > 0) {
    lines.push('', '【これまでの死因宣告】');
    for (const x of v.verdicts) lines.push(`・「${x.text}」→ ${verdictLabel(x)}／ホルマ: ${x.lines.join(' ')}`, `  チェック: ${checklist(x, v.labels)}`);
  }
  lines.push(
    '',
    '【死因宣告】ホルマ「彼女に、何が起きたのか。なぜ死んだのか。あなたの言葉で。」',
    `チェック項目: ${Object.values(v.labels).join('・')}`,
    'あなたの人物像らしい言葉で、1〜3文（200字以内）で書いてください。',
    '返事は JSON: {"think":"…","action":"verdict","verdict":"死因宣告の文"}',
  );
  if (canInvestigate) lines.push(`まだ確信がなければ捜査に戻れます（質問 ${v.asked}/${MAX_QUESTIONS}）: {"think":"…","action":"ask","question":"ホルマへの質問"}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface PlayerAction {
  action: 'ask' | 'hint' | 'inquest' | 'verdict' | 'grant' | 'shot';
  think?: string;
  question?: string;
  verdict?: string;
  statement?: string;
  span?: string;
  fact?: string;
}

/** Tolerant JSON extraction: ```json fences, text around the object, trailing commas. */
export function parsePlayerJson(text: string): Record<string, unknown> | undefined {
  const t = (text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  const body = t.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);

export function toAction(o: Record<string, unknown> | undefined): PlayerAction | undefined {
  if (!o) return undefined;
  const think = s(o.think);
  const raw = (s(o.action) ?? '').toLowerCase();
  const stmt = typeof o.statement === 'number' ? String(o.statement) : s(o.statement);
  if (stmt && s(o.fact) && s(o.span) && raw !== 'grant') return { action: 'shot', think, statement: stmt, span: s(o.span), fact: s(o.fact) };
  if (raw === 'grant') return { action: 'grant', think };
  if (raw === 'hint') return { action: 'hint', think };
  if (raw === 'inquest') return { action: 'inquest', think };
  if (raw === 'verdict' || (!raw && s(o.verdict))) return s(o.verdict) ? { action: 'verdict', think, verdict: s(o.verdict) } : undefined;
  if (raw === 'ask' || (!raw && s(o.question))) return s(o.question) ? { action: 'ask', think, question: s(o.question) } : undefined;
  return undefined;
}
