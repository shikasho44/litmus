import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { HolmaMood } from '../../../shared/api';
import { goto, openOverlay, type SceneProps } from '../../app/router';
import { openCase } from '../../app/flow';
import { audio } from '../../audio';
import { APP_CONFIG } from '../../config/app';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { ART, fetchJson, useImage, useImageMissing } from '../../lib/asset';
import { layout } from '../../lib/viewport';
import { caseList, loadCases } from '../../lib/cases';
import { pickLine } from '../../lib/lines';
import { resumableCaseId, saveData, settings, updateSettings } from '../../state/save';
import { IconButton } from '../../ui/Button';
import { GlitchText } from '../../ui/GlitchText';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import './title.css';

/** The press-to-enter gate is shown once per page load (it also unlocks audio). */
let entered = false;

/** Touch-first device (phones / tablets): the gate says "tap", not "click / press any key". */
function isCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

interface MenuItem {
  id: string;
  jp: string;
  en: string;
  sub?: string;
  icon: IconName;
  primary?: boolean;
  action: () => void;
}

function splitTitle(t: string): { a: string; particle?: string; b?: string } {
  const i = t.lastIndexOf('の');
  if (i > 0 && i < t.length - 1) return { a: t.slice(0, i), particle: 'の', b: t.slice(i + 1) };
  // 「リトマス審問」: kana head on the top row, the trailing kanji word as the big row
  const m = /^(.+?)(\p{Script=Han}{2,})$/u.exec(t);
  if (m) return { a: m[1], b: m[2] };
  return { a: t };
}

function Logo() {
  const parts = splitTitle(APP_CONFIG.GAME_TITLE);
  // Without a 「の」 tag between the rows the logo loses its beat, so the head word is printed on a
  // litmus strip instead (red | blue, develops on entry) and the big word overlaps it.
  const strip = !!parts.b && !parts.particle;
  const head = <GlitchText text={parts.a} period={7} />;
  return (
    <div class={`logo ${strip ? 'logo--strip' : ''}`}>
      <p class="logo__kicker" aria-hidden="true">
        <span>CASE No.000</span>
        <span class="logo__kicker-sep" />
        <span>UNIDENTIFIED</span>
        <span class="logo__kicker-sep" />
        <span>零番安置室</span>
      </p>
      <h1 class="logo__title" aria-label={APP_CONFIG.GAME_TITLE}>
        <span class="logo__row logo__row--a" aria-hidden="true">
          {strip ? <span class="logo__strip">{head}</span> : head}
        </span>
        {parts.b && (
          <span class="logo__row logo__row--b" aria-hidden="true">
            {parts.particle && <span class="logo__particle">{parts.particle}</span>}
            <span class="logo__big">{parts.b}</span>
          </span>
        )}
      </h1>
      <p class="logo__sub">
        <span>{APP_CONFIG.SUBTITLE}</span>
      </p>
    </div>
  );
}

/**
 * Where Holma's head sits inside key-art.webp (normalised). The art builder may override it
 * with public/art/key-art.json → { "holmaHead": { "x": 0.75, "y": 0.3 } }.
 */
const KEYART = { w: 1920, h: 1080, pos: [0.65, 0.4] as const, holmaHead: { x: 0.752, y: 0.3 } };

function useKeyArtAnchor(el: HTMLElement | null, enabled: boolean) {
  const [head, setHead] = useState(KEYART.holmaHead);
  const [anchor, setAnchor] = useState<{ x: number; y: number; s: number } | null>(null);
  useEffect(() => {
    void fetchJson<{ holmaHead?: { x: number; y: number } }>('art/key-art.json').then((j) => {
      if (j?.holmaHead && typeof j.holmaHead.x === 'number') setHead(j.holmaHead);
    });
  }, []);
  useLayoutEffect(() => {
    if (!el || !enabled) {
      setAnchor(null);
      return;
    }
    const calc = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      const s = Math.max(W / KEYART.w, H / KEYART.h);
      const dw = KEYART.w * s;
      const dh = KEYART.h * s;
      const ox = (W - dw) * KEYART.pos[0];
      const oy = (H - dh) * KEYART.pos[1];
      setAnchor({ x: ox + head.x * dw, y: oy + head.y * dh, s });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, enabled, head]);
  return anchor;
}

