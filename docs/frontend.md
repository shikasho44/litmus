# Frontend guide — ジェーンドゥの死因

The browser side: visual system, UI kit, FX, audio, app shell and the first scenes
(Title / Prologue / Files / overlays). Read `docs/design-bible.md` first; this file is how
to build on top of what exists. Everything is Preact + @preact/signals + GSAP.

```
src/
  main.tsx            boot: save → viewport → router → audio → render (after logo font)
  app/                shell: App, SceneHost (transitions), router, scenes registry, overlays, flow, debug, Gallery
  scenes/<Name>/      one folder per scene, exports <Name>Scene
  overlays/           Settings, HowTo, Credits (Modal-based)
  ui/                 UI kit (barrel: src/ui/index.ts)
  fx/                 backdrop shader, FxLayer, imperative fx API
  audio/              WebAudio engine, synth voices, 5 BGM tracks, SFX
  state/              save store (localStorage), types, hooks
  lib/                assets, lines (Holma bank + prologue), cases list, viewport, rng, env
  styles/             tokens, base, typography, utilities, fonts (generated)
  build/html-env.ts   Vite plugin for index.html env defaults (wire it in vite.config.ts)
```

---

## 1. Building a scene (for the next builders)

Placeholders exist for **Intro, Investigation, Inquest, Resolution, Science, Quiz, Result**
(`src/scenes/<Name>/index.tsx`). Replace the body; **keep the export name** — it is what
`src/app/scenes.ts` loads:

| scene | export | default BGM | backdrop |
|---|---|---|---|
| intro | `IntroScene` | investigation | dim |
| investigation | `InvestigationScene` | investigation | formalin |
| inquest | `InquestScene` | inquest | alarm |
| resolution | `ResolutionScene` | truth | truth |
| science | `ScienceScene` | science | cyan |
| quiz | `QuizScene` | science | cyan |
| result | `ResultScene` | truth | formalin |

```tsx
import type { SceneProps } from '../../app/router';
import { goto, openOverlay } from '../../app/router';
import { api } from '../../api';
import { StageLayout, HolmaSprite, ShardPortrait, DialogueBox, Button } from '../../ui';
import { useCaseProgress, useCaseTimer } from '../../state/hooks';
import { setStage, appendLog, addFacts, setToken } from '../../state/save';
import { fx } from '../../fx';
import { audio } from '../../audio';

export function InvestigationScene({ params }: SceneProps) {
  const caseId = params.caseId!;            // case scenes always get a caseId
  const progress = useCaseProgress(caseId); // reactive (signal) view of the save
  useCaseTimer(caseId);                     // advances elapsedMs while visible
  // ...
  return (
    <section class="scene">
      <StageLayout top={…} stage={…} background={`cases/c01/bg.webp`} bottom={…} dock={…} side={…} />
    </section>
  );
}
```

Rules of the house

- Render inside `<section class="scene">` (absolute, full size, safe-area padding). Scrolling
  screens use `<div class="page"><div class="page__inner">…`.
- Focus: SceneHost focuses the first `[data-autofocus]` in the new scene, else the scene
  wrapper. Put `data-autofocus` on the input of the investigation dock, etc.
- Everything the player reads is DOM text. Images never contain text.
- Public assets: always via `assetUrl()` / `useImage()` (`src/lib/asset.ts`) — the site runs
  from a sub-folder. `useImage(path)` returns `null` until the file is known to exist, so
  render your fallback while it is null (no broken-image icons, ever).
- Respect reduced motion: use `fx.*` (they already do) and `motionReduced()` for your own GSAP.
- Call `setStage(caseId, 'investigation')` etc. when the player reaches a stage; `openCase()`
  and the Title's 「続きから」 use `stage` to resume.
- The API: `import { api } from '../../api'` and program against `GameApi` (shared/api.ts).
  Wrap calls in try/catch; `ApiError.code` tells network / timeout / rate_limited / bad_token.

### Layout: `StageLayout`

- **PC (wide)**: optional left `side` column (340px), then a centred **16:9 stage** whose
  width is shared by `bottom` (conversation) and `dock` (input). `bottomHeight` (default 230)
  is the room reserved under the stage. `cinematic` overlays `bottom` on the stage (ADV look).
- **Phone (narrow)**: `top` / stage (38% of the visual viewport; 20% while the keyboard is
  open) / `bottom` (scrolls) / `dock` (pinned above the keyboard & safe area). `side` is not
  rendered — open it with `openOverlay('sheet', …)` instead.
