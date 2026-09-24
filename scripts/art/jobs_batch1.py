"""Writes art-src/jobs/batch1.json (and batch1-keyart.json) for parallel_imagegen.py.

Usage:
    python scripts/art/jobs_batch1.py            # writes both job files
    python <skill>/parallel_imagegen.py --jobs art-src/jobs/batch1.json --merge-into art-src/manifest.json

Only the prompts live here; the post-processing is in split_sheet.py / export_art.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, NEGATIVE, STYLE, job  # noqa: E402

HOLMA_DESIGN = (
    "Character design (IDENTICAL in every drawing): a child-height taxidermied WHITE RABBIT "
    "specimen standing upright on its hind legs like a small person; clean white fur with a "
    "slightly stiff, preserved look; visible dark thread cross-stitch seams around the neck "
    "and along one long ear; its LEFT eye is a glossy red glass bead (#FF2E63), its RIGHT eye "
    "is a black sewn-on button with visible thread; long upright ears; an oversized white lab "
    "coat with rolled-up sleeves whose hem hangs past its knees; a formalin-green (#C6FF3D) "
    "bow tie at the collar; a small blank paper specimen tag pinned to one ear with a thin "
    "insect pin (the tag is completely blank, no writing); it stands on a small wooden "
    "specimen crate. Elegant, theatrical, creepy-cute, charming, not scary, not bloody."
)

HOLMA_SHEET = f"""
Character expression sheet for a mystery adventure game: the SAME character drawn FOUR times
side by side in a single horizontal row, evenly spaced across the width, each one a full body
figure from the tips of the ears down to the bottom of its crate, with generous empty margin
above the ears and below the crate, all four at exactly the same scale, clearly separated by
empty space, never overlapping, nothing cropped at the image edges.

{HOLMA_DESIGN}

Figure 1 (far left) NORMAL: smug thin smile, relaxed confident posture, holding a long slim
silver probe (a thin metal rod, not a knife) like a lecturer's pointer.
Figure 2 LAUGH: head thrown back, mouth wide open cackling theatrically, one paw on its belly,
the probe in the other paw.
Figure 3 SURPRISED: both ears shot straight up, eyes wide, leaning back in shock, paws raised.
Figure 4 (far right) SERIOUS: calm and still, ears lowered, the probe held vertically in front
of the chest, solemn, sincere, respectful expression.
Each figure stands on its own identical small wooden specimen crate.

{STYLE}

