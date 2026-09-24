import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { PublicFact } from '../../shared/api';
import { ANSWER_CLASSES } from '../../shared/case-schema';
import { audio } from '../audio';
import { Button } from '../ui/Button';
import { EvidenceCard } from '../ui/EvidenceCard';
import { HolmaSprite } from '../ui/HolmaSprite';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { ShardPortrait } from '../ui/ShardPortrait';
import { STAMP_META, Stamp } from '../ui/Stamp';
import './overlays.css';

/* Example card for the tutorial only — deliberately generic, not taken from any case. */
const SAMPLE_FACT: PublicFact = {
  id: 'F00',
  text: '部屋のドアは、内側から鍵がかかっていた。',
  category: '場所',
  importance: 2,
  cardTitle: '内側の鍵',
  icon: 'lock',
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
        <span>部屋に、窓はありましたか？</span>
      </div>
      <div class="howto-a">
        <div class="howto-a__holma">
          <HolmaSprite mood="laugh" framing="bust" idle={false} />
        </div>
        <Stamp answerClass="no" size="sm" decorative />
        <p class="howto-a__line">いいえ。窓はひとつもありませんねェ。</p>
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
          <span class="howto-hint__txt">{lv === 1 ? 'まず、場所をよく見なさい' : lv === 2 ? '空気は、目に見えませんよ' : '……ここから先は、ご自分で'}</span>
        </div>
      ))}
    </div>
  );
}

function InquestArt() {
  return (
    <div class="howto-art howto-art--inquest">
      <div class="howto-band">
        <span class="howto-band__who">ジェーン・ドゥ</span>
        <p class="howto-band__text t-jane">
          きっと誰かに<span class="howto-noise">毒を盛られた</span>のよ……
        </p>
      </div>
      <div class="howto-shot">
        <EvidenceCard fact={SAMPLE_FACT} compact />
        <span class="howto-shot__arrow" aria-hidden="true">
          <Icon name="chevronRight" size={28} />
        </span>
        <span class="howto-shot__boom">反証！</span>
      </div>
    </div>
  );
}

function VerdictArt() {
  return (
    <div class="howto-art howto-art--verdict">
      <div class="howto-verdict__input">
        <span class="howto-verdict__label">死因宣告</span>
        <p>換気の止まった部屋で◯◯が起き、彼女は……</p>
      </div>
      <ul class="howto-verdict__list">
        <li class="is-ok">
          <Icon name="check" size={16} /> 直接死因
        </li>
        <li class="is-ok">
          <Icon name="check" size={16} /> 原因となった出来事
        </li>
        <li>
          <span class="howto-verdict__q">?</span> なぜ気づけなかったか
        </li>
      </ul>
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
                        ? '今はまだ答えられない。先に別のことを調べよう。'
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
          大事なことに触れると<strong>所見カード</strong>が手に入り、捜査ノートに綴じられます。所見が増えるたびに、名前のない彼女——
          <strong>ジェーン・ドゥの破片</strong>がひとつずつ灯っていきます。
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
    en: 'INQUEST',
    title: '審問で記憶のノイズを撃ち抜く',
    art: () => <InquestArt />,
    body: (
      <>
        <p>
          審問では、ジェーンが<strong>間違った記憶</strong>を本気で主張します。発言の中で光る<strong>ノイズ</strong>を選び、それを否定できる<strong>所見</strong>で撃ちましょう。
        </p>
        <p class="t-sm t-bone2">外すと集中力が減ります。手持ちの所見が足りないときは「ホルマに泣きつく」ことも。詰むことはありません。</p>
      </>
    ),
  },
  {
    en: 'VERDICT',
    title: '死因を、あなたの言葉で',
    art: () => <VerdictArt />,
    body: (
      <>
        <p>
          最後に<strong>何が起きて、なぜ死んだのか</strong>を自由に書いて宣告します。足りない要素はチェックリストで分かりますが、答えそのものは教えてもらえません。
        </p>
        <p class="t-sm t-bone2">何度でも挑戦できます。通れば真相を漫画のコマで組み直し、彼女の名前が戻ります。</p>
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
];

export function HowToOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (open) setI(0);
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