- The stage element carries `[data-stage]`; `fx.stamp()` and `fx.shatter()` centre on it.
- Layout signal: `layout.value` (`'wide' | 'narrow'`) and `keyboardOpen.value` from
  `src/lib/viewport.ts`; CSS can use `[data-layout='narrow']` / `[data-kb='open']` on `#app`
  and the helpers `.only-wide` / `.only-narrow`.

### Routing & overlays (`src/app/router.ts`)

- `goto(scene, params?, { replace? })`, `back()`. Hash URLs `#/<scene>/<caseId>?k=v`, one
  history entry per scene → the browser back button works.
- `openOverlay('settings' | 'howto' | 'credits')`, `closeOverlay()`. Overlays are history
  entries too (back closes them).
- The notebook: `openOverlay('sheet', { title: '捜査ノート', en: 'NOTEBOOK', side: 'auto', render: () => <Notebook/>, headerExtra: () => <Tabs …/> })`
  → bottom sheet on phones, left drawer on PC (`wide: true` for 760px).
- Transitions: diagonal shutter (≤ 580 ms; cross-fade with reduced motion) that also covers
  the code-split load of the next scene. `transitioning` signal is true meanwhile.
- `openCase(caseId)` (`src/app/flow.ts`) opens a case where the player left off; a completed
  case starts a fresh run (best rank / clears kept).

---

## 2. State & save (`src/state`)

One versioned JSON blob in `localStorage[APP_CONFIG.SAVE_KEY]` (`janedoe:save:v1`), autosaved
600 ms after any change and flushed on `pagehide` / hidden. Storage failures never throw
(`storageOk` signal turns false and the game keeps running in memory). `migrate()` in
`save.ts` is the hook for future versions.

```ts
saveData.value            // SaveData { version, settings, meta, cases }
settings.value            // Settings (computed)
updateSettings({ textSpeed: 'fast' })
updateMeta({ prologueSeen: true })
getCaseProgress(id) / updateCase(id, patch | (c) => c)
appendLog(id, [{ kind: 'question', text }, { kind: 'answer', question, answerClass, line, mood, unlocked, memos }])
addFacts(id, PublicFact[]) · addMemos(id, memos) · addHint(id, level, text)
setToken(id, token, snapshot) · markFactsSeen(id, ids) · setStage(id, stage)
setInquest(id, { phase, roundIndex, composure, … })   // merges, defaults composure 5
completeCase(id, { rank, title, at, elapsedMs, stats }) · resetCase(id) · resetAll()
caseStatus(c) → 'new' | 'active' | 'solved' | 'complete'   (labels: CASE_STATUS_LABEL)
resumableCaseId (computed) · getDevPipelineMode()      // dev-only override for the API client
hooks: useCaseProgress(id), useCaseStatus(id), useCaseTimer(id), formatElapsed(ms)
```

`CaseProgress` keeps: `stage, token, snapshot, log (≤600), facts (PublicFact by id) + factOrder,
seenFacts (NEW badge), memos, hints, notes, inquest {phase, roundIndex, composure, cleared,
misses, grants, verdictAttempts, lastVerdict, verdictDraft, reconstructionPicks,
reconstructionDone, suspensions}, quiz, elapsedMs, completed, clears, bestRank, lastResult`.
See `src/state/types.ts`.

Settings: `bgmVolume, sfxVolume, voiceBlips, muted, textSpeed (slow|normal|fast|instant),
fontScale (100|115|130), reduceMotion (defaults to prefers-reduced-motion), pipelineMode (dev)`.
Font scale drives `html { font-size }` → use `rem` for text, px for geometry.

---

## 3. UI kit (`src/ui`, barrel `src/ui/index.ts`)

Open the live catalogue with `?debug=1` → `__JD.gallery()`.

