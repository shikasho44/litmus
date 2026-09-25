import type { Difficulty } from '../../../shared/api';
import type { ResolvedLine } from '../../lib/lines';
import { DifficultyBadge } from '../difficulty/Badge';
import { DIFFICULTY_META } from '../difficulty/meta';
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
  difficulty,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  line: ResolvedLine;
  low: boolean;
  progress?: CaseProgress;
  /** The difficulty name (見習い…), shown while it can still change. */
  difficulty?: string;
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
        審問では、集めた所見で彼女の記憶のノイズを撃ち抜けます（撃ち抜くと死因宣告の手がかりに。飛ばして宣告へ進むこともできます）。途中で捜査に戻っても、所見は失われません。
        {difficulty && <> 審問が始まると、難易度（{difficulty}）は変えられなくなります。</>}
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

/**
 * The server could not verify the saved record (token). Nothing is wiped without the player's
 * say: they may retry (a transient 401 recovers) or start over — the old log stays readable in
 * the notebook as 「前回の記録」.
 */
export function TokenTroubleDialog({ open, onRetry, onRestart, onClose }: { open: boolean; onRetry: () => void; onRestart: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={false}
      title="記録を照合できませんでした"
      en="RECORD MISMATCH"
      size="sm"
      tone="alarm"
      class="ivdlg--token"
      footer={
        <div class="ivdlg__foot">
          <Button variant="ghost" sfx="cancel" icon="refresh" onClick={onRetry} data-autofocus>
            もう一度試す
          </Button>
          <Button variant="danger" icon="back" onClick={onRestart}>
            最初からやり直す
          </Button>
        </div>
      }
    >
      <HolmaSays line={{ text: 'おや……帳簿の綴じ紐がほどけてしまったようです。困りましたねェ。', mood: 'surprised' }} />
      <p class="ivdlg__lead">
        この端末に保存された捜査の記録を、確かめられませんでした。通信の乱れなら、<b>もう一度試す</b>で戻れることがあります。
      </p>
      <p class="ivdlg__note">
        <Icon name="info" size={14} />
        やり直す場合も、これまでの質問と所見は「前回の記録」として捜査ノートの質問ログに残ります（読み返し専用）。
      </p>
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
  difficulty,
  canChangeDifficulty,
  onDifficulty,
  onTutorial,
}: {
  open: boolean;
  onClose: () => void;
  onSettings: () => void;
  onHowTo: () => void;
  onReplayIntro: () => void;
  onFiles: () => void;
  onTitle: () => void;
  difficulty: Difficulty;
  canChangeDifficulty: boolean;
  onDifficulty: () => void;
  onTutorial: () => void;
}) {
  const d = DIFFICULTY_META[difficulty];
  return (
    <Modal open={open} onClose={onClose} title="メニュー" en="MENU" size="sm">
      <div class="ivmenu">
        <div class="ivmenu__diff">
          <span class="ivmenu__diff-k">難易度</span>
          <DifficultyBadge difficulty={difficulty} />
          <span class="ivmenu__diff-mode">{d.modeJp}・やり直し{d.lives}回</span>
          <Button variant="quiet" size="sm" icon="refresh" onClick={onDifficulty} disabled={!canChangeDifficulty} data-menu-difficulty>
            変更
          </Button>
          {!canChangeDifficulty && <p class="ivmenu__diff-note">審問が始まったため、この事件の難易度は変えられません。</p>}
        </div>
        <Button variant="ghost" icon="settings" block onClick={onSettings} data-autofocus>
          設定
        </Button>
        <Button variant="ghost" icon="help" block onClick={onHowTo}>
          遊び方
        </Button>
        <Button variant="ghost" icon="play" block onClick={onReplayIntro}>
          事件の導入をもう一度見る
        </Button>
        <Button variant="ghost" icon="info" block onClick={onTutorial} data-menu-tutorial>
          チュートリアルをもう一度
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
