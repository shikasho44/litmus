import { APP_CONFIG } from '../config/app';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import './overlays.css';

const ROWS: { role: string; en: string; names: string[] }[] = [
  { role: '企画・制作', en: 'PRODUCTION', names: ['fourthplace43'] },
  { role: '判定エンジン', en: 'JUDGEMENT', names: ['TypeSafe Jev（OpenRouter 経由）', '予備判定：本作オリジナルのルールエンジン'] },
  { role: '音楽・効果音', en: 'MUSIC & SOUND', names: ['WebAudio によるリアルタイム合成（本作オリジナル）'] },
  { role: 'イラスト', en: 'ILLUSTRATION', names: ['AI 画像生成をもとに制作'] },
  {
    role: 'フォント',
    en: 'TYPEFACES',
    names: ['Dela Gothic One', 'Zen Kaku Gothic New', 'Shippori Mincho B1', 'Anton', 'JetBrains Mono', '— いずれも SIL Open Font License 1.1'],
  },
  { role: 'ソフトウェア', en: 'SOFTWARE', names: ['Preact / @preact/signals（MIT）', 'GSAP（GreenSock Standard License）', 'zod（MIT）', 'Vite（MIT）'] },
];

export function CreditsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="クレジット"
      en="CREDITS"
      size="md"
      footer={
        <Button onClick={onClose} sfx="close" data-autofocus>
          閉じる
        </Button>
      }
    >
      <div class="credits">
        <div class="credits__title">
          <span class="credits__game">{APP_CONFIG.GAME_TITLE}</span>
          <span class="credits__sub">{APP_CONFIG.SUBTITLE}</span>
        </div>
        <dl class="credits__list">
          {ROWS.map((r) => (
            <div class="credits__row" key={r.en}>
              <dt>
                <span class="credits__en">{r.en}</span>
                <span class="credits__role">{r.role}</span>
              </dt>
              <dd>
                {r.names.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p class="credits__note">
          本作に登場する事件・人物・団体・場所はすべて架空のものです。作中の科学解説は理解を助けるための一般的な説明であり、医療上の助言ではありません。
        </p>
        <p class="credits__dedication t-jane">——そして、名前を取り戻すあなたへ。</p>
        <p class="credits__copy t-mono">{APP_CONFIG.COPYRIGHT_NOTICE}</p>
      </div>
    </Modal>
  );
}