| component | notes |
|---|---|
| `Button` | `variant: primary \| ghost \| danger \| big-cta \| quiet`, `size`, `icon`, `iconRight`, `en` (Anton kicker), `sfx` (default 'confirm', `false` = silent), hover tick |
| `IconButton` | required `label` (aria + tooltip), `variant: ghost \| solid \| plain`, `pressed`, `badge` |
| `Panel` | specimen-label header: `title`, `en`, `tag`, `tone: ink \| bone \| glass`, `actions` |
| `Tabs` / `TabPanel` | accessible tablist (←/→/Home/End), link by `group` |
| `Modal` | role=dialog, focus trap, Esc, restores focus, portal; `title`, `en`, `size sm..xl`, `footer`, `tone` |
| `BottomSheet` | phone sheet with drag-to-close; `side: auto` = left drawer on PC |
| `toast(msg, {tone, icon, duration})` | `ToastHost` is mounted by App; aria-live polite |
| `Tooltip` / `[data-tip]` | CSS tooltip on hover/focus (fine pointers only) |
| `DialogueBox` | typewriter (speed setting), click/Enter/Space = complete → advance, voice blips per speaker, name plate, `glitch` for Jane, `auto`, `lineKey` to restart, full line in an aria-live region. `skipText()` finishes every line |
| `Stamp` | the six answer classes (bible §4-3), JP + EN + colour; `animate` slams in, `onImpact` |
| `CutIn` | full-width diagonal band, huge Dela Gothic text, speed lines, optional Holma/Jane |
| `EvidenceCard` | 所見カード (specimen label): category icon, importance pips, CORE band, `isNew`, `selected`, `onSelect`, `compact` |
| `CaseTag` | toe-tag case card (files screen) |
| `ShardPortrait` | deterministic Voronoi glass shards over the portrait. `image`, `shardCount` (34), `revealed` (count or ids `s0…`), `solved` (assemble + flash → full colour), `onAssembled`, `seed` (use the case id), `silhouette` (bust clip until solved), `glow` |
| `HolmaSprite` | `mood`, `talking`, `framing: bust \| knee \| full`, `rim`; frames the sprite with `public/art/holma/meta.json` face anchors, cross-fades moods, idle breathing; vector fallback (`HolmaVector`) when art is missing |
| `GlitchText`, `SpeedLines` | decorative |
| `Slider`, `Switch`, `Segmented` | form controls used by Settings |
| `StageLayout` | see §1 |
| `Icon` + `ICONS` | 24px stroke icons. Categories: person place time item body environment evidence science; UI: hint notebook gavel settings soundOn soundOff back send close menu info check cross play skip log auto chevron* lock eye star tag shard pulse help credits refresh trash external rabbit. `resolveIcon(fact.icon, fact.category)` |

Tokens live in `src/styles/tokens.css` (colours `--ink --bone --formalin --alarm --cyan --amber
--violet --mute`, answer colours `--c-yes …`, fonts `--font-display/body/jane/en/mono`,
`--tilt`, `--skew`, textures `--tex-halftone`, `--tex-stripes`). Utility classes: `.band`,
`.tape`, `.chip`, `.eyebrow`, `.heading`, `.halftone-fade`, `.t-*`, `.row`, `.stack`, `.sr-only`.

---

## 4. FX (`src/fx`)

```ts
import { fx } from '../../fx';
fx.shake(strength = 1, duration = .38)       // shakes the scene host
fx.flash(color = '#fff', { opacity, duration }) // ≤ 3 flashes / second, min 340 ms apart
fx.shatter(x?, y?, { color, count })         // glass burst (canvas) + sound; default = stage centre
await fx.cutIn({ text, en, tone, character: 'holma' | 'jane', mood, hold }) // queued
await fx.stamp(answerClass, { x, y, hold = 1.1, size = 'xl', sound, shake })
fx.speedLines(ms, { kind: 'radial' | 'horizontal', color })
fx.glitch(element)                           // one-shot RGB-split glitch
fx.pulse('alarm' | 'cyan' | 'formalin')      // heartbeat vignette + sound
fx.setBackdrop('formalin' | 'alarm' | 'cyan' | 'amber' | 'violet' | 'dim' | 'truth')
fx.reset()                                   // SceneHost calls this on scene change
```

Reduced motion (OS or setting): no shake / flash / glitch / shatter; stamps and cut-ins fade.
The backdrop (`BackdropCanvas`) is a WebGL shader (formalin haze, motes, vignette, scanlines,
grain) at half resolution / 30 fps with a Canvas2D fallback; it pauses when the tab is hidden,
renders one static frame with reduced motion, and drops to static on low FPS. `?nofx=1`
disables it.

## 5. Audio (`src/audio`)

```ts
import { audio } from '../../audio';
audio.bgm('title' | 'investigation' | 'inquest' | 'truth' | 'science' | 'none', fade = 1.4)
audio.sfx('hover' | 'confirm' | 'cancel' | 'error' | 'stamp' | 'finding' | 'findingCore' | 'shatter'
        | 'whoosh' | 'cutin' | 'gavel' | 'heartbeat' | 'page' | 'open' | 'close' | 'toggle'
        | 'refute' | 'reveal' | 'send', { answerClass })   // 'stamp' varies by answer class
audio.blip('holma' | 'jane' | 'narration' | 'system')      // DialogueBox does this for you
```

All sound is synthesized (no files): master → compressor, BGM / SFX buses with shared reverbs.
The context is created and resumed on the first pointer/key gesture; BGM requested earlier is
remembered and starts on unlock. Settings (volumes, mute, voice blips) apply live; the context
is suspended while the tab is hidden. Tracks are 16-bar loops with a variation every 8 bars:

