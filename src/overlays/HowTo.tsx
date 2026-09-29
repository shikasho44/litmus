import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { PublicFact } from '../../shared/api';
import { ANSWER_CLASSES } from '../../shared/constants';
import { audio } from '../audio';
import { overlay, route } from '../app/router';
import { LightsRow } from '../features/difficulty/Lights';
import { DIFFICULTY_META } from '../features/difficulty/meta';
import { DetectiveBadge, PenaltyTag } from '../features/rank/Badge';
import { DETECTIVE_LEVELS, DIFFICULTY_MULTIPLIER, SPLUS_BONUS } from '../features/rank/points';
import { replayTutorial } from '../features/tutorial/tutorial';
import { BudgetHowToArt } from '../features/budget/HowToArt';
import { toast } from '../ui/Toast';
import { Button } from '../ui/Button';
import { EvidenceCard } from '../ui/EvidenceCard';
import { HolmaSprite } from '../ui/HolmaSprite';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { ShardPortrait } from '../ui/ShardPortrait';
import { STAMP_META, Stamp } from '../ui/Stamp';
import './overlays.css';

/*
 * Tutorial examples. They must match NO case (not even loosely): no rooms, windows, air,
 * ventilation, locks, cold, sport… A stopped clock and the sea are safe. Re-check this
 * block whenever a case is added.
 */
const SAMPLE_FACT: PublicFact = {
  id: 'F00',
  text: '壁の時計は、十一時四十分で止まっていた。',
  category: '時間',
  importance: 2,
  cardTitle: '止まった時計',
  icon: 'time',
};

interface Step {
  en: string;
  title: string;
  art: () => ComponentChildren;
  body: ComponentChildren;
}

function AskArt() {
  return (
    <div class="howto-art howto-art--ask">
      <div class="howto-q">
        <span class="howto-q__label">審問官</span>
        <span>彼女は、海の近くで亡くなりましたか？</span>
      </div>
      <div class="howto-a">
        <div class="howto-a__holma">
          <HolmaSprite mood="laugh" framing="bust" idle={false} />
        </div>
        <Stamp answerClass="no" size="sm" decorative />
        <p class="howto-a__line">いいえ。海からは、ずいぶん遠い場所ですねェ。</p>
      </div>
    </div>
  );
}

function StampsArt() {
  return (
    <div class="howto-art howto-stamps">
      {ANSWER_CLASSES.map((c) => (
        <div class="howto-stamps__item" key={c}>
          <Stamp answerClass={c} size="xs" decorative tilt={-6} />
        </div>
      ))}
    </div>
  );
}

function FindingArt() {
  const [n, setN] = useState(6);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v >= 26 ? 6 : v + 4)), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <div class="howto-art howto-art--finding">
      <div class="howto-art__card">
        <EvidenceCard fact={SAMPLE_FACT} isNew />
      </div>
      <div class="howto-art__shard">
        <ShardPortrait revealed={n} seed="howto" shardCount={30} label="ジェーン・ドゥの破片（見本）" />
      </div>
    </div>
  );
}

function HintArt() {
  return (
    <div class="howto-art howto-hints">
      {[1, 2, 3].map((lv) => (
        <div class="howto-hint" key={lv} style={{ '--lv': lv }}>
          <Icon name="hint" size={22} />
          <span class="howto-hint__lv">WHISPER {lv}</span>
          <span class="howto-hint__txt">{lv === 1 ? 'まず、時間の順に並べなさい' : lv === 2 ? 'その時計は、何を見ていたのでしょう' : '……ここから先は、ご自分で'}</span>
        </div>
      ))}
    </div>
  );
}

function InquestArt() {
  return (
    <div class="howto-art howto-art--inquest">
      <span class="howto-optional">任意</span>
      <div class="howto-band">
        <span class="howto-band__who">ジェーン・ドゥ</span>
        <p class="howto-band__text t-jane">
          わたしは、<span class="howto-noise">時計の音</span>を聞きながら眠ったの……
        </p>
      </div>
      <div class="howto-shot">
        <EvidenceCard fact={SAMPLE_FACT} compact />
        <span class="howto-shot__arrow" aria-hidden="true">
          <Icon name="chevronRight" size={28} />
        </span>
        <span class="howto-shot__boom">
          <span class="howto-shot__strip" aria-hidden="true" />
          反応あり！
        </span>
      </div>
    </div>
  );
}