function HolmaBadge({ anchor }: { anchor?: { x: number; y: number; s: number } | null }) {
  const [line, setLine] = useState(() => pickLine('title.idle'));
  const [k, setK] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setLine(pickLine('title.idle'));
      setK((v) => v + 1);
    }, 7200);
    return () => clearInterval(t);
  }, []);
  const mood: HolmaMood = line.mood;
  if (anchor) {
    return (
      <aside class="holma-bubble" aria-label="ホルマ" style={{ left: `${anchor.x - 70 * anchor.s}px`, top: `${anchor.y - 40 * anchor.s}px` }}>
        <div class="holma-badge__bubble" key={k} aria-live="polite">
          <span class="holma-badge__name">ホルマ</span>
          <p>{line.text}</p>
        </div>
      </aside>
    );
  }
  return (
    <aside class="holma-badge" aria-label="ホルマ">
      <div class="holma-badge__bubble" key={k} aria-live="polite">
        <span class="holma-badge__name">ホルマ</span>
        <p>{line.text}</p>
      </div>
      <div class="holma-badge__window">
        <div class="holma-badge__liquid" aria-hidden="true" />
        <HolmaSprite mood={mood} framing="bust" />
        <div class="holma-badge__glass" aria-hidden="true" />
      </div>
      <span class="holma-badge__tag" aria-hidden="true">
        No.0 / ORYCTOLAGUS
      </span>
    </aside>
  );
}

