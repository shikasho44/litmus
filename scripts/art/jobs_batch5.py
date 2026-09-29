"""Writes art-src/jobs/batch5-c08.json: the 7 images of CASE 01「たたみかけのタオル」(c08, 2026-09-29).

    background   art-src/bg/c08-bg.png              -> public/cases/c08/bg.webp        (export_art.py bg)
    portrait     art-src/portraits/c08-portrait.png -> public/cases/c08/portrait.webp  (export_art.py portraits)
    panels 1-5   art-src/panels/c08-panel-N.png     -> public/cases/c08/panel-N.webp   (export_panels.py)

Usage (from the project root). ONE batch_imagegen.py run for all seven (codex-imagegen skill):
    python scripts/art/jobs_batch5.py
    python "%USERPROFILE%/.claude/skills/codex-imagegen/scripts/batch_imagegen.py" \
        --jobs <abs>/art-src/jobs/batch5-c08.json --manifest <abs>/art-src/manifest.json
    python scripts/art/export_art.py bg portraits
    python scripts/art/export_panels.py --sheet

    python scripts/art/jobs_batch5.py c08-panel-3   # writes batch5-retry.json with only those items

The first case (since 2026-09-29) is a human Jane Doe again, but a gentle, everyday one for first-time
players: a woman in her early sixties, stung by a paper wasp hidden in the laundry, a year after an
earlier sting. She is shown alive only: in the portrait (calm, healthy) and, in the panels, from behind
or as hands; never lying down, never dead, never injured-looking. The wasp is drawn plainly (no horror).
Spot colour: late-summer tangerine #FF8A3D (c01 cyan, c02 amber, c03 green, c04 violet, c05 blue,
c06 yellow, c07 rose). No existing works or artists are named. No text anywhere.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, NEGATIVE, PANEL_NEGATIVE  # noqa: E402

ACCENT = ("late-summer tangerine orange", "#FF8A3D")

# Same ink-and-screentone DNA as style.STYLE, with a quieter, tender mood for the tutorial case.
STYLE_C08 = (
    "Art style: bold graphic-novel illustration, confident black ink linework, flat cel shading "
    "with subtle halftone screentone dots in the shadows, limited palette (ink navy #0B0D12, "
    "bone white #F2EFE6, cold teal shadows #1B3A44) plus the single accent colour given in this prompt, "
    "theatrical lighting, stylish and elegant, quiet, tender and gently mysterious mood, never "
    "frightening. Polished key-visual quality for a premium mystery adventure video game."
)

WASP = (
    "Insect to draw accurately when it appears: a Japanese paper wasp (Polistes), a slender wasp "
    "with a narrow waist and long legs that dangle below it in flight; drawn small and plainly, "
    "like a nature illustration, not a monster."
)

CAST = (
    "Recurring character in this story: a Japanese woman in her early sixties with short, softly "
    "layered grey-streaked dark hair, wearing a pale short-sleeved linen blouse; she is ONLY ever seen "
    "from behind, as a silhouette, or as her hands and forearms; her face is never shown. She is "
    "always alive, upright and never shown lying on the floor. Her husband appears only as a dark "
    "silhouette seen from behind."
)


def panel_style(accent_name: str, accent_hex: str) -> str:
    return (
        "Format: ONE single wordless (silent) manga / graphic-novel panel that fills the whole "
        "canvas edge to edge: full bleed, no panel border, no gutter, no multi-panel page layout. "
        "Art style: bold confident black ink brush and pen linework, crisp cross-hatching and "
        "printed dot screentone (halftone) for all greys and shadows, on warm off-white paper "
        "(#F2EAD8). STRICTLY MONOCHROME: everything is black ink and neutral grey screentone on the "
        "cream paper EXCEPT for ONE single spot accent "
        f"colour, {accent_name} ({accent_hex}), used sparingly only where the scene says. No other "
        "hue anywhere: no skin tones, no blue sky, no green leaves, no wood colours, no yellow wasp "
        "stripes outside the spot colour. Clear, readable composition, strong silhouettes, deep blacks, "
        "quiet, tender and gently mysterious mood, respectful and non-graphic, never scary. "
        "People are drawn from behind or as silhouettes, or only their hands; faces are NEVER shown, "
        "no front or three-quarter view of anyone's face. Premium published graphic-novel quality."
    )


PANELS = [
    # p1 — the summer before: a sting on the back of the hand, a big swelling, nothing more
    "Scene: a small home garden on a bright summer morning, one year earlier. A woman in a wide "
    "straw sun hat and cotton gardening gloves, seen from behind and slightly to the side, kneels by "
    "a low flowering shrub with small pruning shears on the ground. She has pulled off one glove and "
    "holds up her right hand, looking at it: the back of the hand and the wrist are clearly puffed "
    "up and swollen, the swelling tinted tangerine orange (the spot colour, the ONLY colour). A "
    "single slender paper wasp flies away into the leaves, drawn in black ink. Calm, a small wince, "
    "nothing dramatic.",
    # p2 — the afternoon: the wasp creeps into the fold of a bath towel on the balcony
    "Scene: a sunny early-September afternoon on the small balcony of a Japanese two-storey house. "
    "Freshly washed laundry hangs on a pole: bath towels, a shirt, a few small towels on a round "
    "peg hanger, gently lifted by the breeze. Close to the viewer, a single slender paper wasp "
    "crawls into the soft fold of a hanging bath towel; the wasp is tangerine orange (the spot "
    "colour, the ONLY colour). Under the eaves in the upper corner, a small grey umbrella-shaped "
    "paper wasp nest, drawn in ink. Bright, ordinary, a quiet hint of danger. No person.",
    # p3 — the moment: she gathers the towel; a tiny sting on the inner wrist
    "Scene: over-the-shoulder view from behind a woman on the balcony (only her hair from behind, "
    "her shoulder in a short-sleeved blouse, and her hands are visible; no face). She gathers a bath towel off "
    "the laundry pole into her arms. At the soft inner side of her left wrist, pressed against the "
    "towel's fold, a tiny sharp star-shaped flash marks a sting, and a few short radiating lines "
    "surround it; the flash is tangerine orange (the spot colour, the ONLY colour). A laundry basket "
    "at her feet, half full. No blood, no wound drawn. A small, sudden 'ouch' moment.",
    # p4 — minutes later: itching, swelling, dizziness; she sits down among the laundry
    "Scene: minutes later inside a quiet Japanese tatami room next to the balcony window, cool and "
    "shaded. A woman seen strictly from behind sits down on the tatami among half-folded laundry, "
    "one hand pressed to her collar, the other loosely holding a smartphone whose screen is "
    "blank. On the back of that hand and around the wrist, a faint scattered pattern of raised blotches "
    "(hives), and a soft woozy ripple in the air around her head to suggest dizziness; the blotches "
    "and the ripple are tangerine orange (the spot colour, the ONLY colour). She is sitting upright, "
    "alive; she is NOT lying down. An electric fan and a glass of barley tea nearby. Uneasy, quiet, "
    "tender, not frightening.",
    # p5 — evening: the half-folded towel, the husband's silhouette at the sliding door
    "Scene: early evening in the same tatami room, seen from low near the floor. In the foreground "
    "a single half-folded bath towel rests on the tatami beside a laundry basket, lit by the low "
    "evening light from the balcony window; the towel is tangerine orange (the spot colour, the ONLY "
    "colour). In the far background, the solid black, featureless, backlit silhouette of a man (no "
    "face, no features at all) stands in the open sliding door of the room, one hand still on the "
    "door frame, just coming home. No other person "
    "in the picture, nobody lying anywhere, no body. Still, quiet, a gentle sense of loss.",
]

BG = f"""
Wide 16:9 background illustration for a mystery adventure video game, no characters.
Scene: the second-floor tatami room of an ordinary Japanese house on a hot, bright early-September
afternoon. Sliding glass doors stand open onto a small balcony where freshly washed laundry still
hangs on a pole (a few bath towels, a shirt), stirring in the breeze; beyond it a clear pale sky and
the rooftops of the neighbourhood. Inside, the room is cool and shaded: a woven laundry basket on the
tatami, a small neat stack of folded towels and one bath towel only half folded, a glass of barley
tea on a tray, a smartphone lying face down, a wall air-conditioner. The light from the balcony has a
warm late-summer tangerine (#FF8A3D) tint. Quiet, homely, faintly uneasy. No person, no body, no insect.
{STYLE_C08}
Composition: the key subjects are kept inside the central 60% of the width so the image can be
cropped to a narrower frame, with clean readable depth and atmospheric perspective.
{NEGATIVE}
"""

PORTRAIT = f"""
Chest-up bust portrait of a fictional character for a mystery adventure game. Plain, solid,
very dark navy background (#0B0D12), uniform with no objects, with a soft tangerine orange rim light
(#FF8A3D fading into #1B3A44) tracing the edge of the hair and one shoulder.
Subject: a 62-year-old Japanese woman who works part-time at a neighbourhood bakery. Short, neat,
softly layered dark hair with natural grey streaks, lying close to the head (not voluminous); kind
eyes with gentle laugh lines; natural, clean face with no make-up beyond a little lip colour; a pale
short-sleeved linen blouse with a simple round collar. Warm, calm, cheerful, quietly smiling, alive
and healthy.
Framing (important, the image is later cut into glass shards along a fixed bust silhouette, so
follow these proportions exactly): the face is exactly centred horizontally, the nose on the
vertical centre line of the image; the head faces the viewer, turned only very slightly; there is
empty dark background above the head: the top of the hair sits about 17% below the top edge; the
chin sits about 63% down from the top edge; the head including the hair is about 50% of the image
width, with even dark margins on the left and the right; the neck and both shoulders fill the lower
part symmetrically and reach the bottom edge. Eyes open.
Painterly graphic-novel rendering with ink linework, flat cel shading and subtle halftone
screentone. {STYLE_C08}
The person is healthy and uninjured: NOT a corpse, NO injuries, NO swelling, NO rash, NO tears.
{NEGATIVE}
"""


def build_jobs() -> list[dict]:
    name, hexv = ACCENT
    jobs = [
        {"prompt": BG.strip(), "out": (ART_SRC / "bg" / "c08-bg.png").as_posix(), "size": "2048x1152",
         "quality": "high", "note": "background c08-bg (CASE 01 wasp in the laundry)"},
        {"prompt": PORTRAIT.strip(), "out": (ART_SRC / "portraits" / "c08-portrait.png").as_posix(),
         "size": "1024x1536", "quality": "high", "note": "victim portrait c08 (CASE 01)"},
    ]
    for i, scene in enumerate(PANELS, start=1):
        parts = [
            "One panel of a wordless five-panel story sequence for a mystery adventure video game.",
            scene,
            CAST,
        ]
        if i in (1, 2, 3):
            parts.append(WASP)
        parts += [panel_style(name, hexv), PANEL_NEGATIVE]
        jobs.append({"prompt": "\n\n".join(parts), "out": (ART_SRC / "panels" / f"c08-panel-{i}.png").as_posix(),
                     "size": "1536x1024", "quality": "high", "note": f"reconstruction panel c08 p{i} (CASE 01)"})
    return jobs


def main() -> None:
    jobs_dir = ART_SRC / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    for sub in ("bg", "portraits", "panels"):
        (ART_SRC / sub).mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    jobs = build_jobs()
    if only:
        jobs = [j for j in jobs if Path(j["out"]).stem in only]
        out = jobs_dir / "batch5-retry.json"
    else:
        out = jobs_dir / "batch5-c08.json"
    out.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(jobs)} jobs to {out}")


if __name__ == "__main__":
    main()
