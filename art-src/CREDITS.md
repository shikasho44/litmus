# Art credits — ジェーンドゥの死因

> Internal provenance record. It lives in `art-src/`, **never in `public/`**: the panel and
> portrait notes below describe every case's solution, and everything under `public/` is served
> as-is. The player-facing credit line is in `src/overlays/Credits.tsx`. A build guard
> (`src/build/release-guard.ts`) fails the build if any `.md` file or case secret reaches `dist`.

All illustrations in `public/art/`, `public/cases/c0N/{bg,portrait,panel-N}.webp` and
`public/og.png` are original images **generated with gpt-image via the Codex CLI built-in image
tool** (batch 1: codex-cli 0.155.0-alpha.16; batch 2: codex-cli 0.155.1) on **2026-09-24**, then
cropped, keyed, retouched (removal only) and converted to WebP locally with the scripts in
`scripts/art/`. No existing artwork, character, logo or photograph was
used as input. The only reference image fed back to the generator is our own Holma sheet
(for the key art). Characters, names and cases are fictional.

Full prompts, generator session ids and validation results: `art-src/manifest.json`.
Raw PNG originals: `art-src/`.

## Shared art direction (every prompt)

Bold graphic-novel illustration, confident black ink linework, flat cel shading with subtle
halftone screentone, limited palette (ink navy #0B0D12, bone white #F2EFE6, formalin green
#C6FF3D, alarm magenta #FF2E63, cold teal #1B3A44), dramatic theatrical lighting, stylish,
slightly unsettling, intelligent mystery mood. Constraints: no gore, no blood, no text, letters,
numbers, logos or watermark. No existing works or artists named in any prompt.

## Images and prompt summaries

| File | Prompt summary |
|---|---|
| `art/holma/{normal,laugh,surprised,serious}.webp` | One transparent sheet, split in four. Holma: a child-height taxidermied white rabbit specimen, stitched seams, glass-bead left eye (generated red, recoloured to amber — see below), black button right eye, oversized white lab coat with rolled sleeves, formalin-green bow tie, blank specimen tag pinned to one ear, slim silver probe, standing on a wooden specimen crate. Expressions: smug smile / cackling laugh / ears-up surprise / solemn and sincere. |
| `cases/c01/portrait.webp` | Chest-up portrait, 29-year-old Japanese cell-biology researcher: short black bob, thin metal glasses, tired kind eyes, lab coat over dark grey knit; dark navy ground, teal rim light. |
| `cases/c02/portrait.webp` | Chest-up portrait, 18-year-old Japanese former softball player: tanned, high ponytail, determined eyes, plain white sports T-shirt, small bandage on one finger near the chin. |
| `cases/c03/portrait.webp` | Chest-up portrait, 34-year-old Japanese mountain photographer: wavy dark-brown hair, wind-reddened cheeks, deep green fleece, camera strap, far-away gaze. |
| `art/bg-room-zero.webp` | 零番安置室: surreal elegant morgue at midnight, wall of steel drawers, glowing formalin-green specimen jars, hanging surgical lamp, numeral-less clock at midnight, floor mist, open lit centre. |
| `art/bg-inquest.webp` | 審問の間: circular theatre-like chamber, ring of empty wooden lecterns around a central floor spotlight, tall shelves of specimen jars, magenta and green accent light. |
| `art/bg-science.webp` | Dark anatomy lecture blackboard with faint chalk-like abstract diagrams (lungs, heart, molecules, arrows), wide calm negative space, no writing. |
| `cases/c01/bg.webp` | Windowless university-basement sample room at night: liquid-nitrogen storage tank, supply dewar with hose, cold vapour on the floor, dead gas monitor, heavy door ajar. |
| `cases/c02/bg.webp` | Japanese riverside park at summer dusk: glove and ball on the grass, low sun flaring toward the viewer, small community building in the distance. |
| `cases/c03/bg.webp` | Winter mountain ridge after a blizzard, whiteout fading, narrow gap between dark rocks, a few discarded clothes scattered on the snow, cold blue light. |
| `art/key-art.webp`, `../og.png` | Title key art: Holma on his crate (right) presenting, with his probe, a floating woman's silhouette made of glowing cyan stained-glass shards (left) in a dark morgue with formalin mist; calm upper-left for the DOM logo. `og.png` is a 1200x630 crop of the same image. |

## Holma's glass eye: red -> amber (2026-09-24, no regeneration)

Reviewers noted that a red eye evokes another game's host mascot, so the design changed to an
**amber taxidermy glass eye (#FFB020)**. The eye was recoloured locally, not regenerated, by
`scripts/art/recolour_eye.py`: the eye is found automatically (most saturated red component inside
the head box around the `face.json` anchor), masked tightly (plus its highlights and rim glints;
the pink nose, open mouths, paw pads and every other red/magenta accent are excluded — 0 pixels
changed outside the mask in the key-art source), and hue-shifted per pixel so shading, the black
rim and the specular highlight are kept. Alpha is bit-exact.
Recoloured: `public/art/holma/*.webp`, `public/art/key-art.webp`, `public/og.png` (and their sources in `art-src/`).
Untouched originals: `art-src/holma/split/*.red-eye.png`, `art-src/key-art/key-art.red-eye.png`,
`art-src/red-eye-originals/`. Before/after crops: `qa/art/eye-recolour-*.png`.
`art-src/holma/holma-sheet.png` is the raw generator output and is still red — use
`art-src/holma/split/*.png` as the character reference from now on.

## Reconstruction panels (batch 2)

`cases/c0N/panel-1..5.webp` (1280x853, from 1536x1024 generations): wordless manga panels, black
ink with screentone on warm off-white paper, one spot colour per case — c01 cyan #3DE0FF, c02 amber
#FFB020, c03 formalin green #C6FF3D. Figures are silhouettes or seen from behind; the victim is
never shown dead, injured or undressed. Briefs: `reconstruction.panels[].scene` in each
`content/cases/*/case.json`; prompts: `scripts/art/jobs_batch2.py` (shared style in `style.py`
`panel_style()` / `PANEL_NEGATIVE`); export: `scripts/art/export_panels.py`.

| Panel | Prompt summary |
|---|---|
| c01 p1 | Dark bedroom, phone glowing cyan on the bedside table, woman with a black bob sitting up in bed from behind, blank clock at ten to one. |
| c01 p2 | Basement corridor at a dutch angle, distant cyan vending-machine glow; she shoulders open a steel fire door; stopped fan behind the grille, door-closer arm. |
| c01 p3 | Storage room: wheeled supply dewar hosed to a tank overflowing with cyan-lit nitrogen fog; she checks boxes in cryo gloves, unaware. |
| c01 p4 | Foreground: frosted gas monitor with a dead black screen; background: her soft silhouette sitting down against a shelf. |
| c01 p5 | Morning: door wedged open, frost and thin cyan mist inside the empty room; a guard from behind radios for help. |
| c02 p1 | Riverside park at dusk: she crouches as catcher (from behind), her brother winds up; truss bridge, amber sky, long shadows. |
| c02 p2 | Catcher's POV: the boy's silhouette right in front of a huge amber setting sun; the ball is lost in the glare. |
| c02 p3 | Abstract side silhouette: the mitt swipes late, the ball touches her chest; an amber heartbeat line with one star just before the wave's crest. |
| c02 p4 | Same riverside field: from behind she holds the ball in her mitt and waves "I'm fine" to the boy; long calm shadows. (take 2) |
| c02 p5 | Only the adults' shoes, hands, a paper fan and a water bottle; the tended person is off-frame; the community hall on the embankment with a single amber light. (take 2) |
| c03 p1 | From behind: the photographer (green cap/fleece) at a tripod on the ridge; a wall of snow cloud rolling in. |
| c03 p2 | Whiteout, diagonal speed lines; her boot plunges off a hidden drift edge; a faint trail-marker pole far to the side. |
| c03 p3 | Night gully: she hunches in a boulder's lee, shivering strokes around her outline. |
| c03 p4 | Clear moonlit night: cap, gloves and jacket dropped along one line of stumbling footprints; her small fully-clothed figure heads for the rocks. |
| c03 p5 | Pre-dawn: two leaning boulders with a narrow crevice; footprints lead inside; no person shown; a thin green dawn line. |

Generation count (whole project): batch 1 = 12, batch 2 = 17 (15 + 2 retakes of c02 p4/p5:
take 1 of p4 drifted to a lakeside hilltop with a church spire; take 1 of p5 had a brand-like
stripe pattern on a running shoe and lost the AED box). Total 29 of the approved ~35.
Retouches (removal only, `scripts/art/retouch.py`, unretouched copies in `art-src/rejected/`):
c01 p4 blurred background wall plaque with a pictogram, c01 p5 emblem-like shoulder patch on the
guard, c03 p1 tiny logo-like mark under the camera screen.

## CASE 04 (batch 3, 2026-09-27)

Seven images for CASE 04「白い花の夕餉」, generated in **one** Codex launch with the
codex-imagegen skill's `batch_imagegen.py` (codex-cli 0.155.0-alpha.16.4, session
`01a0de55-f022-7b41-9388-423196922c7b`, 21 round trips, weekly quota 2.0% → 2.0%). Prompts:
`scripts/art/jobs_batch3.py` (shared `STYLE` / `NEGATIVE` / `panel_style()` / `PANEL_NEGATIVE` from
`style.py`); jobs file `art-src/jobs/batch3-c04.json`; full prompts and validation in
`art-src/manifest.json`. Spot colour for the case: violet #9B6BFF. No existing works or artists are
named; no reference images were used. All seven were accepted on the first take (checked by eye:
no text, letters, numerals, logos, gore or dead body; the victim only from behind; the culprit only
as hands).

| File | Prompt summary |
|---|---|
| `cases/c04/bg.webp` | Night in an old Japanese farmhouse after a spring supper: low table with small bowls (one blue-and-white flower-painted porcelain bowl), vase of white wildflowers, a bamboo basket of flowering wild greens on the step to the earthen kitchen, shoji open onto a moonlit stream; warm paper lamp, violet moonlight. No person. (Returned at 1672x941, cover-resized to 1920x1080.) |
| `cases/c04/portrait.webp` | Chest-up portrait, 38-year-old Japanese botanical illustrator: black hair knotted at the nape with a pencil through it, linen shirt, indigo work apron, gentle observant smile; dark navy ground, violet rim light. **Shifted down 150 px** locally so the head sits inside the shard-bust silhouette (unshifted original: `art-src/rejected/c04-portrait.unshifted.png`). |
| c04 p1 | Morning stream: she (from behind, pencil in her hair) pinches one white-flowered anemone stem into a bamboo basket; flowerless look-alike leaves outlined in violet beside her hand; sketchbook on a mossy rock. |
| c04 p2 | Upstream in the afternoon: gloved hands from dark cardigan cuffs snip violet look-alike leaves with small garden scissors, the other hand holding a bouquet of white wildflowers. No face. |
| c04 p3 | Evening kitchen: a hand sprinkles chopped leaves into the one violet flower-patterned bowl of four on a tray; through the window, an old man in a flat cap and a short-haired woman by a charcoal brazier. |
| c04 p4 | Tatami room, high angle: she (from behind) lifts chopsticks to her violet-patterned bowl; the old man's bowl untouched with chopsticks on the rest; two empty bowls; tempura sprouts; vase of white flowers. |
| c04 p5 | Next day, public-health lab bench: sealed bags of food remains, a container of leftover greens, garden scissors in a bag, the violet-patterned bowl in a bag; microscope and test tubes. No people, no labels. |

Generation count (whole project): batch 1 = 12, batch 2 = 17, batch 3 = 7 (no retakes). Total 36.

## Intro cases CASE 01–03 (batch 4, 2026-09-28)

Eighteen images for the three intro cases (c05「背のびした牛乳びん」, c06「氷点下の雪だるま」,
c07「うなだれたバラ」), generated with the codex-imagegen skill's `batch_imagegen.py` in **one run**
(`--per-exec 9`: the 18 prompts in a single launch exceed the Windows command-line length, so the run
used two launches; codex-cli sessions `01a0e5ff-0aa0-7cf3-971b-0f042e18d4f5` and
`01a0e605-b9f5-7860-928f-9913eabcd8d1`, 10 + 15 round trips, weekly quota 6.0% → 6.0%). Prompts:
`scripts/art/jobs_batch4.py` (its own gentler `STYLE_INTRO` / `panel_style_intro()` on the shared
`NEGATIVE` / `PANEL_NEGATIVE` of `style.py`); jobs `art-src/jobs/batch4-intro.json`; full prompts and
validation in `art-src/manifest.json`. Spot colours: c05 cornflower blue #6FA8FF, c06 sunlight yellow
#FFD84A, c07 rose red #E8435A. The victims are objects, so each "portrait" is a still life on the dark
navy ground, and the shard mask (`victim.silhouette`) is traced from it by `scripts/art/trace_silhouette.py`.
No existing works or artists are named; no reference images were used; Holma does not appear.

Checked by eye; nine takes broke the rules and were regenerated (originals in `art-src/rejected/*.take1|2.png`):
c05 p1 (orange sky and skin tones: more than one colour), c06 bg take 1 (the surviving snowman wore a
yellow scarf, carrot noses), c06 p2 and p3 (carrot noses and a hat in colour), c06 p4 (the children's
faces shown), c07 p2 (blue sky), c07 p3 (a child's face and green stems), then c06 bg and p3 take 2
(footprints that read as animal paw prints — the case says there are none). The retakes: one launch of
7 (session `01a0e60f-3a17-79e2-a142-bbcbccc6c258`) and one of 2 (session
`01a0e616-cd8c-7b90-ab02-d6a733a64682`; Codex generated both but saved neither to its path, so they were
taken from its `generated_images` folder — one 16:9 background and one 3:2 panel, unambiguous — and
checked by eye).

| File | Prompt summary |
|---|---|
| `cases/c05/bg.webp` | A Japanese home kitchen on a summer night: the fridge's top freezer door ajar with cold blue light and mist, barley tea, an empty jar, a wind chime in the dark window. No person. |
| `cases/c05/portrait.webp` | Still life: a glass milk bottle full of milk with a round blank paper cap, condensation beads; dark navy ground, blue rim light. |
| c05 p1 | A small boy from behind, on tiptoe, puts a full milk bottle (blue milk) into the freezer beside a half-full one. |
| c05 p2 | Inside the dark freezer: two bottles, ice (blue) growing inward from the glass and the surface. |
| c05 p3 | Close-up: a blue column of frozen milk rises from the neck and lifts the cap; cracks on the shoulder. |
| c05 p4 | Morning: a hand holds the freezer door; the cracked bottle with its white column, the half bottle intact with a domed surface. |
| `cases/c06/bg.webp` | A snowy garden of a Japanese house on a clear afternoon: a headless snowman beside its fallen head and a dark scarf, a whole snowman without a scarf, children's boot prints, two shovels, a thermometer (blank) under the eaves. |
| `cases/c06/portrait.webp` | Still life: a two-ball snowman with charcoal eyes and buttons, twig arms and a dark knitted scarf; no nose; yellow rim light. |
| c06 p1 | Two children from behind building two snowmen; the girl wraps her dark scarf on hers. |
| c06 p2 | Close-up: yellow sunlight on the dark scarf, drops of melt water under it, sunken charcoal eyes, icicles behind. |
| c06 p3 | The thin-necked snowman's head fallen beside its body and scarf; the other snowman standing; only boot prints. |
| c06 p4 | Gloved hands only: a black cloth sunk into the sunny snow, a white cloth still on the surface. |
| `cases/c07/bg.webp` | **Replaced 2026-09-29** (see below). Was: a dining table at dawn with the bowed rose in its vase (now `art-src/rejected/c07-bg.rose-visible.png`). |
| `cases/c07/portrait.webp` | Still life: a long-stemmed red rose in full bloom with leaves and thorns; red rim light. |
| c07 p1 | A flower shop: a girl from behind receives two paper-wrapped roses; the florist's hands show cutting a stem inside a bucket of water. |
| c07 p2 | A child's room: the paper-wrapped rose hidden on a sunny windowsill, no water. |
| c07 p3 | A woman's hands cut the stem with kitchen scissors in the air over the sink; a small magnified circle of a tube with an air bubble; a vase of water. |
| c07 p4 | Next morning: the rose bowed in the full vase; through the window, the other rose upright next door. |

Generation count (whole project): batch 1 = 12, batch 2 = 17, batch 3 = 7, batch 4 = 18 + 9 retakes. Total 63.

## c07 background without the rose (2026-09-29)

c07 now starts without telling whether "she" is a person or a rose (docs/decisions.md 2026-09-29), so
its background may not show a flower, a vase or a plant. One image, generated with the codex-imagegen
skill's `batch_imagegen.py` (one launch, codex-cli session `01a0ea95-1945-72a0-8ace-fde80d0db9e6`,
5 round trips, weekly quota 21.0% → 21.0%); job `art-src/jobs/c07-bg-neutral.json`, full prompt in
`art-src/manifest.json`. Same intro-case style (ink navy, bone white, cold teal, rose red #E8435A as the
single accent). Returned at 1672x941, cover-resized to 1920x1080 (`export_art.py` helpers). Retouched
locally: a darker red blotch in the sunrise light on the left chair seat, which could read as a stain,
was inpainted (OpenCV Telea) from its surroundings. No reference images; no people, animals or text.

| File | Prompt summary |
|---|---|
| `cases/c07/bg.webp` | A quiet Japanese dining room at dawn seen from the doorway: a bare wooden table (a folded napkin, an empty wooden tray), four chairs with one pulled back, a plain geometric lace curtain, a blank clock face, plain white dishes on a sideboard, the next house's roof in the window; a thin streak of rose-red sunrise light. No flowers, vase, plants, animals or people. |

`cases/c07/shards.webp` (not generated): the picture c07's lit shards show before the solve
(`victim.shardPortrait`), so the rose portrait does not appear piece by piece. A 627x941 crop of
`art-src/bg/c07-bg.png` (x 330–957: the lace-curtained window, the table and two chairs), resized to
1024x1536, webp q88.


## CASE 01 human tutorial case (batch 5, 2026-09-29)

The new CASE 01「たたみかけのタオル」(c08): a 62-year-old woman stung by a paper wasp hidden in a bath
towel, a year after an earlier sting (anaphylaxis). Seven images from ONE `batch_imagegen.py` launch
(codex-imagegen skill; session `01a0eaa1-e97f-7fe0-8fd3-244b0005710a`, 16 round trips, weekly quota
21.0% → 21.0%). Prompts: `scripts/art/jobs_batch5.py` (its own quieter `STYLE_C08` / `panel_style()` on
the shared `NEGATIVE` / `PANEL_NEGATIVE` of `style.py`); jobs `art-src/jobs/batch5-c08.json`; full prompts
and validation in `art-src/manifest.json`. Spot colour: late-summer tangerine #FF8A3D. The victim is shown
alive only (the portrait; in the panels from behind or as hands), never lying down; the husband is a
featureless silhouette. No existing works or artists are named; no reference images were used.

Checked by eye. One retake: the portrait (take 1 put the head too high and left of the bust shard mask,
x 72–228 / y 52–270 of the 300×400 box). Retake with exact framing numbers in one launch of 1 (session
`01a0eaaf-6519-7fa3-9cf7-88f54ade3f69`, weekly quota 21.0% → 22.0%); Codex generated it but did not save it
to its path, so it was taken from its `generated_images` folder (the only image of that session) and
checked by eye. Take 1 is `art-src/rejected/c08-portrait.take1.png`. The background came back at
1672×941 and is resized to 1920×1080 by `export_art.py` like the others.

| File | Prompt summary |
|---|---|
| `cases/c08/bg.webp` | The second-floor tatami room on a hot early-September afternoon: open glass doors to a balcony with laundry on a pole, a laundry basket, folded towels and one half-folded bath towel, barley tea, a phone face down, air-conditioner and fan. No person, no insect. |
| `cases/c08/portrait.webp` | Chest-up portrait: a 62-year-old Japanese woman with short grey-streaked hair and laugh lines, pale linen blouse, warm smile; dark navy ground, tangerine rim light. Alive and healthy. |
| c08 p1 | The summer before: a woman in a straw hat, from behind, holds up her right hand — its back and wrist swollen (tangerine); a paper wasp flies off. |
| c08 p2 | The balcony: a paper wasp (tangerine) crawls into the fold of a hanging bath towel; a small nest under the eaves. No person. |
| c08 p3 | Over the shoulder: she gathers the towel off the pole; a tiny tangerine flash of a sting at the wrist; a half-full basket. |
| c08 p4 | The cool tatami room: she sits among the laundry from behind, a hand at her collar, a phone in the other; tangerine hives on the hand and a dizzy ripple around her head. Upright and alive. |
| c08 p5 | Evening: the half-folded towel (tangerine) on the tatami beside the basket; a black backlit silhouette of a man at the doorway. Nobody lying anywhere. |

Generation count (whole project): batch 1 = 12, batch 2 = 17, batch 3 = 7, batch 4 = 18 + 9 retakes, c07 bg rework = 1, batch 5 = 7 + 1 retake. Total 72.

## Prototype case「助けられた朝」(batch 6, 2026-10-04)

The prototype case c09「助けられた朝」(shown only with `?proto=seeds`; 事件の種 No.4): a 36-year-old
librarian pinned overnight under her late father's old car when an old hydraulic jack leaked, pulled out
by her estranged brother, who collapses minutes later (crush syndrome). Seven images from ONE
`batch_imagegen.py` launch (codex-imagegen skill, re-read before generating; session
`01a10291-5523-75c3-81a3-64f81d5f0ece`, 16 round trips, 420 s, weekly quota 10.0% → 10.0%). Prompts:
`scripts/art/jobs_batch6.py` (its own `STYLE_C09` / `panel_style()` on the shared `NEGATIVE` /
`PANEL_NEGATIVE` of `style.py`); jobs `art-src/jobs/batch6-c09.json`; full prompts and validation in
`art-src/manifest.json`. Spot colour: pale dawn mint #5EE6B4, used for light (the work lamp, the
morning light, the blanket, a phone screen). The victim is shown alive only (the portrait; in the panels
from behind, as her legs in sneakers under the car, or wrapped in a blanket), never lying collapsed; the
brother is a featureless silhouette. No existing works or artists are named; no reference images.