function VerdictArt() {
  return (
    <div class="howto-art howto-art--verdict howto-modes">
      <div class="howto-mode howto-mode--easy">
        <span class="howto-mode__name">{DIFFICULTY_META.easy.jp}</span>
        <span class="howto-mode__body">
          <span class="howto-mode__opt is-on">A 選択肢</span>
          <span class="howto-mode__opt">B 選択肢</span>
          <s class="howto-mode__opt is-off">C 選択肢</s>
        </span>
        <LightsRow count={10} label="やり直し10回" />
      </div>
      <div class="howto-mode howto-mode--normal">
        <span class="howto-mode__name">{DIFFICULTY_META.normal.jp}</span>
        <span class="howto-mode__body howto-mode__cloze">
          <span class="howto-mode__blank">◯◯</span>によって<span class="howto-mode__blank">△△</span>が起き……
        </span>
        <LightsRow count={3} label="やり直し3回" />
      </div>
      <div class="howto-mode howto-mode--hard">
        <span class="howto-mode__name">{DIFFICULTY_META.hard.jp}</span>
        <span class="howto-mode__body howto-mode__free">彼女は、◯◯のせいで……</span>
        <LightsRow count={3} label="やり直し3回" />
      </div>
    </div>
  );
}

function ScienceArt() {
  const chain = ['原因', '科学現象', '人体への影響', '結果'];
  return (
    <div class="howto-art howto-chain">
      {chain.map((c, i) => (
        <div class="howto-chain__step" key={c}>
          <span class="howto-chain__n">0{i + 1}</span>
          <span class="howto-chain__t">{c}</span>
          {i < chain.length - 1 && <Icon name="chevronRight" size={20} class="howto-chain__arrow" />}
        </div>
      ))}
    </div>
  );
}

function DegreeArt() {
  return (
    <div class="howto-art howto-degree">
      <ol class="howto-degree__list">
        {DETECTIVE_LEVELS.map((l) => (
          <li key={l.level} class="howto-degree__row">
            <DetectiveBadge level={l.level} size="xs" />
            <span class="howto-degree__name">
              <span class="howto-degree__lv t-mono">LV.{l.level}</span>
              {l.name}
            </span>
            <span class="howto-degree__min t-mono">{l.min}〜</span>
          </li>
        ))}
      </ol>
      <p class="howto-degree__pen">
        <PenaltyTag points={3.5} />
        <span>ミスをすると、その場で減点が見えます</span>
      </p>
    </div>
  );
}