- **title** D minor 74 BPM — music box melody, low drone, bell tolls
- **investigation** A minor 90 BPM (swing) — pizzicato bass, tick-tock clock, vibraphone chords, melody in B
- **inquest** E minor 138 BPM — four-on-the-floor, rolling saw bass with filter sweeps, stabs, arpeggio lead, 2-bar break with snare roll + riser
- **truth** C major 64 BPM — felt piano arpeggios, pad, melody, bittersweet Fm6
- **science** 80 BPM — glassy bell arps through a dotted delay, pads, sub, gentle pulse in B

## 6. Content hooks

- Holma lines: `pickLine('answer.yes')`, `pickLine('title.idle')`, … (`src/lib/lines.ts`) — a
  shuffle bag per key, returns `{ text, mood }`. Loaded from `content/holma-lines.json` with an
  in-code fallback for missing keys.
- Prologue: `PROLOGUE` from `content/prologue.json` (fallback script in code). Line `fx` cues map
  to fx calls (shake, flash, stamp-*, cutin, glitch, gavel, heartbeat), `bgm` cues to `audio.bgm`.
- Cases list: `loadCases()` / `caseList` signal (`src/lib/cases.ts`), shared by Title & Files.

## 7. Debug & QA

- `window.__JD` (dev server or `?debug=1`): `goto(scene, params)`, `back()`, `getState()`,
  `setSettings()`, `setMeta()`, `updateCase()`, `skipText()`, `fx`, `audio`, `toast`,
  `lines`, `prologue`, `openOverlay()`, `closeOverlay()`, `resetSave()`, `idle()` (resolves when
  no transition runs), `gallery()`.
- `goto('prologue', { line: '21' })` starts the prologue mid-script.
- `node scripts/ui-shots.mjs` → builds if needed, serves `vite preview` on **:4191**, captures
  title / prologue / files / settings / howto / credits / fx / gallery / placeholder at
  1440×900 and 390×844 (+ 320px overflow checks) into `qa/ui/`, runs an audio smoke test, and
  exits 1 on page errors or horizontal overflow. `--dev` uses a running dev server (:5190).
  Note: **port 4190 is on the browsers' blocked-port list** (ManageSieve) — Chrome refuses to
  open it, so `npm run preview` on 4190 cannot be viewed in a browser.
- `npm run qa` / `npm run qa:mobile` (`scripts/qa.mjs`) → end-to-end flow on its own dev server (:5198,
  rules mode, virtual clock): title → prologue → files → intro → investigation (real probes until the
  debate evidence is unlocked, a hint) → inquest → resolution → science → quiz → result → files rank,
  with reload / 「続きから」 resume checks at every stage, plus a mint-token smoke of the other cases.
  `--case c02|all`, `--no-smoke`, `--smoke-only`. Screenshots in `qa/flow/`; exit 1 on page/console
  errors, failed checks, wrong scene order, broken images or horizontal overflow.
- `?mute=1` starts muted, `?nofx=1` disables the backdrop shader.

## 8. Fonts

`src/styles/fonts.css` (critical: Dela Gothic One 400, Zen Kaku Gothic New 500, Anton,
JetBrains Mono 400) and `fonts-extra.css` (Zen Kaku 700, Shippori Mincho B1 500) are generated
from `@fontsource` (woff2 only, no greek/cyrillic/vietnamese). The boot splash in `index.html`
waits (max 2.5 s) for the logo face; `fonts-extra` loads right after the first render.
Regenerate after upgrading @fontsource by re-running the generator snippet used to create them
(read the `@fontsource/<pkg>/<weight>.css` files, drop the `.woff` fallbacks and non-JP/Latin
subsets, point `url()` at `../../node_modules/@fontsource/<pkg>/files/…`).
`index.html` preloads the three Dela Gothic One subsets that contain the default logo glyphs.

## 9. index.html env

`index.html` uses `%VITE_APP_TITLE%` / `%VITE_SITE_DESCRIPTION%`. Vite leaves undefined
variables as literal text, so **wire `htmlEnvDefaults()` from `src/build/html-env.ts` into
`vite.config.ts` plugins**; it fills defaults and removes the static `noindex` meta when
`VITE_OFFICIAL_RELEASE_ENABLED=true`. (At runtime `main.tsx` also sets `document.title` and
keeps/removes `noindex` from `APP_CONFIG`.) Legal pages are static in `public/`
(`terms.html`, `privacy.html`, `contact.html`); if `VITE_CONTACT_URL` changes, update the
link in `public/contact.html` too.
