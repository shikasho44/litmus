import type { ResolvedLine } from '../../lib/lines';
import type { CaseProgress } from '../../state/types';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';

function HolmaSays({ line }: { line: ResolvedLine }) {
  return (
    <div class="ivdlg__holma">
      <div class="ivdlg__sprite" aria-hidden="true">
        <HolmaSprite mood={line.mood} framing="bust" idle={false} />
      </div>
      <div class="ivdlg__bubble">
        <span class="ivdlg__name">ホルマ</span>
        <p>{line.text}</p>
      </div>
    </div>
  );
}

export function InquestConfirm({
  open,
  onClose,
  onConfirm,
  line,
  low,
  progress,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  line: ResolvedLine;
  low: boolean;
  progress?: CaseProgress;
}) {
  const facts = progress ? progress.factOrder.map((id) => progress.facts[id]).filter(Boolean) : [];
  const key = facts.filter((f) => f.importance >= 2).length;
  const core = facts.filter((f) => f.importance >= 3).length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="審問を開きますか？"
      en="OPEN THE INQUEST"
      size="sm"
      tone="alarm"
      footer={
        <div class="ivdlg__foot">
          <Button variant="ghost" sfx="cancel" onClick={onClose} data-autofocus>
            まだ捜査する
          </Button>
          <Button variant="danger" icon="gavel" onClick={onConfirm} en="INQUEST">
            開廷する
          </Button>
        </div>
      }
    >
      <HolmaSays line={line} />
      <dl class={`ivdlg__stats ${low ? 'is-low' : ''}`}>
        <div>
          <dt>所見</dt>
          <dd>{facts.length}</dd>
        </div>
        <div>
          <dt>重要</dt>
          <dd>{key}</dd>
        </div>
        <div>
          <dt>核心</dt>
          <dd>{core}</dd>
        </div>
      </dl>
      <p class="ivdlg__note">
        審問では、集めた所見を使って彼女の記憶のノイズを撃ち抜きます。途中で捜査に戻っても、所見は失われません。
      </p>
    </Modal>
  );
}

export function HintConfirm({
  open,
  onClose,
  onConfirm,
  used,
  total,
  hints,
  onReread,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  used: number;
  total: number;
  hints: { level: number; text: string }[];
  onReread: (level: number) => void;
  busy: boolean;
}) {
  const left = Math.max(0, total - used);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ホルマの囁き"
      en="WHISPER"
      size="sm"
      tone="formalin"
      class="ivdlg--hint"
      footer={
        <div class="ivdlg__foot">
          <Button variant="ghost" sfx="cancel" onClick={onClose} data-autofocus={left === 0 ? true : undefined}>
            {left > 0 ? 'やめておく' : '閉じる'}
          </Button>
          {left > 0 && (
            <Button icon="whisper" onClick={onConfirm} disabled={busy} data-autofocus>
              囁きを聞く（{used + 1}/{total}）
            </Button>
          )}
        </div>
      }
    >
      {left > 0 ? (
        <>
          <p class="ivdlg__lead">
            答えではなく、<b>進む方角だけ</b>をそっと教えてもらえます。囁きは全部で{total}つ、あとになるほど具体的です。
          </p>
          <p class="ivdlg__note">
            <Icon name="info" size={14} />
            使った回数は記録され、審問官ランクに少しだけ響きます。
          </p>
        </>
      ) : (
        <p class="ivdlg__lead">囁きは、もう残っていません。これまでの囁きを読み返せます。</p>
      )}
      {hints.length > 0 && (
        <div class="ivdlg__hints">
          <p class="ivdlg__hints-label t-mono">これまでの囁き</p>
          {hints.map((h) => (
            <button type="button" key={h.level} class="ivdlg__hint" onClick={() => onReread(h.level)}>
              <span class="ivdlg__hint-lv t-mono">LV.{h.level}</span>
              <span class="ivdlg__hint-text">{h.text}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function MenuDialog({
  open,
  onClose,
  onSettings,
  onHowTo,
  onReplayIntro,
  onFiles,
  onTitle,
}: {
  open: boolean;
  onClose: () => void;
  onSettings: () => void;
  onHowTo: () => void;
  onReplayIntro: () => void;
  onFiles: () => void;
  onTitle: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="メニュー" en="MENU" size="sm">
      <div class="ivmenu">
        <Button variant="ghost" icon="settings" block onClick={onSettings} data-autofocus>
          設定
        </Button>
        <Button variant="ghost" icon="help" block onClick={onHowTo}>
          遊び方
        </Button>
        <Button variant="ghost" icon="play" block onClick={onReplayIntro}>
          事件の導入をもう一度見る
        </Button>
        <Button variant="ghost" icon="tag" block onClick={onFiles}>
          事件ファイルへ戻る
        </Button>
        <Button variant="quiet" icon="back" block sfx="cancel" onClick={onTitle}>
          タイトルへ
        </Button>
        <p class="ivmenu__note">進み具合は自動で保存されます。いつでも続きから再開できます。</p>
      </div>
    </Modal>
  );
}