export function TitleScene(_: SceneProps) {
  const keyArt = useImage(ART.keyArt);
  // Holma stands in only when the key art is really missing — not while it is still loading
  // (on a slow link that stand-in would pull 1 MB of sprites and swap the picture twice).
  const keyArtMissing = useImageMissing(ART.keyArt);
  const [gate, setGate] = useState(!entered);
  const viaKeyboard = useRef(false);
  const menuRef = useRef<HTMLElement>(null);
  const [sectionEl, setSectionEl] = useState<HTMLElement | null>(null);
  const wide = layout.value === 'wide';
  const touch = isCoarsePointer();
  const anchor = useKeyArtAnchor(sectionEl, !!keyArt && wide);
  const resumeId = resumableCaseId.value;
  const s = settings.value;

  useEffect(() => {
    void loadCases();
  }, []);

  const enter = () => {
    if (entered) return;
    entered = true;
    void audio.unlock().then(() => {
      audio.bgm('title');
      audio.sfx('gavel');
    });
    fx.flash('#C6FF3D', { opacity: 0.25, duration: 0.5 });
    setGate(false);
  };

  useEffect(() => {
    if (!gate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      viaKeyboard.current = true;
      enter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gate]);

  useLayoutEffect(() => {
    if (gate || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll('.menu__item');
    if (!motionReduced()) gsap.fromTo(items, { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out', stagger: 0.05 });
    // Keyboard users land on the first menu item; pointer users get no stray focus ring.
    if (viaKeyboard.current) menuRef.current.querySelector<HTMLElement>('.menu__item')?.focus({ preventScroll: true });
  }, [gate]);

  const start = () => {
    if (!saveData.peek().meta.prologueSeen) goto('prologue');
    else goto('files');
  };

  const resumeTitle = resumeId ? caseList.value?.find((c) => c.id === resumeId)?.title : undefined;
  // A returning player with a case in progress: 続きから is the primary (and first-focused) action.
  const items: MenuItem[] = [
    ...(resumeId
      ? [
          {
            id: 'continue',
            jp: '続きから',
            en: 'CONTINUE',
            sub: resumeTitle ? `「${resumeTitle}」` : undefined,
            icon: 'play' as IconName,
            primary: true,
            action: () => openCase(resumeId),
          },
        ]
      : []),
    { id: 'start', jp: '審問を始める', en: 'START INQUEST', icon: 'gavel', primary: !resumeId, action: start },
    { id: 'files', jp: '事件ファイル', en: 'CASE FILES', icon: 'tag', action: () => goto('files') },
    { id: 'howto', jp: '遊び方', en: 'HOW TO PLAY', icon: 'help', action: () => openOverlay('howto') },
    { id: 'settings', jp: '設定', en: 'SETTINGS', icon: 'settings', action: () => openOverlay('settings') },
    { id: 'credits', jp: 'クレジット', en: 'CREDITS', icon: 'credits', action: () => openOverlay('credits') },
  ];

  return (
    <section ref={setSectionEl} class={`scene title ${gate ? 'is-gate' : 'is-menu'} ${keyArt ? 'has-art' : keyArtMissing ? 'no-art' : 'art-loading'}`} onClick={gate ? enter : undefined}>
      <div class="title__art" aria-hidden="true">
        {keyArt ? <img src={keyArt} alt="" style={wide ? { objectPosition: `${KEYART.pos[0] * 100}% ${KEYART.pos[1] * 100}%` } : undefined} /> : <div class="title__art-fallback" />}
      </div>
      <div class="title__shade" aria-hidden="true" />
      <div class="title__deco" aria-hidden="true">
        <span class="title__outline">LITMUS</span>
        <span class="title__stripe" />
        <span class="title__reg title__reg--tl" />
        <span class="title__reg title__reg--br" />
        <span class="title__clock t-mono">00:00:00 — ROOM ZERO OPEN</span>
      </div>
      {!keyArt && keyArtMissing && (
        <div class="title__hero" aria-hidden="true">
          <HolmaSprite mood="normal" framing="knee" rim="rgba(198,255,61,0.35)" />
        </div>
      )}

      <header class="title__top">
        {!APP_CONFIG.OFFICIAL_RELEASE_ENABLED && (
          <span class="title__preview" title="正式公開前のプレビュー版です">
            <span>PREVIEW</span>
          </span>
        )}
        <div class="spacer" />
        {!gate && (
          <div class="title__icons">
            <IconButton
              icon={s.muted ? 'soundOff' : 'soundOn'}
              label={s.muted ? '音を出す' : '音を消す'}
              pressed={s.muted}
              onClick={() => updateSettings({ muted: !s.muted })}
            />
            <IconButton icon="settings" label="設定" onClick={() => openOverlay('settings')} />
          </div>
        )}
      </header>

      <div class="title__main">
        <Logo />
        {gate ? (
          <button type="button" class="title__enter" onClick={enter}>
            <span class="title__enter-jp">{touch ? 'タップして入室' : 'クリックして入室'}</span>
            <span class="title__enter-en">{touch ? 'TAP TO ENTER ROOM ZERO' : 'CLICK OR PRESS ANY KEY'}</span>
          </button>
        ) : (
          <nav class="menu" ref={menuRef} aria-label="メインメニュー">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                class={`menu__item ${it.primary ? 'is-primary' : ''}`}
                data-id={it.id}
                onPointerEnter={(e) => e.pointerType === 'mouse' && audio.sfx('hover')}
                onFocus={() => audio.sfx('hover')}
                onClick={() => {
                  audio.sfx(it.primary ? 'confirm' : 'toggle');
                  it.action();
                }}
              >
                <span class="menu__bar" aria-hidden="true" />
                <span class="menu__idx t-mono" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span class="menu__label">
                  <span class="menu__jp">{it.jp}</span>
                  <span class="menu__en">{it.en}</span>
                </span>
                {it.sub && <span class="menu__sub">{it.sub}</span>}
                <Icon name="chevronRight" size={22} class="menu__arrow" />
              </button>
            ))}
          </nav>
        )}
      </div>

      {!gate && <HolmaBadge anchor={anchor} />}

      <footer class="title__foot">
        <p class="title__note">
          <Icon name="info" size={14} />
          <span>本作は「死」を題材にした推理ゲームです。登場する事件・人物・団体はすべて架空で、作中の解説は医療上の助言ではありません。</span>
        </p>
        <div class="title__links">
          <a href="terms.html">利用規約</a>
          <a href="privacy.html">プライバシー</a>
          <a href={APP_CONFIG.CONTACT_URL} target="_blank" rel="noopener noreferrer">
            お問い合わせ
          </a>
          <span class="title__copy">{APP_CONFIG.COPYRIGHT_NOTICE.split('　')[0]}</span>
        </div>
      </footer>
    </section>
  );
}
