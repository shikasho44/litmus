/**
 * 身元回復 IDENTITY RESTORED (design bible §3-3) — the emotional climax.
 *
 *   ceremony: Holma (serious) closes the case → the shards gather into one portrait
 *             (monochrome → full colour) → 「ジェーン・ドゥ #0N」 decodes into her name →
 *             her farewell, now clear and warm → Holma sends her off.
 *   record:   the restored identity, cause of death, 「事件の全貌」 (summary + timeline),
 *             「所見の記録」 (found / proven at the inquest / missed) → 科学解剖へ.
 *
 * Entering sets stage 'resolution'; once the ceremony has played (resolutionSeen) or the science
 * part was reached, revisiting / reloading opens the record.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PublicFact, SolutionResponse, CaseSummary } from '../../../shared/api';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { useImage } from '../../lib/asset';
import { layout } from '../../lib/viewport';
import { pickLine, type ResolvedLine } from '../../lib/lines';
import { Button, IconButton } from '../../ui/Button';
import { DialogueBox } from '../../ui/DialogueBox';
import { factTitle } from '../../ui/EvidenceCard';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import { resolveIcon } from '../../ui/icons';
import { Tabs, TabPanel } from '../../ui/Panel';
import { ShardPortrait } from '../../ui/ShardPortrait';
import { EndingError, EndingLoading } from './common';
import { NamePlate, type NamePhase } from './NamePlate';
import { advanceStage, caseNumber, pad2, stageAtLeast, useSolution } from './solution';
import { getCaseProgress, updateCase } from '../../state/save';
import './resolution.css';

const SHARDS = 34;

export function ResolutionScene({ params }: SceneProps) {
  const caseId = params.caseId!;
  const [state, retry] = useSolution(caseId);

  useEffect(() => {
    if (state.status === 'ok') advanceStage(caseId, 'resolution');
  }, [state.status, caseId]);

  if (state.status === 'loading') return <EndingLoading label="破片を集めています" />;
  if (state.status === 'error') return <EndingError caseId={caseId} reason={state.reason} onRetry={retry} />;
  return <Resolution caseId={caseId} sol={state.sol} summary={state.summary} replay={params.replay === '1'} />;
}

type Beat = { kind: 'line'; speaker: 'holma' | 'jane'; text: string; mood?: ResolvedLine['mood'] } | { kind: 'assemble' };

function buildBeats(sol: SolutionResponse): Beat[] {
  const beats: Beat[] = [];
  for (const t of sol.holmaSolved.slice(0, 3)) beats.push({ kind: 'line', speaker: 'holma', text: t, mood: 'serious' });
  beats.push({ kind: 'line', speaker: 'holma', text: pickLine('resolution.identity', 'serious').text, mood: 'serious' });
  beats.push({ kind: 'assemble' });
  for (const t of sol.victim.farewell) beats.push({ kind: 'line', speaker: 'jane', text: t });
  beats.push({ kind: 'line', speaker: 'holma', text: pickLine('resolution.farewell', 'serious').text, mood: 'serious' });
  return beats;
}

function Resolution({ caseId, sol, summary, replay }: { caseId: string; sol: SolutionResponse; summary: CaseSummary | null; replay: boolean }) {
  // The ceremony plays once per run; a reload (or a later visit) opens the record page.
  const [phase, setPhase] = useState<'ceremony' | 'record'>(() => (!replay && (stageAtLeast(caseId, 'science') || !!getCaseProgress(caseId)?.resolutionSeen) ? 'record' : 'ceremony'));
  const [run, setRun] = useState(0);
  const bg = useImage(summary?.background ?? `cases/c${pad2(caseNumber(caseId, summary))}/bg.webp`);
  const num = caseNumber(caseId, summary);

  useEffect(() => {
    fx.setBackdrop(phase === 'record' ? 'amber' : 'truth');
  }, [phase]);

  return (
    <section class={`scene res res--${phase}`} style={summary?.accent ? { '--case-accent': summary.accent } : undefined}>
      <div class="res__bg" aria-hidden="true">
        {bg && <img src={bg} alt="" />}
        <div class="res__cold" />
        <div class="res__warm" />
        <div class="res__rays" />
      </div>
      {phase === 'ceremony' ? (
        <Ceremony
          key={run}
          caseId={caseId}
          sol={sol}
          num={num}
          onDone={() => {
            advanceStage(caseId, 'resolution');
            updateCase(caseId, { resolutionSeen: true });
            setPhase('record');
          }}
        />
      ) : (
        <Record
          caseId={caseId}
          sol={sol}
          summary={summary}
          num={num}
          onReplay={() => {
            setRun((r) => r + 1);
            setPhase('ceremony');
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ceremony                                                            */
/* ------------------------------------------------------------------ */

