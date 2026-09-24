# Art credits — ジェーンドゥの死因

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
Recoloured: `art/holma/*.webp`, `art/key-art.webp`, `../og.png` (and their sources in `art-src/`).
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
