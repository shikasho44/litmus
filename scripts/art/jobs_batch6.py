"""Writes art-src/jobs/batch6-c09.json: the 7 images of the prototype case「助けられた朝」(c09, 2026-10-04).

    background   art-src/bg/c09-bg.png              -> public/cases/c09/bg.webp        (export_art.py bg)
    portrait     art-src/portraits/c09-portrait.png -> public/cases/c09/portrait.webp  (export_art.py portraits)
    panels 1-5   art-src/panels/c09-panel-N.png     -> public/cases/c09/panel-N.webp   (export_panels.py)

Usage (from the project root). ONE batch_imagegen.py run for all seven (codex-imagegen skill):
    python scripts/art/jobs_batch6.py
    python "%USERPROFILE%/.claude/skills/codex-imagegen/scripts/batch_imagegen.py" \
        --jobs <abs>/art-src/jobs/batch6-c09.json --manifest <abs>/art-src/manifest.json
    python scripts/art/export_art.py bg portraits
    python scripts/art/export_panels.py --sheet

    python scripts/art/jobs_batch6.py c09-panel-3   # writes batch6-retry.json with only those items

The case (a prototype behind ?proto=seeds, from 事件の種 No.4): on a January morning a 36-year-old
librarian is pulled out from under her late father's old car by her estranged older brother; she
thanks him, smiles, and collapses minutes later (crush syndrome after a night pinned under the car
when an old hydraulic jack leaked). She is shown alive only: in the portrait (calm, healthy) and, in
the panels, from behind, as a silhouette, or only her legs in work trousers and sneakers sticking out
from under the car (never injured-looking, never lying collapsed). Her brother is a featureless
silhouette. Spot colour: dawn mint #5EE6B4 (c01 cyan, c02 amber, c03 green, c04 violet, c05 blue,
c06 yellow, c07 rose, c08 tangerine), used for light: the work lamp, the morning light, the blanket,
a phone screen. No existing works or artists are named. No text anywhere.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, NEGATIVE, PANEL_NEGATIVE  # noqa: E402

ACCENT = ("pale dawn mint green", "#5EE6B4")

# Same ink-and-screentone DNA as style.STYLE (and c08's quieter variant), cold winter mood.
STYLE_C09 = (
    "Art style: bold graphic-novel illustration, confident black ink linework, flat cel shading "
    "with subtle halftone screentone dots in the shadows, limited palette (ink navy #0B0D12, "
    "bone white #F2EFE6, cold teal shadows #1B3A44) plus the single accent colour given in this prompt, "
    "theatrical lighting, stylish and elegant, quiet, cold and gently mysterious mood, never "
    "frightening. Polished key-visual quality for a premium mystery adventure video game."
)

CAR_AND_JACK = (
    "Objects to draw accurately when they appear: an old 1980s boxy compact sedan; a small old "
    "hydraulic bottle jack (a short upright cylinder with a pump lever socket) under the side of the car, "
    "with no jack stands anywhere; a garage with a concrete floor, a roller shutter door, a wooden "
    "workbench with hand tools, and a clamp-on work lamp."
)

CAST = (
    "Recurring characters in this story: a Japanese woman in her mid-thirties with a low ponytail, "
    "wearing a dark navy work jacket over a sweater, work trousers and white sneakers; she is ONLY ever "
    "seen from behind, as a silhouette, or as her legs from the knees down; her face is never shown. "
    "She is never shown injured and never lying collapsed. Her older brother, a man around forty in a "
    "winter coat, appears only as a dark featureless silhouette seen from behind or from the side."
)

# p3 (take 2, 2026-10-04): take 1 drew her kneeling beside the car while her brother arrived.
CAST_P3 = (
    "Characters in this panel: only her older brother, a man around forty in a winter coat, as a dark "
    "featureless silhouette. The woman is still trapped under the car: of her, only two white sneakers "
    "show under the car's side sill. Nobody else."
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
        "hue anywhere: no skin tones, no blue sky, no red, no brown oil, no wood colours, no car paint "
        "colour outside the spot colour. Clear, readable composition, strong silhouettes, deep blacks, "
        "quiet, cold and gently mysterious mood, respectful and non-graphic, never scary. "
        "People are drawn from behind or as silhouettes, or only their legs or hands; faces are NEVER "
        "shown, no front or three-quarter view of anyone's face. Premium published graphic-novel quality."
    )


PANELS = [
    # p1 — the night before: she slides under the car held up by one old jack; the phone far away
    "Scene: late at night inside a small home garage with the roller shutter closed. An old boxy "
    "sedan is lifted on one side by a single small hydraulic bottle jack; no jack stands. A woman lies "
    "on her back on a flattened cardboard sheet and has slid under the side of the car: only her legs "
    "from the knees down, in work trousers and white sneakers, stick out from under the car. A clamp "
    "work lamp hooked under the car throws a narrow beam of light; the lamp glow is pale dawn mint "
    "(the spot colour). Far across the garage, on a wooden workbench, a smartphone lies face up with a "
    "small blank glowing screen, also in the spot colour, clearly out of reach. Quiet, ordinary, a "
    "faint unease.",
    # p2 — in the night: the old jack leaks; the car has sunk; her sneakers do not move
    "Scene: the same garage later in the night, seen from very low near the concrete floor. In the "
    "foreground, the old hydraulic bottle jack: a thin trickle of dark oil runs down its side into a "
    "black puddle spreading across the concrete, drawn in black ink with a single cold pale mint "
    "highlight of the work-lamp light glinting on the oil surface (the spot colour, the ONLY colour). "
    "Behind it, the side of the car has sunk much lower than before; under the car's side sill, two "
    "white sneakers rest motionless on the cardboard. No blood, no injury, nothing graphic, only the "
    "sunken car, the oil and the still sneakers. Nobody else is in the garage: NO standing person, NO figure, NO silhouette anywhere in the picture (it is the middle of the night and she is alone).",
    # p3 — the morning: the shutter goes up; the brother's silhouette with a second jack
    "Scene: the next morning, seen from inside the garage, low near the floor. The roller shutter has "
    "just been pushed up and cold, pale winter morning light floods in across the concrete floor; the "
    "light is pale dawn mint (the spot colour, the ONLY colour). Outside, frost on the ground and bare "
    "trees. In the bright doorway stands the solid black, featureless silhouette of a man in a winter "
    "coat, breathless, a small scissor jack in one hand. In the foreground, low and dark, the sunken "
    "side of the old car resting low on the leaking bottle jack, with a black oil puddle; under the "
    "car's side sill only two white sneakers are visible, still. The woman herself is NOT visible: no "
    "kneeling, sitting or standing woman anywhere, only the sneakers under the car. Urgent, hopeful.",
    # p4 — rescued: she sits wrapped in a blanket and smiles at her brother (from behind)
    "Scene: a few minutes later in the same garage, morning light from the open shutter. The old car "
    "now stands raised high on a scissor jack in the background. In the foreground a woman with a low "
    "ponytail, seen strictly from behind, sits upright on the concrete floor, wrapped in a thick "
    "blanket from the shoulders down, her legs hidden under it; the blanket is pale dawn mint (the "
    "spot colour, the ONLY colour). Beside her, the dark silhouette of her brother crouches in profile, "
    "one hand resting on her shoulder; she tilts her head toward him as if saying thank you. Warm, "
    "relieved, tender; nothing graphic.",
    # p5 — minutes later: the fallen blanket, the brother's hand on the phone (no body shown)
    "Scene: minutes later, close-up at floor level in the same garage. In the foreground, a man's "
    "hand (dark silhouette, no face) grips a smartphone whose screen glows blank and bright pale dawn "
    "mint (the spot colour, the ONLY colour) as he makes an urgent call. Behind it, slightly out of "
    "focus on the concrete floor, the thick blanket lies slipped down and empty, and one white sneaker "
    "lies on its side. Nobody lying anywhere, no body, no figure on the floor; only the empty blanket, "
    "the sneaker and the hand with the phone. Still, quiet, a sudden sense of loss.",
]

BG = f"""
Wide 16:9 background illustration for a mystery adventure video game, no characters.
Scene: the inside of a small home garage of an old suburban Japanese house on a freezing January
morning. An old boxy 1980s compact sedan is lifted on one side by a single small hydraulic bottle jack,
with no jack stands; under the jack a dark oil stain has spread across the concrete floor. A flattened
cardboard sheet lies half under the side of the car. A clamp-on work lamp hangs from the car, still
glowing faintly. Against the wall, a wooden workbench with neatly arranged hand tools, a few car parts
and a smartphone lying face down. The roller shutter door is half open: cold, pale winter morning light
and frost outside. The morning light and the lamp glow have a pale dawn mint (#5EE6B4) tint. Quiet,
still, faintly uneasy. No person, no body, no blood.
{STYLE_C09}
Composition: the key subjects (the car, the jack and its oil stain, the workbench) are kept inside the
central 60% of the width so the image can be cropped to a narrower frame, with clean readable depth and
atmospheric perspective.
{NEGATIVE}
"""

PORTRAIT = f"""
Chest-up bust portrait of a fictional character for a mystery adventure game. Plain, solid,
very dark navy background (#0B0D12), uniform with no objects, with a soft pale dawn mint rim light
(#5EE6B4 fading into #1B3A44) tracing the edge of the hair and one shoulder.
Subject: a 36-year-old Japanese woman who works as a librarian at a city library and restores her late
father's old car as a hobby. Dark hair tied back in a neat low ponytail with a few loose strands at the
temples; calm, thoughtful eyes; a natural, clean face with no make-up beyond a little lip colour; a soft
grey knit sweater with a plain crew neck under an open dark navy work jacket. Calm, quietly warm,
faintly smiling, alive and healthy.
Framing (important, the image is later cut into glass shards along a fixed bust silhouette, so
follow these proportions exactly): the face is exactly centred horizontally, the nose on the
vertical centre line of the image; the head faces the viewer, turned only very slightly; there is
empty dark background above the head: the top of the hair sits about 17% below the top edge; the
chin sits about 63% down from the top edge; the head including the hair is about 50% of the image
width, with even dark margins on the left and the right; the neck and both shoulders fill the lower
part symmetrically and reach the bottom edge. Eyes open.
Painterly graphic-novel rendering with ink linework, flat cel shading and subtle halftone
screentone. {STYLE_C09}
The person is healthy and uninjured: NOT a corpse, NO injuries, NO bruises, NO swelling, NO tears.
{NEGATIVE}
"""


def build_jobs() -> list[dict]:
    name, hexv = ACCENT
    jobs = [
        {"prompt": BG.strip(), "out": (ART_SRC / "bg" / "c09-bg.png").as_posix(), "size": "2048x1152",
         "quality": "high", "note": "background c09-bg (prototype case 「助けられた朝」, ?proto=seeds)"},
        {"prompt": PORTRAIT.strip(), "out": (ART_SRC / "portraits" / "c09-portrait.png").as_posix(),
         "size": "1024x1536", "quality": "high", "note": "victim portrait c09 (prototype case, ?proto=seeds)"},
    ]
    for i, scene in enumerate(PANELS, start=1):
        # p2 is the night alone (no cast at all, or a second figure appears); p3 shows only her sneakers
        cast = "" if i == 2 else CAST_P3 if i == 3 else CAST
        parts = [
            "One panel of a wordless five-panel story sequence for a mystery adventure video game.",
            scene,
            *([cast] if cast else []),
            CAR_AND_JACK,
            panel_style(name, hexv),
            PANEL_NEGATIVE,
        ]
        jobs.append({"prompt": "\n\n".join(parts), "out": (ART_SRC / "panels" / f"c09-panel-{i}.png").as_posix(),
                     "size": "1536x1024", "quality": "high", "note": f"reconstruction panel c09 p{i} (prototype case, ?proto=seeds)"})
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
        out = jobs_dir / "batch6-retry.json"
    else:
        out = jobs_dir / "batch6-c09.json"
    out.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(jobs)} jobs to {out}")


if __name__ == "__main__":
    main()
