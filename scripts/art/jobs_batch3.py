"""Writes art-src/jobs/batch3-c04.json: the 7 images of CASE 04 (2026-09-27).

    background   art-src/bg/c04-bg.png              -> public/cases/c04/bg.webp        (export_art.py bg)
    portrait     art-src/portraits/c04-portrait.png -> public/cases/c04/portrait.webp  (export_art.py portraits)
    panels 1-5   art-src/panels/c04-panel-N.png     -> public/cases/c04/panel-N.webp   (export_panels.py)

Usage (from the project root). ONE Codex launch for all seven (codex-imagegen skill,
batch_imagegen.py — not one process per image):
    python scripts/art/jobs_batch3.py
    python "%USERPROFILE%/.claude/skills/codex-imagegen/scripts/batch_imagegen.py" \
        --jobs <abs>/art-src/jobs/batch3-c04.json --manifest <abs>/art-src/manifest.json
    python scripts/art/export_art.py bg portraits
    python scripts/art/export_panels.py --sheet

    python scripts/art/jobs_batch3.py c04-panel-3   # writes batch3-retry.json with only those items

Briefs: content/cases/c04-white-flower-supper/case.json (reconstruction.panels[].scene,
victim.lookBrief). Spot colour for CASE 04: violet #9B6BFF (c01 cyan, c02 amber, c03 green).
The victim is never shown dead, injured or undressed; the other people appear only as hands,
silhouettes or figures seen from behind. No existing works or artists are named.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, NEGATIVE, PANEL_NEGATIVE, STYLE, panel_style  # noqa: E402

ACCENT = ("soft luminous violet", "#9B6BFF")

# The two plants must read as look-alikes: that is the whole misdirection of the case.
PLANTS = (
    "Botany to draw accurately: the edible spring wildflower is a low woodland anemone with small "
    "white five-petalled flowers held up on thin stalks, usually TWO flowers per stem, above a whorl "
    "of deeply three-parted, finely toothed soft leaves. The look-alike poisonous plant, not in "
    "flower in spring, has glossier palmately and deeply divided leaves of almost the same shape "
    "and size, growing mixed among the white-flowered plants; before flowering the two are very "
    "hard to tell apart."
)

CAST = (
    "Recurring characters in this story: the heroine is a Japanese woman in her late thirties with "
    "black hair loosely gathered at the nape with a pencil pushed through the knot, an unbleached "
    "linen shirt and an indigo work apron; she is only ever seen from behind or in silhouette. "
    "The other person who handles the plants is shown ONLY as hands and the cuffs of a dark "
    "cardigan (no face, no body). An old man in a flat cap and a woman with short hair appear only "
    "as small distant silhouettes."
)

PANELS = [
    # p1 — morning: she picks only flowering stems by hand, passing the look-alike leaves by
    "Scene: early spring morning beside a small clear mountain stream in a damp broadleaf forest. "
    "The forest floor is a carpet of the small white-flowered anemone. In the foreground a woman "
    "seen from behind crouches and pinches ONE flowering stem between her fingers, laying it in a "
    "shallow woven bamboo basket already holding white-flowered stems. Right next to her hand grow "
    "a few clumps of the flowerless look-alike leaves, their outlines traced with a faint violet "
    "glow (the spot colour); her hand passes them by. A closed sketchbook and a pencil rest on a "
    "mossy rock beside the basket. Soft morning light, calm, careful, beautiful.",
    # p2 — afternoon upstream: hands with garden scissors cut the look-alike leaves
    "Scene: afternoon, further upstream in the same forest, dappled light through young leaves, "
    "the stream glinting behind. A tight close-up of a pair of hands in thin pale cotton gardening "
    "gloves emerging from the cuffs of a dark cardigan: one hand holds a small pair of garden "
    "scissors snipping two or three stems of the flowerless, glossy, deeply divided look-alike "
    "leaves, which glow violet (the spot colour, the ONLY colour); the other hand holds a small "
    "innocent bouquet of white wildflowers. The person is cropped by the frame: only hands and "
    "sleeves, no face, no body. Quiet, secretive, tense.",
    # p3 — evening kitchen: four small bowls, one blue-and-white bowl, hands add chopped leaves
    "Scene: evening in the dim kitchen of an old Japanese farmhouse with a dark wooden counter and "
    "a single hanging lamp. On a lacquered tray stand four small ceramic side-dish bowls filled "
    "with neat mounds of dark boiled greens. One of them is a distinctive porcelain bowl painted "
    "with small flowers, its pattern rendered in violet (the spot colour). A pair of hands (only "
    "hands and dark cardigan cuffs visible) lets a small pinch of finely chopped leaves fall into "
    "that one bowl only. Through the window behind, far away in the dusk garden, two tiny "
    "silhouettes (an old man in a flat cap and a short-haired woman) crouch by a small clay "
    "charcoal brazier with a thin thread of smoke, unaware. No face anywhere.",
    # p4 — dinner: four bowls; the old man's untouched; she reaches for hers
    "Scene: night, a tatami dining room lit warmly by a paper floor lamp, seen from a high angle "
    "over a low wooden table. Four small bowls of boiled greens: the flower-painted porcelain bowl "
    "(violet pattern, the spot colour) sits in front of the woman seen from behind, her hand "
    "lifting chopsticks toward it. Across the table an old man's bowl remains full and untouched, "
    "his chopsticks resting neatly on a chopstick rest; two other bowls are already empty. Plates "
    "of crisp tempura sprouts and a small vase of white wildflowers. The other diners are cropped "
    "at the shoulders or turned away; no faces. Warm, ordinary, a quiet unease.",
    # p5 — the next day: the evidence on a laboratory bench (no people)
    "Scene: the next day, a clean public-health laboratory bench under a cold desk lamp. Laid out "
    "neatly: several sealed clear plastic bags holding small food remains, a covered container of "
    "leftover boiled greens from the cooking pot, a small pair of garden scissors in its own sealed "
    "bag, and the flower-painted porcelain bowl in a sealed bag whose pattern glows violet (the "
    "spot colour, the ONLY colour). Behind them a microscope and a rack of test tubes. No person "
    "at all. All bags and containers are blank: no labels, no tags, no writing. Calm, precise, "
    "the truth waiting to be read.",
]

BG = f"""
Wide 16:9 background illustration for a mystery adventure video game, no characters.
Scene: night inside an old Japanese farmhouse after a spring supper. A tatami dining room with a
low dark wooden table: small ceramic side-dish bowls, one distinctive blue-and-white porcelain
bowl painted with small flowers, chopsticks on rests, a small vase of white spring wildflowers.
On the wooden step down to the earthen-floored kitchen, a shallow woven bamboo basket of fresh
wild greens with tiny white flowers. Paper shoji doors stand half open onto a dark garden where
a small mountain stream glints in the moonlight among young leaves. A warm paper lamp inside and
cold soft violet (#9B6BFF) moonlight outside. Quiet, homely, faintly uneasy. No person, no body.
{STYLE}
Composition: the key subjects are kept inside the central 60% of the width so the image can be
cropped to a narrower frame, with clean readable depth and atmospheric perspective.
{NEGATIVE}
"""

PORTRAIT = f"""
Chest-up bust portrait of a fictional character for a mystery adventure game. Plain, solid,
very dark navy background (#0B0D12), uniform with no objects, with a soft violet rim light
(#9B6BFF fading into #1B3A44) tracing the edge of the hair and one shoulder.
Subject: a 38-year-old Japanese woman, a botanical illustrator. Black hair loosely gathered at
the nape into a soft knot with a wooden pencil pushed through it, a few loose strands framing the
face; natural, clean face; gentle, observant, warm eyes; the collar of an unbleached linen shirt
under the strap of an indigo work apron. Calm, quietly smiling, alive and healthy.
Framing (important, the image is later cut into glass shards around a bust silhouette): the
head is centred horizontally and fairly large; the top of the hair sits about 14% below the top
edge, the chin about 58% down from the top edge, the head (with hair) about half the image width;
the neck and both shoulders fill the lower part and reach the bottom edge. Facing slightly
off-camera in a gentle three-quarter view, eyes open.
Painterly graphic-novel rendering with ink linework, flat cel shading and subtle halftone
screentone. {STYLE}
The person is healthy and uninjured: NOT a corpse, NO injuries, NO bruises, NO tears.
{NEGATIVE}
"""


def build_jobs() -> list[dict]:
    name, hexv = ACCENT
    jobs = [
        {"prompt": BG.strip(), "out": (ART_SRC / "bg" / "c04-bg.png").as_posix(), "size": "2048x1152",
         "quality": "high", "note": "background c04-bg"},
        {"prompt": PORTRAIT.strip(), "out": (ART_SRC / "portraits" / "c04-portrait.png").as_posix(),
         "size": "1024x1536", "quality": "high", "note": "victim portrait c04"},
    ]
    for i, scene in enumerate(PANELS, start=1):
        prompt = "\n\n".join([
            "One panel of a wordless five-panel story sequence for a mystery adventure video game.",
            scene,
            PLANTS,
            CAST,
            panel_style(name, hexv),
            PANEL_NEGATIVE,
        ])
        jobs.append({"prompt": prompt, "out": (ART_SRC / "panels" / f"c04-panel-{i}.png").as_posix(),
                     "size": "1536x1024", "quality": "high", "note": f"reconstruction panel c04 p{i}"})
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
        out = jobs_dir / "batch3-retry.json"
    else:
        out = jobs_dir / "batch3-c04.json"
    out.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(jobs)} jobs to {out}")


if __name__ == "__main__":
    main()