const STEPS: Step[] = [
  {
    en: 'ASK',
    title: 'はい／いいえで訊く',
    art: () => <AskArt />,
    body: (
      <>
        <p>
          画面下の欄に、<strong>「はい」か「いいえ」で答えられる質問</strong>を自由に打ちこみます。ホルマは嘘をつけませんが、
          <strong>訊かれたことにしか答えません</strong>。
        </p>
        <p class="t-sm t-bone2">質問の例のチップを押すと入力欄に入ります。一度に3つまで、まとめて訊くこともできます。</p>
        <p class="t-sm t-bone2">
          「他殺ですか？」「事故ですか？」のように<strong>殺人か事故かを訊いても、ホルマは本当のことを答えます</strong>。
          ただし<strong>「犯人は誰？」「〇〇が毒を入れた？」のように犯人を名指す質問には、捜査中は答えません</strong>（名指しは宣告で、あなたがすること）。誰がいつどこで何をしていたか、<strong>証拠</strong>を訊いて確かめましょう。
        </p>
      </>
    ),
  },
  {
    en: 'VERDICT STAMPS',
    title: '判定スタンプの意味',
    art: () => <StampsArt />,
    body: (
      <ul class="howto-legend">
        {ANSWER_CLASSES.map((c) => (
          <li key={c}>
            <span class="howto-legend__dot" style={{ background: STAMP_META[c].color }} />
            <strong>{STAMP_META[c].jp}</strong>
            <span class="t-sm t-bone2">
              {c === 'yes'
                ? 'その通り。'
                : c === 'no'
                  ? '違う。'
                  : c === 'partial'
                    ? '一部は合っている。言い方を変えて絞りこもう。'
                    : c === 'irrelevant'
                      ? '死因とは関係ない。'
                      : c === 'cannot'
                        ? '答えそのものになる問い（死因そのもの・犯人の名指し も含む）。それは宣告で、あなたが言うこと。'
                        : '質問があいまい。具体的に言い直そう。'}
            </span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    en: 'FINDINGS',
    title: '所見を集める',
    art: () => <FindingArt />,
    body: (
      <>
        <p>
          大事なことに触れると<strong>所見カード</strong>が手に入り、捜査ノートに綴じられます。所見が増えるほど、名前のない彼女——
          <strong>ジェーン・ドゥの破片</strong>が灯っていきます。大事な所見ほど、多くの破片が灯ります。
        </p>
        <p class="t-sm t-bone2">所見に関係する「科学メモ」も解放されます。</p>
      </>
    ),
  },
  {
    en: 'WHISPERS',
    title: '詰まったら、ホルマの囁き',
    art: () => <HintArt />,
    body: (
      <>
        <p>
          ヒントは<strong>3段階</strong>。使うと審問官ランクが少し下がりますが、使ったことを責められはしません。
        </p>
        <p class="t-sm t-bone2">審問はいつでも開けます。所見が少ないうちは、ホルマが念を押してきます。</p>
      </>
    ),
  },
  {
    en: 'LITMUS TEST',
    title: '記憶の誤差に、所見を当てる（任意）',
    art: () => <InquestArt />,
    body: (
      <>
        <p>
          審問では、ジェーンが<strong>間違った記憶</strong>を本気で主張します。発言の中で光る<strong>誤差</strong>を選び、それを否定できる<strong>所見</strong>をリトマス試験紙のように当てます。正しければ色が赤から青へ変わり（<strong>反応あり</strong>）、<strong>死因宣告で使える手がかり</strong>がもらえます（選択肢が消える・空欄が埋まる など）。
        </p>
        <p class="t-sm t-bone2">
          この<strong>反証</strong>は<strong>任意</strong>です。「反証を飛ばして死因宣告へ」で、すぐに宣告へ進めます。<strong>反応なし</strong>だと集中力が減り、所見が足りないときは「ホルマに泣きつく」ことも（ランクに響きます）。反証を全部、自分の所見で成功させてSを取れば、最高ランク S+。
        </p>
      </>
    ),
  },
  {
    en: 'VERDICT',
    title: '死因宣告と、難易度',
    art: () => <VerdictArt />,
    body: (
      <>
        <p>
          最後に<strong>何が起きて、なぜ死んだのか</strong>を宣告します。答え方は事件を始めるときに選ぶ難易度で変わります——<strong>見習い</strong>は選択肢から、<strong>審問官</strong>は文の穴埋め、<strong>教授</strong>は自分の言葉で。
        </p>
        <p class="t-sm t-bone2">
          外すと彼女の<strong>灯</strong>（やり直し）がひとつ消え、尽きるとゲームオーバー。見習いは審問の最初から、審問官・教授は事件の最初からやり直しです。通れば真相を漫画のコマで組み直し、彼女の名前が戻ります。
        </p>
      </>
    ),
  },
  {
    en: 'QUESTIONS',
    title: '質問枠と、ホルマのひとりごと',
    art: () => <BudgetHowToArt />,
    body: (
      <>
        <p>
          質問できる数には、事件と難易度ごとの<strong>質問枠</strong>があります。入力欄の上の札が残りの数です。<strong>見習い</strong>は目安だけ、<strong>審問官</strong>は枠を超えると1問ごとに減点、<strong>教授</strong>は枠を使い切ると質問が締め切られ、審問へ進みます。
        </p>
        <p class="t-sm t-bone2">
          数えるのは「はい」「いいえ」「一部そう」「関係ない」が返った質問だけ。「具体的に」「答えられない」や雑談・遊び方の相談は<strong>ノーカウント</strong>です。行き詰まると、ホルマが<strong>ひとりごと</strong>で方角をこぼすことがあります（減点なし・答えは言いません）。
        </p>
      </>
    ),
  },
  {
    en: 'SCIENCE AUTOPSY',
    title: '科学を持ち帰る',
    art: () => <ScienceArt />,
    body: (
      <>
        <p>
          解決のあとは<strong>科学解剖</strong>。原因から結果までの因果の鎖を図解で確かめ、短い確認テストで記憶に定着させます。
        </p>
        <p class="t-sm t-bone2">この作品はフィクションです。医療上の判断には使わず、困ったときは専門家や救急に相談してください。</p>
      </>
    ),
  },
  {
    en: 'DETECTIVE DEGREE',
    title: '名探偵度数と称号',
    art: () => <DegreeArt />,
    body: (
      <>
        <p>
          事件を解くと、<strong>事件スコア</strong>（100点から、囁き・反応なし・泣きつき・宣告やテストのやり直し・ゲームオーバーの分を引いた点）に難易度の倍率——
          <strong>
            {DIFFICULTY_META.easy.jp}×{DIFFICULTY_MULTIPLIER.easy}・{DIFFICULTY_META.normal.jp}×{DIFFICULTY_MULTIPLIER.normal.toFixed(1)}・{DIFFICULTY_META.hard.jp}×{DIFFICULTY_MULTIPLIER.hard}
          </strong>
          ——を掛けた<strong>度数</strong>がもらえます。S+なら<strong>＋{SPLUS_BONUS}</strong>。
        </p>
        <p class="t-sm t-bone2">
          事件ごとの最高記録を合計したものが<strong>名探偵度数</strong>。同じ事件を遊び直しても、最高記録を超えた分だけ増えます。度数が貯まると称号が上がります。
        </p>
      </>
    ),
  },
];

export function HowToOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    // openOverlay('howto', { page: 'DETECTIVE DEGREE' }) opens on that step (the Files 名探偵度数 meter)
    const page = open ? (overlay.peek()?.props as { page?: unknown } | undefined)?.page : undefined;
    if (open) setI(Math.max(0, STEPS.findIndex((st) => st.en === page)));
  }, [open]);
  const step = STEPS[i];
  const go = (n: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, n));
    if (next !== i) audio.sfx('page');
    setI(next);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, i]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="遊び方"
      en="HOW TO PLAY"
      size="xl"
      footer={
        <div class="howto-nav">
          <div class="howto-dots" role="tablist" aria-label="ページ">
            {STEPS.map((s, k) => (
              <button
                key={s.en}
                type="button"
                role="tab"
                aria-selected={k === i}
                aria-label={`${k + 1}. ${s.title}`}
                class={`howto-dot ${k === i ? 'is-on' : ''}`}
                onClick={() => go(k)}
              />
            ))}
          </div>
          <span class="howto-count t-mono">
            {String(i + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
          </span>
          <div class="spacer" />
          <Button
            variant="quiet"
            size="sm"
            icon="info"
            sfx="page"
            class="howto-tutorial"
            data-howto-tutorial
            onClick={() => {
              replayTutorial();
              onClose();
              const inCase = route.peek().scene === 'investigation' || route.peek().scene === 'inquest';
              toast(inCase ? 'チュートリアルを始めます' : '次に事件を開くと、チュートリアルが始まります', { icon: 'info' });
            }}
          >
            チュートリアル
          </Button>
          <Button variant="ghost" size="sm" icon="chevronLeft" sfx={false} disabled={i === 0} onClick={() => go(i - 1)}>
            前へ
          </Button>
          {i < STEPS.length - 1 ? (
            <Button size="sm" iconRight="chevronRight" sfx={false} onClick={() => go(i + 1)} data-autofocus>
              次へ
            </Button>
          ) : (
            <Button size="sm" icon="check" onClick={onClose}>
              はじめる
            </Button>
          )}
        </div>
      }
    >
      <div class="howto" key={i}>
        <div class="howto__art" aria-hidden="true">
          {step.art()}
        </div>
        <div class="howto__text">
          <p class="howto__step">
            <span class="howto__num">STEP {String(i + 1).padStart(2, '0')}</span>
            <span class="howto__en">{step.en}</span>
          </p>
          <h3 class="howto__title">{step.title}</h3>
          <div class="howto__body">{step.body}</div>
        </div>
      </div>
    </Modal>
  );
}