Checked by eye. Two retakes, both for the story, not for style: panel 2 take 1 put a standing man's
silhouette in the garage at night (it would say someone was there), panel 3 take 1 drew the woman
kneeling beside the car while her brother arrived (she is trapped under it). Retakes in one launch of 2
(session `01a10299-b263-7ee1-9526-23dfdc857222`, 9 round trips, weekly quota 10.0% → 10.0%; prompts
spell out "nobody else" / "only her sneakers under the car", `art-src/jobs/batch6-retry.json`). Codex
generated both but did not copy them to their paths (the take-1 files were still there); they were taken
from its `generated_images` folder and matched to the items by looking at each picture (p2 = night, the
jack and the oil, no person; p3 = morning, the brother at the shutter), as recorded in the manifest
(`recovered_from`). Take 1 of both is in `art-src/rejected/`. The background came back at 1672×941 and
is resized to 1920×1080; panels are cover-resized to 1024×683, the portrait kept at 1024×1536 (the
`export_art.py` / `export_panels.py` helpers, run for c09 only so the other cases' files stay untouched).
The portrait sits in the bust shard mask like c08's (checked with the mask drawn over it).

| File | Prompt summary |
|---|---|
| `cases/c09/bg.webp` | A home garage on a freezing January morning: an old boxy sedan lifted on one side by a single small bottle jack (no stands), a dark oil stain under it, flattened cardboard, a work lamp, a workbench with tools and a phone face down, the roller shutter open to frost and pale mint morning light. No person. |
| `cases/c09/portrait.webp` | Chest-up portrait: a 36-year-old Japanese woman, dark hair in a low ponytail, grey knit sweater and an open navy work jacket, calm faint smile; dark navy ground, mint rim light. Alive and healthy. |
| c09 p1 | Night, shutter closed: the car up on one old bottle jack; only her legs in work trousers and white sneakers stick out from under it; the work lamp glows mint; far away, the phone glows on the workbench. |
| c09 p2 | Low at floor level: dark oil runs down the old jack into a puddle (a mint glint of lamp light); the car has sunk; her sneakers still under the sill. Nobody else. (take 2) |
| c09 p3 | Morning: the shutter up, mint winter light; the brother's black silhouette in the doorway with a scissor jack; the sunken car with her sneakers under it. (take 2) |
| c09 p4 | The car raised high; she sits on the floor from behind, wrapped in a mint blanket; the brother's silhouette crouches beside her, a hand on her shoulder. |
| c09 p5 | Floor level: a man's hand holds a phone with a blank mint screen (the call); behind, the empty blanket slipped down and one sneaker on its side. Nobody lying anywhere. |

Generation count (whole project): batch 1 = 12, batch 2 = 17, batch 3 = 7, batch 4 = 18 + 9 retakes, c07 bg rework = 1, batch 5 = 7 + 1 retake, batch 6 = 7 + 2 retakes. Total 81.