Background: fully transparent background, export as a PNG with a real alpha channel where every
background pixel has alpha = 0 and contains no painted pixels. NO checkerboard pattern, NO grid
pattern, NO floor, NO cast shadow on the ground, NO scenery, NO backdrop colour.
{NEGATIVE}
"""

PORTRAIT_COMMON = f"""
Chest-up bust portrait of a fictional character for a mystery adventure game. Plain, solid,
very dark navy background (#0B0D12), uniform with no objects, with a cold teal rim light
(#3DE0FF fading into #1B3A44) tracing the edge of the hair and one shoulder. The figure faces
slightly off-camera in a three-quarter view, calm and quiet expression, eyes open, dignified,
alive and gentle. Head in the upper third of the frame, shoulders reaching the bottom edge,
centered. Painterly graphic-novel rendering with ink linework, flat cel shading and subtle
halftone screentone. {STYLE}
The person is healthy and uninjured: NOT a corpse, NO injuries, NO bruises.
{NEGATIVE}
"""

PORTRAITS = {
    "c01": (
        "Subject: a 29-year-old Japanese woman, a cell-biology researcher. Short straight black "
        "bob haircut, thin metal-frame glasses, tired but kind eyes, the collar of a white lab "
        "coat over a dark grey knit sweater. Intelligent, gentle, a little exhausted."
    ),
    "c02": (
        "Subject: an 18-year-old Japanese high-school girl, a former softball player. "
        "Sun-tanned skin, a high ponytail of black hair, bright determined eyes, the collar of a "
        "plain white sports T-shirt with no print and no logo. Her right hand is raised near her "
        "chin and one finger has a small beige adhesive bandage. Energetic but calm here."
    ),
    "c03": (
        "Subject: a 34-year-old Japanese woman, a mountain photographer. Shoulder-length wavy "
        "dark-brown hair, cheeks slightly reddened by cold wind, a deep green fleece jacket collar, "
        "a black camera strap across her shoulder (no camera brand, no logo), a calm far-away gaze "
        "as if looking at distant peaks."
    ),
}

BG_COMMON = f"""
Wide 16:9 background illustration for a mystery adventure video game, no characters.
{STYLE}
Composition: the key subjects are kept inside the central 60% of the width so the image can be
cropped to a narrower frame, with clean readable depth and atmospheric perspective.
{NEGATIVE}
"""

BACKGROUNDS = {
    "room-zero": (
        "Scene: a surreal, elegant morgue that exists between life and death at midnight. A tall "
        "wall of steel body-storage drawers with plain handles (no labels), rows of unlabeled glass "
        "specimen jars glowing a faint formalin green (#C6FF3D), a single hanging surgical lamp "
        "casting a cone of light, a round wall clock with no numerals whose two hands both point "
        "straight up to midnight, low mist creeping over a tiled floor, deep navy darkness around "
        "the edges. The centre of the room is an open, empty, softly lit floor area where a small "
        "character will later stand. Quiet, beautiful, uncanny. No people, no bodies."
    ),
    "inquest": (
        "Scene: a circular, theatre-like inquest chamber. A ring of empty wooden lecterns arranged "
        "in a circle facing inward toward a bright circular spotlight on the floor at the centre; "
        "tall dark shelves full of unlabeled glass specimen jars rising behind them; alarm magenta "
        "(#FF2E63) and formalin green (#C6FF3D) accent lights streaking across the architecture; "
        "dramatic low-angle perspective, slightly surreal, grand and tense like a courtroom stage. "
        "No people."
    ),
    "science": (
        "Scene: a calm, intelligent backdrop for a science explanation screen: a large dark "
        "anatomy lecture blackboard filling the frame, covered with faint, soft chalk-like "
        "drawings made only of abstract shapes: flowing lines, curved arrows, simple molecule "
        "ball-and-stick diagrams, a faint outline of lungs and a heart, circulation loops, "
        "concentric circles. Teal (#1B3A44) and bone white (#F2EFE6) tones only with a whisper "
        "of formalin green. The chalk marks are faint and low contrast, with lots of calm empty "
        "negative space in the middle because text will be placed on top. Absolutely NO letters, "
        "NO numbers, NO equations, NO labels, NO words anywhere on the board. No people."
    ),
    "c01-bg": (
        "Scene: a small windowless sample-storage room in a university basement at night. Grey "
        "steel shelves with plain boxes (no labels), a large cylindrical stainless-steel "
        "liquid-nitrogen storage tank with a lid and a pressure gauge (blank dial face, no "
        "numbers), a tall supply dewar vessel on a wheeled base connected to it with a flexible "
        "metal hose, faint white cold vapour and frost creeping near the floor, a small "
        "wall-mounted gas monitor box with a dark, dead screen, a heavy steel door standing "
        "slightly ajar, harsh cold fluorescent ceiling light. Quiet and ominous. No person."
    ),
    "c02-bg": (
        "Scene: a riverside park in Japan at summer dusk. A grassy river embankment, a leather "
        "softball glove and a white ball lying on the grass in the foreground, the low orange sun "
        "flaring directly toward the viewer creating strong backlight and lens glare, a small "
        "modest community building far in the distance, long shadows stretching across the "
        "grass, a calm river and a distant bridge silhouette. Nostalgic, beautiful, a little "
        "melancholic. No person."
    ),
    "c03-bg": (
        "Scene: a winter mountain ridge just after a blizzard, the whiteout fading into cold blue "
        "light. Dark jagged rocks with a narrow crevice between them, deep wind-sculpted snow, and "
        "at a distance a few pieces of outdoor clothing scattered separately on the snow: a "
        "jacket, a single glove, a knit cap. Lonely, silent, cold blue and teal palette with "
        "bone-white snow. No person, no body."
    ),
}

KEY_ART = f"""
Title key art for a mystery adventure video game, wide cinematic 16:9 composition.
Use the attached reference image ONLY as the character model sheet for the rabbit (same
design, same colours, same details); do not copy its layout.

On the RIGHT third: the rabbit character standing on its small wooden specimen crate,
full body, three-quarter view, gesturing theatrically with its long slim silver probe toward
the left, with a knowing smug smile. {HOLMA_DESIGN}

On the LEFT-CENTRE: the floating silhouette of a young woman made entirely of shattered
stained-glass shards, the fragments slightly separated with thin dark gaps between them,
glowing luminous cyan (#3DE0FF) from within, some shards drifting away, faceless and serene,
beautiful rather than frightening.

Setting: a dark, elegant morgue at midnight, walls of steel drawers and faintly glowing
formalin-green specimen jars fading into navy darkness, formalin-green mist curling across the
floor, a hard theatrical spotlight on the rabbit. The UPPER-LEFT third of the image is kept
calm, dark and uncluttered (soft mist and darkness only) because a title logo will be placed
there later.

{STYLE}
{NEGATIVE}
"""


# Retry for c03: the first take drew a red jacket that read as a collapsed person and a huge
# glacier crevasse (misleads the mystery: she crawled into a narrow gap between rocks).
C03_RETRY = (
    "Scene: a winter mountain ridge in the late afternoon just after a blizzard. The whiteout is "
    "fading: veils of wind-blown snow still drift across the frame, soft and hazy, in cold blue "
    "and teal light with bone-white snow. In the middle ground a cluster of dark, jagged boulders "
    "with a narrow shadowy gap between two rocks, a small low hollow just big enough to crawl "
    "into, partly drifted over with snow. On the gentle snow slope in the foreground and leading "
    "toward the rocks, several metres apart from each other, a few small pieces of outdoor "
    "clothing lie flat and obviously empty: a crumpled dark teal-grey down jacket lying open and "
    "flat, a single dark glove, and a small alarm-magenta (#FF2E63) knit cap. A faint trail of "
    "single footprints half-filled by new snow. NO crevasse, NO glacier, NO cliff drop. Lonely, "
    "silent, quietly unsettling. No person, no body, no figure-like shapes."
)


def retry_jobs() -> list[dict]:
    return [job(C03_RETRY + "\n" + BG_COMMON, ART_SRC / "bg" / "c03-bg.png", "2048x1152",
                "background c03-bg (retry: no body-like jacket, narrow rock gap)")]


def main() -> None:
    jobs_dir = ART_SRC / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)

    batch = [
        job(HOLMA_SHEET, ART_SRC / "holma" / "holma-sheet.png", "2048x1152",
            "Holma 4-expression sheet (normal/laugh/surprised/serious), transparent"),
    ]
    for cid, subject in PORTRAITS.items():
        batch.append(job(PORTRAIT_COMMON + "\n" + subject,
                         ART_SRC / "portraits" / f"{cid}-portrait.png", "1024x1536",
                         f"Jane Doe portrait {cid}"))
    for name, scene in BACKGROUNDS.items():
        batch.append(job(scene + "\n" + BG_COMMON, ART_SRC / "bg" / f"{name}.png", "2048x1152",
                         f"background {name}"))

    (jobs_dir / "batch1.json").write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")

    key = [job(KEY_ART, ART_SRC / "key-art" / "key-art.png", "2048x1152",
               "title key art (Holma right, glass-shard woman left)",
               refs=[ART_SRC / "holma" / "holma-sheet.png"])]
    (jobs_dir / "batch1-keyart.json").write_text(json.dumps(key, ensure_ascii=False, indent=2), encoding="utf-8")
    retry = retry_jobs()
    (jobs_dir / "batch1-retry.json").write_text(json.dumps(retry, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(batch)} + {len(key)} + {len(retry)} (retry) jobs to {jobs_dir}")


if __name__ == "__main__":
    main()
