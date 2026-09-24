import { Icon } from '../../ui/Icon';

export const SUPPORT_URL = 'https://www.mhlw.go.jp/mamorouyokokoro/';

/**
 * Calm support card shown when a question touched self-harm (AskAnswer.notice === 'support').
 * No jokes, no stamp, no game styling beyond the frame.
 */
export function SupportCard() {
  return (
    <aside class="support" aria-label="相談窓口のご案内">
      <div class="support__head">
        <Icon name="heart" size={18} />
        <span>ここで、少しだけ手を止めます</span>
      </div>
      <p class="support__text">
        もし今、つらい気持ちを抱えているなら、ひとりで抱えこまずに、誰かに話してみてください。電話やSNSで、匿名で相談できる窓口があります。
      </p>
      <a class="support__link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
        <span>相談窓口のご案内</span>
        <span class="support__src">厚生労働省「まもろうよ こころ」</span>
        <Icon name="external" size={16} />
      </a>
      <p class="support__note">ゲームはいつでも中断できます。進み具合は保存されています。</p>
    </aside>
  );
}
