import { useState } from 'preact/hooks';
import type { PipelineMode } from '../../shared/api';
import { audio } from '../audio';
import { DEBUG } from '../lib/env';
import { resetAll, settings, storageOk, updateSettings } from '../state/save';
import type { FontScale, TextSpeed } from '../state/types';
import { Button } from '../ui/Button';
import { Segmented, Slider, Switch } from '../ui/Controls';
import { DialogueBox } from '../ui/DialogueBox';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { route } from '../app/router';
import { replayTutorial } from '../features/tutorial/tutorial';
import './overlays.css';

const SAMPLE = 'さァ——解剖を始めましょう。訊かれたことには、正直に答えますとも。';

export function SettingsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = settings.value;
  const [confirm, setConfirm] = useState(false);
  const [sampleKey, setSampleKey] = useState(0);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="設定"
        en="SETTINGS"
        size="lg"
        footer={
          <Button onClick={onClose} sfx="close">
            閉じる
          </Button>
        }
      >
        <div class="settings">
          <section class="settings__group" aria-labelledby="set-sound">
            <h3 class="settings__h" id="set-sound">
              <span class="settings__en">SOUND</span>音
            </h3>
            <Switch label="すべての音を消す" checked={s.muted} onChange={(v) => updateSettings({ muted: v })} autofocus />
            <Slider label="BGM" value={s.bgmVolume} disabled={s.muted} onChange={(v) => updateSettings({ bgmVolume: v })} />
            <Slider
              label="効果音"
              value={s.sfxVolume}
              disabled={s.muted}
              onChange={(v) => {
                updateSettings({ sfxVolume: v });
              }}
            />
            <Switch label="文字送りの声" description="セリフが表示されるときの小さな音です。" checked={s.voiceBlips} onChange={(v) => updateSettings({ voiceBlips: v })} />
            <div class="settings__test">
              <Button size="sm" variant="ghost" icon="soundOn" sfx={false} onClick={() => audio.sfx('stamp', { answerClass: 'yes' })}>
                効果音を試す
              </Button>
              {!audio.unlocked && <span class="t-xs t-muted">※ 画面を一度クリック（タップ）すると音が出るようになります。</span>}
            </div>
          </section>

          <section class="settings__group" aria-labelledby="set-view">
            <h3 class="settings__h" id="set-view">
              <span class="settings__en">DISPLAY</span>表示
            </h3>
            <Segmented<FontScale>
              label="文字の大きさ"
              value={s.fontScale}
              onChange={(v) => updateSettings({ fontScale: v })}
              options={[
                { value: 100, label: '標準', sub: '100%' },
                { value: 115, label: '大', sub: '115%' },
                { value: 130, label: '特大', sub: '130%' },
              ]}
            />
            <Segmented<TextSpeed>
              label="文字送りの速さ"
              value={s.textSpeed}
              onChange={(v) => {
                updateSettings({ textSpeed: v });
                setSampleKey((k) => k + 1);
              }}
              options={[
                { value: 'slow', label: 'ゆっくり' },
                { value: 'normal', label: 'ふつう' },
                { value: 'fast', label: 'はやい' },
                { value: 'instant', label: '瞬間' },
              ]}
            />
            <div class="settings__preview" aria-label="表示の見本">
              <DialogueBox speaker="holma" text={SAMPLE} lineKey={sampleKey} keyboard={false} showNext={false} onAdvance={() => setSampleKey((k) => k + 1)} />
            </div>
            <Switch
              label="演出を控えめに"
              description="画面の揺れ・フラッシュ・グリッチを止め、動きを最小限にします。"
              checked={s.reduceMotion}
              onChange={(v) => updateSettings({ reduceMotion: v })}
            />
          </section>

          <section class="settings__group" aria-labelledby="set-tutorial">
            <h3 class="settings__h" id="set-tutorial">
              <span class="settings__en">TUTORIAL</span>チュートリアル
            </h3>
            <p class="settings__note">捜査と審問の画面で、ホルマが操作をひとつずつ案内します。いつでもスキップできます。</p>
            <div>
              <Button
                variant="ghost"
                size="sm"
                icon="info"
                data-settings-tutorial
                onClick={() => {
                  replayTutorial();
                  onClose();
                  const inCase = route.peek().scene === 'investigation' || route.peek().scene === 'inquest';
                  toast(inCase ? 'チュートリアルを始めます' : '次に事件を開くと、チュートリアルが始まります', { icon: 'info' });
                }}
              >
                チュートリアルをもう一度
              </Button>
            </div>
          </section>

          <section class="settings__group" aria-labelledby="set-data">
            <h3 class="settings__h" id="set-data">
              <span class="settings__en">DATA</span>記録
            </h3>
            <p class="settings__note">
              進み具合はこの端末のブラウザ（localStorage）に自動で保存されます。アカウントはありません。
              {!storageOk.value && <strong class="t-alarm"> 現在この環境では保存できません（プライベートモード等）。</strong>}
            </p>
            <div>
              <Button variant="danger" size="sm" icon="trash" sfx="cancel" onClick={() => setConfirm(true)}>
                記録をすべて消去
              </Button>
            </div>
          </section>

          {DEBUG && (
            <section class="settings__group settings__group--dev" aria-labelledby="set-dev">
              <h3 class="settings__h" id="set-dev">
                <span class="settings__en">DEVELOPER</span>開発用
              </h3>
              <Segmented<PipelineMode | 'default'>
                label="判定パイプライン"
                description="開発時のみ。サーバーの既定値を上書きします。"
                value={s.pipelineMode ?? 'default'}
                onChange={(v) => updateSettings({ pipelineMode: v === 'default' ? null : v })}
                options={[
                  { value: 'default', label: '既定' },
                  { value: 'rules', label: 'rules' },
                  { value: 'jev', label: 'jev' },
                  { value: 'jev+llm', label: 'jev+llm' },
                  { value: 'jev+llm+check', label: '+check' },
                  { value: 'llm', label: 'llm' },
                ]}
              />
            </section>
          )}
        </div>
      </Modal>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="記録を消去しますか？"
        en="ERASE RECORDS"
        size="sm"
        tone="alarm"
        footer={
          <>
            <Button variant="ghost" sfx="cancel" onClick={() => setConfirm(false)} data-autofocus>
              やめる
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                resetAll();
                setConfirm(false);
                toast('記録を消去しました', { tone: 'warn' });
              }}
            >
              消去する
            </Button>
          </>
        }
      >
        <p class="t-sm">すべての事件の進み具合・ランク・プロローグの既読が消えます。設定は残ります。この操作は取り消せません。</p>
      </Modal>
    </>
  );
}
