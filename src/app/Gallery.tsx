/**
 * Dev-only UI gallery (window.__JD.gallery()). A living catalogue of the UI kit so scene
 * builders can see every component and state in one place. Not part of the game.
 */
import { useState } from 'preact/hooks';
import type { PublicFact } from '../../shared/api';
import { ANSWER_CLASSES } from '../../shared/case-schema';
import { audio } from '../audio';
import { fx } from '../fx';
import { Button, CutIn, DialogueBox, EvidenceCard, HolmaSprite, HolmaVector, IconButton, Panel, ShardPortrait, Stamp, TabPanel, Tabs, toast } from '../ui';
import './gallery.css';

const FACTS: PublicFact[] = [
  { id: 'F01', text: '部屋の換気扇は、深夜0時に自動で止まる設定だった。', category: '環境', importance: 1, cardTitle: '止まった換気' },
  { id: 'F02', text: '床には、白い霜のような跡が残っていた。', category: '証拠', importance: 2, cardTitle: '床の霜' },
  { id: 'F03', text: '壁の計器は電池が切れていて、警報が鳴らなかった。', category: '物品', importance: 3, cardTitle: '沈黙した計器' },
];

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="gal__sec">
      <h3 class="gal__h">{title}</h3>
      {children}
    </section>
  );
}

function GalleryBody() {
  const [tab, setTab] = useState('a');
  const [sel, setSel] = useState('F02');
  const [shards, setShards] = useState(8);
  const [solved, setSolved] = useState(false);
  const [cut, setCut] = useState(0);
  return (
    <div class="gal">
      <Section title="Buttons">
        <div class="gal__row">
          <Button>primary</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="danger" icon="trash">
            danger
          </Button>
          <Button variant="quiet">quiet</Button>
          <Button size="sm" icon="send">
            sm
          </Button>
        </div>
        <div class="gal__row">
          <Button variant="big-cta" en="OPEN INQUEST" iconRight="gavel">
            審問を開く
          </Button>
        </div>
        <div class="gal__row">
          <IconButton icon="notebook" label="捜査ノート" badge={3} />
          <IconButton icon="hint" label="ヒント" variant="solid" />
          <IconButton icon="soundOn" label="音" pressed />
          <IconButton icon="settings" label="設定" size="sm" />
        </div>
      </Section>
      <Section title="Stamps (answer classes)">
        <div class="gal__row gal__row--stamps">
          {ANSWER_CLASSES.map((c) => (
            <Stamp key={c} answerClass={c} size="sm" />
          ))}
        </div>
        <div class="gal__row">
          {ANSWER_CLASSES.map((c) => (
            <Button key={c} size="sm" variant="ghost" sfx={false} onClick={() => fx.stamp(c)}>
              fx.stamp('{c}')
            </Button>
          ))}
        </div>
      </Section>
      <Section title="Evidence cards">
        <div class="gal__cards">
          {FACTS.map((f, i) => (
            <EvidenceCard key={f.id} fact={f} index={i} isNew={i === 2} selected={sel === f.id} onSelect={() => setSel(f.id)} />
          ))}
        </div>
        <div class="gal__cards gal__cards--compact">
          {FACTS.map((f) => (
            <EvidenceCard key={f.id} fact={f} compact />
          ))}
        </div>
      </Section>
      <Section title="Shard portrait">
        <div class="gal__row">
          <div class="gal__shard">
            <ShardPortrait image="cases/c01/portrait.webp" revealed={shards} solved={solved} seed="c01" onAssembled={() => toast('assembled', { tone: 'success' })} />
          </div>
          <div class="gal__col">
            <Button size="sm" sfx={false} onClick={() => (setShards((n) => n + 3), audio.sfx('finding'))}>
              +3 shards ({shards})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSolved((v) => !v)}>
              {solved ? 'reset' : 'solve'}
            </Button>
          </div>
        </div>
      </Section>
      <Section title="Dialogue">
        <div class="gal__col">
          <DialogueBox speaker="holma" text="さァ——解剖を始めましょう。" keyboard={false} />
          <DialogueBox speaker="jane" text="……わたしの、なまえを。見つけて、くれるの。" glitch keyboard={false} />
          <DialogueBox speaker="narration" text="午前0時。どこにもない地下の、どこにもない部屋。" keyboard={false} />
        </div>
      </Section>
      <Section title="Panel + Tabs">
        <Panel title="捜査ノート" en="NOTEBOOK" tag="No.012">
          <Tabs
            group="gal"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'a', label: '所見', icon: 'evidence', badge: 3 },
              { id: 'b', label: '質問ログ', icon: 'log' },
              { id: 'c', label: '科学メモ', icon: 'science' },
            ]}
          />
          <TabPanel group="gal" id="a" value={tab}>
            <p class="t-sm" style={{ padding: '12px 0' }}>
              所見の一覧（タブ A）
            </p>
          </TabPanel>
          <TabPanel group="gal" id="b" value={tab}>
            <p class="t-sm" style={{ padding: '12px 0' }}>
              質問ログ（タブ B）
            </p>
          </TabPanel>
          <TabPanel group="gal" id="c" value={tab}>
            <p class="t-sm" style={{ padding: '12px 0' }}>
              科学メモ（タブ C）
            </p>
          </TabPanel>
        </Panel>
      </Section>
      <Section title="Holma moods">
        <div class="gal__row">
          {(['normal', 'laugh', 'surprised', 'serious'] as const).map((m) => (
            <div key={m} class="gal__holma">
              <HolmaSprite mood={m} framing="bust" />
              <span class="t-mono t-2xs">{m}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Holma vector fallback (shown when art is missing)">
        <div class="gal__row">
          {(['normal', 'laugh', 'surprised', 'serious'] as const).map((m) => (
            <div key={m} class="gal__holma gal__holma--vector">
              <HolmaVector mood={m} />
              <span class="t-mono t-2xs">{m}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="FX">
        <div class="gal__row">
          <Button size="sm" variant="ghost" onClick={() => fx.cutIn({ text: '所見入手', en: 'NEW FINDING', tone: 'formalin' })}>
            cutIn formalin
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fx.cutIn({ text: '反証！', en: 'REFUTATION', tone: 'alarm', character: 'holma', mood: 'laugh' })}>
            cutIn alarm + holma
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fx.shatter()}>
            shatter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fx.shake(1.2)}>
            shake
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fx.flash()}>
            flash
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fx.pulse('alarm')}>
            pulse
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fx.speedLines(800)}>
            speedLines
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toast('所見を入手しました', { tone: 'finding' })}>
            toast
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCut((c) => c + 1)}>
            inline CutIn
          </Button>
        </div>
        {cut > 0 && (
          <div class="gal__cutin">
            <CutIn key={cut} text="開廷ですとも！" en="COURT IS IN SESSION" tone="alarm" />
          </div>
        )}
      </Section>
    </div>
  );
}

export function renderGallery() {
  return <GalleryBody />;
}