function Ceremony({ caseId, sol, num, onDone }: { caseId: string; sol: SolutionResponse; num: number; onDone: () => void }) {
  const beats = useMemo(() => buildBeats(sol), [sol]);
  const [step, setStep] = useState(0);
  const [solved, setSolved] = useState(false);
  const [name, setName] = useState<NamePhase>('codename');
  const [warm, setWarm] = useState(false);
  const beat = beats[Math.min(step, beats.length - 1)];
  const v = sol.victim;
  const meta = [`${v.age}歳`, v.occupation];
  const janeSpeaking = beat.kind === 'line' && beat.speaker === 'jane';
  const holmaVisible = beat.kind === 'line' && beat.speaker === 'holma';

  const next = () => {
    if (step + 1 >= beats.length) onDone();
    else setStep(step + 1);
  };

  // assemble beat: shards gather → colour → name decodes → continue
  useEffect(() => {
    if (beat.kind !== 'assemble') return;
    audio.sfx('heartbeat');
    const t = setTimeout(() => setSolved(true), motionReduced() ? 100 : 650);
    return () => clearTimeout(t);
  }, [beat.kind]);

  const onAssembled = () => {
    fx.flash('#FFF4DC', { opacity: 0.5, duration: 1.1 });
    audio.sfx('shatter');
    setWarm(true);
    fx.setBackdrop('amber');
    setTimeout(() => setName('resolving'), motionReduced() ? 50 : 500);
  };

  const skip = () => {
    audio.sfx('page');
    onDone();
  };

  return (
    <div class={`res-cer ${warm ? 'is-warm' : ''} ${janeSpeaking ? 'is-jane' : ''} ${name !== 'codename' ? 'is-named' : ''} ${beat.kind === 'assemble' ? 'is-assembling' : ''}`}>
      <header class="res-cer__top">
        <p class="eyebrow">
          CASE {pad2(num)}
          <span class="only-wide">&nbsp;— {warm ? 'IDENTITY RESTORED' : 'IDENTIFICATION'}</span>
        </p>
        <span class="spacer" />
        <Button variant="quiet" size="sm" iconRight="skip" sfx={false} onClick={skip} class="res-cer__skip">
          スキップ
        </Button>
      </header>

      <div class="res-cer__stage">
        <div class={`res-cer__portrait ${warm ? 'is-warm' : ''} ${janeSpeaking ? 'is-speaking' : ''}`}>
          <span class="res-cer__halo" aria-hidden="true" />
          <ShardPortrait image={v.portrait} shardCount={SHARDS} revealed={SHARDS} solved={solved} onAssembled={onAssembled} seed={caseId} glow={!warm} label={warm ? `${v.name}の肖像` : `${v.codename}の破片`} />
        </div>
        <NamePlate
          codename={v.codename}
          name={v.name}
          kana={v.nameKana}
          meta={meta}
          phase={name}
          seed={caseId}
          onResolved={() => {
            setName('clear');
            next();
          }}
        />
      </div>

      {/* Holma stands behind the right end of the dialogue box (bust, like the intro), dimmed so Jane stays the focus */}
      <div class={`res-cer__holma ${holmaVisible ? 'is-on' : ''}`} aria-hidden="true">
        <HolmaSprite mood="serious" framing="bust" faceX={0.52} talking={holmaVisible} />
      </div>

      <div class="res-cer__dock">
        {beat.kind === 'line' ? (
          <DialogueBox
            key={step}
            lineKey={step}
            speaker={beat.speaker}
            name={beat.speaker === 'jane' ? v.name : undefined}
            text={beat.text}
            onAdvance={next}
            class={beat.speaker === 'jane' ? 'dlg--restored' : ''}
            size={layout.value === 'narrow' ? 'md' : 'lg'}
          />
        ) : (
          <p class="res-cer__hush" aria-live="polite">
            <span key={name === 'codename' ? 'a' : 'b'}>{name === 'codename' ? '破片が、ひとつに' : '名前が、戻ってくる'}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Record                                                              */
/* ------------------------------------------------------------------ */

function Record({ caseId, sol, summary, num, onReplay }: { caseId: string; sol: SolutionResponse; summary: CaseSummary | null; num: number; onReplay: () => void }) {
  const v = sol.victim;
  const portrait = useImage(v.portrait);
  const heading = useRef<HTMLHeadingElement>(null);
  const lead = useMemo(() => pickLine('science.intro'), []);
  const last = v.farewell[v.farewell.length - 1] ?? '';

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const toScience = () => {
    advanceStage(caseId, 'science');
    goto('science', { caseId });
  };

  return (
    <div class="page res-rec">
      <div class="page__inner res-rec__inner">
        <nav class="res-rec__nav">
          <IconButton icon="back" label="事件ファイルへ" sfx="cancel" onClick={() => goto('files')} tooltipSide="right" />
          <p class="eyebrow">
            CASE {pad2(num)}
            {summary ? ` ／ ${summary.title}` : ''}
          </p>
        </nav>

        <div class="res-rec__grid">
          <aside class="res-rec__hero">
            <figure class="res-rec__portrait">
              {portrait ? <img src={portrait} alt={`${v.name}の肖像`} /> : <ShardPortrait image={v.portrait} solved seed={caseId} label={`${v.name}の肖像`} />}
              <figcaption class="res-rec__tag t-mono">
                No.{pad2(num)} · RESTORED
              </figcaption>
            </figure>
            <div class="res-rec__id">
              <p class="res-rec__was">{v.codename}</p>
              <h1 class="res-rec__name" ref={heading} tabIndex={-1}>
                {v.name}
              </h1>
              <p class="res-rec__kana">{v.nameKana}</p>
              <dl class="res-rec__meta">
                <div>
                  <dt>年齢</dt>
                  <dd>{v.age}歳</dd>
                </div>
                <div>
                  <dt>職業</dt>
                  <dd>{v.occupation}</dd>
                </div>
              </dl>
            </div>
          </aside>

          <div class="res-rec__main">
            <section class="res-rec__cause" aria-labelledby="res-cause">
              <p class="res-rec__cause-label" id="res-cause">
                <span>死因</span>
                <em>CAUSE OF DEATH</em>
              </p>
              <p class="res-rec__cause-text">{sol.truth.causeOfDeath}</p>
            </section>

            <figure class="res-rec__epitaph">
              <blockquote>{last}</blockquote>
              <figcaption>— {v.name}</figcaption>
              <Button variant="quiet" size="sm" icon="play" onClick={onReplay} sfx="page">
                別れの言葉をもう一度
              </Button>
            </figure>

            <Disclosure id="story" en="THE WHOLE STORY" title="事件の全貌" note={`あらまし・時系列 ${sol.truth.timeline.length}件`}>
              <p class="res-rec__summary">{sol.truth.summary}</p>
              <ol class="timeline">
                {sol.truth.timeline.map((t, i) => (
                  <li key={i} class="timeline__item">
                    <span class="timeline__time t-mono">{t.time}</span>
                    <span class="timeline__dot" aria-hidden="true" />
                    <p class="timeline__event">{t.event}</p>
                  </li>
                ))}
              </ol>
            </Disclosure>

            <Disclosure id="facts" en="FINDINGS" title="所見の記録" note={`発見 ${sol.allFacts.filter((f) => f.unlocked).length} / ${sol.allFacts.length}`}>
              <FactsRecord facts={sol.allFacts} />
            </Disclosure>

            <footer class="res-rec__next">
              <div class="res-rec__holma">
                <div class="res-rec__holma-face" aria-hidden="true">
                  <HolmaSprite mood={lead.mood} framing="bust" />
                </div>
                <p class="res-rec__holma-line">
                  <span class="res-rec__holma-name">ホルマ</span>
                  {lead.text}
                </p>
              </div>
              <Button variant="big-cta" class="end-cta" size="lg" icon="science" iconRight="chevronRight" en="SCIENCE AUTOPSY" onClick={toScience} data-autofocus>
                科学解剖へ
              </Button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Collapsed by default: the record's first screen is portrait · name · cause · farewell · next (the story was just told). */
function Disclosure({ id, en, title, note, initiallyOpen = false, children }: { id: string; en: string; title: string; note?: string; initiallyOpen?: boolean; children: ComponentChildren }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section class={`disc ${open ? 'is-open' : ''}`}>
      <h2 class="disc__h">
        <button
          type="button"
          class="disc__btn"
          aria-expanded={open}
          aria-controls={`disc-${id}`}
          onClick={() => {
            audio.sfx(open ? 'close' : 'open');
            setOpen(!open);
          }}
        >
          <span class="disc__en">{en}</span>
          <span class="disc__title">
            {title}
            {note && <small class="disc__note">{note}</small>}
          </span>
          <Icon name="chevronDown" size={22} class="disc__chev" />
        </button>
      </h2>
      <div class="disc__body" id={`disc-${id}`} role="region" aria-label={title} hidden={!open}>
        <div class="disc__inner">{children}</div>
      </div>
    </section>
  );
}

type RecordFact = PublicFact & { unlocked: boolean };

function FactsRecord({ facts }: { facts: RecordFact[] }) {
  const sort = (a: RecordFact, b: RecordFact) => b.importance - a.importance || a.id.localeCompare(b.id);
  const found = facts.filter((f) => f.unlocked).sort(sort);
  const proven = facts.filter((f) => !f.unlocked && f.importance >= 4).sort(sort);
  const missed = facts.filter((f) => !f.unlocked && f.importance < 4).sort(sort);
  const [tab, setTab] = useState('found');
  const rate = Math.round((found.length / Math.max(1, facts.length - proven.length)) * 100);
  return (
    <div class="facts">
      <div class="facts__summary">
        <div class="facts__meter" role="img" aria-label={`所見 ${facts.length - proven.length}件のうち ${found.length}件を発見（${rate}%）`}>
          <span style={{ width: `${rate}%` }} />
        </div>
        <p class="t-mono">
          FOUND {found.length} / {facts.length - proven.length} · {rate}%
        </p>
      </div>
      <Tabs
        group="facts"
        value={tab}
        onChange={setTab}
        label="所見の記録"
        size="sm"
        items={[
          { id: 'found', label: '見つけた所見', badge: found.length + proven.length },
          { id: 'missed', label: '見逃した所見', badge: missed.length },
        ]}
      />
      <TabPanel group="facts" id="found" value={tab}>
        {proven.length > 0 && (
          <>
            <p class="facts__group">審問で明かした核心</p>
            <ul class="facts__list">
              {proven.map((f) => (
                <FactRow key={f.id} f={f} tone="proven" />
              ))}
            </ul>
          </>
        )}
        <p class="facts__group">捜査で見つけた所見</p>
        <ul class="facts__list">
          {found.map((f) => (
            <FactRow key={f.id} f={f} tone="found" />
          ))}
        </ul>
      </TabPanel>
      <TabPanel group="facts" id="missed" value={tab}>
        {missed.length === 0 ? (
          <p class="facts__empty">見逃した所見はありません。……完璧ですねェ。</p>
        ) : (
          <>
            <p class="facts__note">訊かれなかったことは、答えられません。——部屋の掟です。</p>
            <ul class="facts__list">
              {missed.map((f) => (
                <FactRow key={f.id} f={f} tone="missed" />
              ))}
            </ul>
          </>
        )}
      </TabPanel>
    </div>
  );
}

function FactRow({ f, tone }: { f: RecordFact; tone: 'found' | 'missed' | 'proven' }) {
  const pips = Math.min(4, f.importance);
  return (
    <li class={`fact-row fact-row--${tone} ${f.importance >= 3 ? 'is-core' : ''}`}>
      <span class="fact-row__icon" aria-hidden="true">
        <Icon name={resolveIcon(f.icon, f.category)} size={16} />
      </span>
      <div class="fact-row__body">
        <p class="fact-row__title">
          <strong>{factTitle(f)}</strong>
          <span class="fact-row__cat">{f.category}</span>
          {pips > 0 && (
            <span class="fact-row__pips" aria-label={`重要度 ${pips}`}>
              {'◆'.repeat(pips)}
            </span>
          )}
        </p>
        <p class="fact-row__text">{f.text}</p>
      </div>
    </li>
  );
}
