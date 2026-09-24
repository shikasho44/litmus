/**
 * 科学解剖 SCIENCE AUTOPSY (design bible §3-4) — the case's science as a long-form,
 * typeset explainer. Data: api.solution().science (+ allFacts, memos, sources).
 *
 * Desktop: sticky section index with reading progress on the left, article on the right.
 * Phone:   sticky top bar with progress + the current section (tap → section menu).
 * Diagrams come from src/features/diagrams and are placed after the mechanism section they
 * talk about. A draft badge is shown while the case is not human-reviewed.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CaseSummary, SolutionResponse } from '../../../shared/api';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { Diagram } from '../../features/diagrams';
import { motionReduced } from '../../fx/motion';
import { ART, useImage } from '../../lib/asset';
import { pickLine } from '../../lib/lines';
import { useCaseProgress } from '../../state/hooks';
import { Button, IconButton } from '../../ui/Button';
import { factTitle } from '../../ui/EvidenceCard';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import { resolveIcon, type IconName } from '../../ui/icons';
import { EndingError, EndingLoading, SectionHead } from '../Resolution/common';
import { advanceStage, caseNumber, pad2, useSolution } from '../Resolution/solution';
import { paragraphs, placeDiagrams, pullQuote } from './text';
import './science.css';

export function ScienceScene({ params }: SceneProps) {
  const caseId = params.caseId!;
  const [state, retry] = useSolution(caseId);
  useEffect(() => {
    if (state.status === 'ok') advanceStage(caseId, 'science');
  }, [state.status, caseId]);
  if (state.status === 'loading') return <EndingLoading label="標本を並べています" />;
  if (state.status === 'error') return <EndingError caseId={caseId} reason={state.reason} onRetry={retry} />;
  return <Science caseId={caseId} sol={state.sol} summary={state.summary} />;
}

interface Sec {
  id: string;
  en: string;
  jp: string;
  short: string;
}

const SECTIONS: Sec[] = [
  { id: 'cause', en: 'CAUSE OF DEATH', jp: '今回の死因', short: '今回の死因' },
  { id: 'chain', en: 'CAUSAL CHAIN', jp: '因果の鎖', short: '因果の鎖' },
  { id: 'body', en: 'INSIDE THE BODY', jp: '何が身体で起きたのか', short: '身体で起きたこと' },
  { id: 'why', en: 'WHY HERE', jp: 'なぜ、この状況で起きたのか', short: 'なぜ、ここで' },
  { id: 'clues', en: 'FORESHADOWING', jp: '事件中の伏線', short: '事件中の伏線' },
  { id: 'mech', en: 'MECHANISM', jp: '科学的メカニズム', short: 'メカニズム' },
  { id: 'myths', en: 'MYTH / TRUTH', jp: 'よくある誤解', short: 'よくある誤解' },
  { id: 'everyday', en: 'CLOSER TO HOME', jp: '身近なところでは', short: '身近なところでは' },
  { id: 'points', en: 'TAKEAWAYS', jp: '覚えて帰るポイント', short: '覚えて帰るポイント' },
  { id: 'safety', en: 'STAY SAFE', jp: '身を守るために', short: '身を守るために' },
  { id: 'memos', en: 'SCIENCE MEMOS', jp: '科学メモ', short: '科学メモ' },
  { id: 'sources', en: 'SOURCES', jp: '参考資料', short: '参考資料' },
];

const STAGE_TONE: Record<string, { en: string; color: string }> = {
  原因: { en: 'CAUSE', color: 'var(--bone)' },
  科学現象: { en: 'PHENOMENON', color: 'var(--cyan)' },
  人体への影響: { en: 'EFFECT ON THE BODY', color: 'var(--amber)' },
  結果: { en: 'OUTCOME', color: 'var(--alarm)' },
};

const SOURCE_TYPE: Record<string, string> = {
  government: '公的機関',
  academic: '学術論文',
  medical: '医療情報',
  society: '学会・団体',
  university: '大学',
  other: 'その他',
};

function Science({ caseId, sol, summary }: { caseId: string; sol: SolutionResponse; summary: CaseSummary | null }) {
  const s = sol.science;
  const progress = useCaseProgress(caseId);
  const bg = useImage(ART.science);
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [read, setRead] = useState(0);
  const [menu, setMenu] = useState(false);
  const intro = useMemo(() => pickLine('science.intro'), []);
  const outro = useMemo(() => pickLine('science.outro'), []);
  const slots = useMemo(() => placeDiagrams(s), [s]);
  const quote = useMemo(() => pullQuote(s), [s]);
  const num = caseNumber(caseId, summary);
  const reviewed = (sol as { reviewStatus?: string }).reviewStatus === 'human-reviewed';
  const facts = useMemo(() => new Map(sol.allFacts.map((f) => [f.id, f])), [sol]);
  const unlockedMemos = new Set([...Object.keys(progress.value?.memos ?? {}), ...(progress.value?.snapshot?.memos ?? [])]);
  let diagramNo = 0;
  const cm = s.causeName.match(/^([^（(]+)[（(](.+)[）)]$/);
  const causeMain = cm ? cm[1].trim() : s.causeName;
  const causeSub = cm ? cm[2].trim() : '';

  // reading progress + active section
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = el.scrollHeight - el.clientHeight;
      setRead(max > 0 ? Math.min(1, el.scrollTop / max) : 1);
      const line = el.getBoundingClientRect().top + el.clientHeight * 0.3;
      let idx = 0;
      SECTIONS.forEach((sec, i) => {
        const node = document.getElementById(`sci-${sec.id}`);
        if (node && node.getBoundingClientRect().top <= line) idx = i;
      });
      if (max > 0 && el.scrollTop >= max - 4) idx = SECTIONS.length - 1;
      setActive(idx);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const jump = (id: string) => {
    const el = scroller.current;
    const node = document.getElementById(`sci-${id}`);
    if (!el || !node) return;
    const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - (el.clientWidth < 760 ? 64 : 20);
    el.scrollTo({ top, behavior: motionReduced() ? 'auto' : 'smooth' });
    setMenu(false);
    audio.sfx('page');
    const h = node.querySelector<HTMLElement>('h2');
    h?.setAttribute('tabindex', '-1');
    h?.focus({ preventScroll: true });
  };

  const toQuiz = () => {
    advanceStage(caseId, 'quiz');
    goto('quiz', { caseId });
  };

  const secNo = (id: string) => pad2(SECTIONS.findIndex((x) => x.id === id) + 1);

  return (
    <section class="scene sci" style={summary?.accent ? { '--case-accent': summary.accent } : undefined}>
      <div class="sci__bg" aria-hidden="true">
        {bg && <img src={bg} alt="" />}
        <div class="sci__shade" />
      </div>
      <div class="page sci-page" ref={scroller}>
        {/* phone: sticky progress + section menu */}
        <div class={`sci-mnav only-narrow ${menu ? 'is-open' : ''}`}>
          <div class="sci-mnav__bar">
            <IconButton icon="back" label="身元回復へ戻る" size="sm" variant="plain" sfx="cancel" onClick={() => goto('resolution', { caseId })} />
            <button type="button" class="sci-mnav__cur" aria-expanded={menu} aria-controls="sci-mnav-list" onClick={() => setMenu(!menu)}>
              <span class="t-mono">
                {pad2(active + 1)}/{pad2(SECTIONS.length)}
              </span>
              <span class="sci-mnav__label">{SECTIONS[active].short}</span>
              <Icon name="chevronDown" size={18} />
            </button>
          </div>
          <div class="sci-mnav__progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${read})` }} />
          </div>
          {menu && (
            <ol class="sci-mnav__list" id="sci-mnav-list">
              {SECTIONS.map((sec, i) => (
                <li key={sec.id}>
                  <button type="button" class={i === active ? 'is-active' : ''} onClick={() => jump(sec.id)}>
                    <span class="t-mono">{pad2(i + 1)}</span>
                    {sec.jp}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div class="page__inner sci-layout">
          {/* desktop: sticky index */}
          <nav class="sci-index only-wide" aria-label="科学解剖の目次">
            <div class="sci-index__inner">
              <IconButton icon="back" label="身元回復へ戻る" sfx="cancel" onClick={() => goto('resolution', { caseId })} tooltipSide="right" />
              <p class="sci-index__title">
                <span class="t-mono">CASE {pad2(num)}</span>
                SCIENCE AUTOPSY
              </p>
              <div class="sci-index__track">
                <div class="sci-index__rail" aria-hidden="true">
                  <span style={{ transform: `scaleY(${read})` }} />
                </div>
                <ol>
                  {SECTIONS.map((sec, i) => (
                    <li key={sec.id}>
                      <button type="button" class={`${i === active ? 'is-active' : ''} ${i < active ? 'is-read' : ''}`} aria-current={i === active ? 'location' : undefined} onClick={() => jump(sec.id)}>
                        <span class="t-mono">{pad2(i + 1)}</span>
                        {sec.short}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
              <p class="sci-index__pct t-mono">{Math.round(read * 100)}% READ</p>
              {!reviewed && <p class="sci-index__draft">AI下書き・専門家確認前</p>}
            </div>
          </nav>

          <article class="sci-article">
            <header class="sci-hero">
              <p class="eyebrow">
                CASE {pad2(num)}
                {summary ? ` ／ ${summary.title}` : ''} ／ {sol.victim.name}
              </p>
              <h1 class="sci-hero__title">
                <span class="sci-hero__jp">科学解剖</span>
                <span class="sci-hero__en">SCIENCE AUTOPSY</span>
              </h1>
              <p class="sci-hero__sub">{s.title}</p>
              {!reviewed && (
                <p class="sci-draft" role="note">
                  <Icon name="info" size={18} />
                  <span>この解説はAIが作成した下書きです（専門家による確認前）。正確さには注意を払っていますが、医療・安全の判断は公的機関や専門家の情報をご確認ください。</span>
                </p>
              )}
              <HolmaAside mood={intro.mood} text={intro.text} />
            </header>

            {/* 01 cause */}
            <Section sec={SECTIONS[0]} no={secNo('cause')}>
              <div class="sci-cause">
                <p class="sci-cause__label t-mono">DIAGNOSIS — 正式な死因</p>
                <p class="sci-cause__name">{causeMain}</p>
                {causeSub && <p class="sci-cause__sub">{causeSub}</p>}
                <p class="sci-cause__lead">{s.lead}</p>
              </div>
            </Section>

            {/* 02 chain */}
            <Section sec={SECTIONS[1]} no={secNo('chain')}>
              <CausalChain chain={s.chain} />
            </Section>

            {/* 03 body */}
            <Section sec={SECTIONS[2]} no={secNo('body')}>
              <Prose text={s.body} />
              {quote && (
                <blockquote class="sci-pull">
                  <p>{quote}</p>
                </blockquote>
              )}
            </Section>

            {/* 04 why */}
            <Section sec={SECTIONS[3]} no={secNo('why')}>
              <Prose text={s.whyHere} />
            </Section>

            {/* 05 clues */}
            <Section sec={SECTIONS[4]} no={secNo('clues')}>
              <p class="sci-note">捜査で集めた所見の、本当の意味。</p>
              <ol class="clues">
                {s.foreshadowing.map((c, i) => {
                  const f = facts.get(c.fact);
                  return (
                    <li key={i} class={`clue ${f?.unlocked ? 'is-found' : 'is-missed'}`}>
                      <div class="clue__fact">
                        <span class="clue__icon" aria-hidden="true">
                          <Icon name={f ? resolveIcon(f.icon, f.category) : 'evidence'} size={16} />
                        </span>
                        <div>
                          <p class="clue__title">
                            {f ? factTitle(f) : c.fact}
                            <span class="clue__status">{f?.unlocked ? '発見済み' : '見逃し'}</span>
                          </p>
                          {f && <p class="clue__text">{f.text}</p>}
                        </div>
                      </div>
                      <span class="clue__arrow" aria-hidden="true">
                        <Icon name="chevronRight" size={18} />
                      </span>
                      <p class="clue__meaning">
                        <span class="sr-only">意味：</span>
                        {c.meaning}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </Section>

            {/* 06 mechanism + diagrams */}
            <Section sec={SECTIONS[5]} no={secNo('mech')}>
              {s.mechanism.map((m, i) => (
                <div key={i} class="mech">
                  <h3 class="mech__h">
                    <span class="mech__no t-mono">{pad2(i + 1)}</span>
                    {m.heading}
                  </h3>
                  <Prose text={m.text} />
                  {slots[i]?.map((di) => (
                    <Diagram key={di} d={s.diagrams[di]} index={diagramNo++} />
                  ))}
                </div>
              ))}
            </Section>

            {/* 07 myths */}
            <Section sec={SECTIONS[6]} no={secNo('myths')}>
              <MythCards items={s.misconceptions} />
            </Section>

            {/* 08 everyday */}
            <Section sec={SECTIONS[7]} no={secNo('everyday')}>
              <ul class="everyday">
                {s.everyday.map((e, i) => (
                  <li key={i}>
                    <span class="everyday__mark" aria-hidden="true">
                      <Icon name={(['place', 'person', 'environment', 'time', 'item'] as IconName[])[i % 5]} size={18} />
                    </span>
                    <p>{e}</p>
                  </li>
                ))}
              </ul>
            </Section>

            {/* 09 takeaways */}
            <Section sec={SECTIONS[8]} no={secNo('points')}>
              <ol class="points">
                {s.takeaways.map((t, i) => (
                  <li key={i}>
                    <span class="points__no" aria-hidden="true">
                      {pad2(i + 1)}
                    </span>
                    <p>{t}</p>
                  </li>
                ))}
              </ol>
            </Section>

            {/* 10 safety */}
            <Section sec={SECTIONS[9]} no={secNo('safety')}>
              <div class="safety" role="note">
                <span class="safety__icon" aria-hidden="true">
                  <Icon name="info" size={26} />
                </span>
                <p class="safety__text">{s.safetyNote}</p>
              </div>
            </Section>

            {/* 11 memos */}
            <Section sec={SECTIONS[10]} no={secNo('memos')}>
              <p class="sci-note">
                捜査で入手した科学メモ：{sol.memos.filter((m) => unlockedMemos.has(m.id)).length} / {sol.memos.length}
              </p>
              <div class="memos">
                {sol.memos.map((m) => {
                  const got = unlockedMemos.has(m.id);
                  return (
                    <article key={m.id} class={`memo ${got ? 'is-got' : 'is-new'}`}>
                      <p class="memo__tag t-mono">{got ? 'COLLECTED' : 'NOW OPEN'}</p>
                      <h3 class="memo__title">{m.title}</h3>
                      <p class="memo__text">{m.text}</p>
                    </article>
                  );
                })}
              </div>
            </Section>

            {/* 12 sources */}
            <Section sec={SECTIONS[11]} no={secNo('sources')}>
              <p class="sci-note">この解説は、次の公的機関・学会・大学・論文などの情報をもとに書かれています（リンクは別のタブで開きます）。</p>
              <ol class="sources">
                {sol.sources.map((src) => (
                  <li key={src.id} class="source">
                    <p class="source__meta">
                      <span class={`source__type source__type--${src.type}`}>{SOURCE_TYPE[src.type] ?? src.type}</span>
                      <span class="source__org">{src.organization}</span>
                      {src.publicationDate && <span class="source__date t-mono">{src.publicationDate}</span>}
                    </p>
                    <a class="source__title" href={src.url} target="_blank" rel="noopener noreferrer">
                      {src.title}
                      <Icon name="external" size={14} class="source__ext" />
                      <span class="sr-only">（新しいタブで開きます）</span>
                    </a>
                    <details class="source__supports">
                      <summary>この資料が裏づけている内容</summary>
                      <p>{src.supports}</p>
                    </details>
                    <p class="source__accessed t-mono">閲覧日 {src.accessedDate}</p>
                  </li>
                ))}
              </ol>
            </Section>

            <footer class="sci-end">
              <HolmaAside mood={outro.mood} text={outro.text} />
              <Button variant="big-cta" class="end-cta" size="lg" icon="check" iconRight="chevronRight" en="RECALL TEST" onClick={toQuiz}>
                記憶の定着へ
              </Button>
              {!reviewed && <p class="sci-end__draft">※ この解説はAIが作成した下書きです（専門家による確認前）。</p>}
            </footer>
          </article>
        </div>
      </div>
    </section>
  );
}

function Section({ sec, no, children }: { sec: Sec; no: string; children: ComponentChildren }) {
  return (
    <section class={`sci-sec sci-sec--${sec.id}`} id={`sci-${sec.id}`} aria-labelledby={`sci-h-${sec.id}`}>
      <SectionHead num={no} en={sec.en} jp={sec.jp} id={`sci-h-${sec.id}`} />
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <div class="prose">
      {paragraphs(text).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function HolmaAside({ mood, text }: { mood: 'normal' | 'laugh' | 'surprised' | 'serious'; text: string }) {
  return (
    <div class="holma-aside">
      <div class="holma-aside__face" aria-hidden="true">
        <HolmaSprite mood={mood} framing="bust" />
      </div>
      <p class="holma-aside__line">
        <span class="holma-aside__name">ホルマ</span>
        {text}
      </p>
    </div>
  );
}

/** 原因 → 科学現象 → 人体への影響 → 結果, with connectors that draw in when scrolled into view. */
function CausalChain({ chain }: { chain: SolutionResponse['science']['chain'] }) {
  const ref = useRef<HTMLOListElement>(null);
  const [seen, setSeen] = useState(() => motionReduced());
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && (setSeen(true), io.disconnect()), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <ol class={`chain ${seen ? 'is-in' : ''}`} ref={ref}>
      {chain.map((c, i) => {
        const tone = STAGE_TONE[c.stage] ?? STAGE_TONE['原因'];
        return (
          <li key={i} class="chain__node" style={{ '--tone': tone.color, '--i': i }}>
            <div class="chain__marker" aria-hidden="true">
              <span class="chain__num">{i + 1}</span>
              {i < chain.length - 1 && (
                <span class="chain__link">
                  <span />
                </span>
              )}
            </div>
            <div class="chain__card">
              <p class="chain__stage">
                <span>{c.stage}</span>
                <em>{tone.en}</em>
              </p>
              <h3 class="chain__title">{c.title}</h3>
              <p class="chain__detail">{c.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function MythCards({ items }: { items: { myth: string; truth: string }[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const all = open.size === items.length;
  const toggle = (i: number) => {
    audio.sfx('refute');
    setTouched((t) => new Set(t).add(i));
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };
  return (
    <div class="myths">
      <div class="myths__bar">
        <p class="sci-note">カードをめくると、本当のことが読めます。</p>
        <Button
          variant="quiet"
          size="sm"
          icon="refresh"
          sfx="page"
          onClick={() => {
            setTouched(new Set(items.map((_, i) => i)));
            setOpen(all ? new Set() : new Set(items.map((_, i) => i)));
          }}
        >
          {all ? 'すべて戻す' : 'すべてめくる'}
        </Button>
      </div>
      <ul class="myths__grid">
        {items.map((m, i) => {
          const flipped = open.has(i);
          return (
            <li key={i}>
              <button type="button" class={`flip ${flipped ? 'is-flipped' : ''} ${touched.has(i) ? '' : 'is-idle'}`} aria-pressed={flipped} onClick={() => toggle(i)}>
                <span class="flip__inner">
                  <span class="flip__face flip__front" aria-hidden={flipped}>
                    <span class="flip__label">
                      <Icon name="cross" size={16} />
                      よくある誤解
                    </span>
                    <span class="flip__myth">{m.myth}</span>
                    <span class="flip__hint">
                      めくる
                      <Icon name="refresh" size={14} />
                    </span>
                  </span>
                  <span class="flip__face flip__back" aria-hidden={!flipped}>
                    <span class="flip__label">
                      <Icon name="check" size={16} />
                      本当は
                    </span>
                    <span class="flip__truth">{m.truth}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
