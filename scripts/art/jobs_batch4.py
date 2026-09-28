"""Writes art-src/jobs/batch4-intro.json: the 18 images of the three intro cases (2026-09-28).

    c05 = CASE 01「背のびした牛乳びん」   c06 = CASE 02「氷点下の雪だるま」   c07 = CASE 03「うなだれたバラ」

    background   art-src/bg/c0N-bg.png              -> public/cases/c0N/bg.webp        (export_art.py bg)
    portrait     art-src/portraits/c0N-portrait.png -> public/cases/c0N/portrait.webp  (export_art.py portraits)
    panels 1-4   art-src/panels/c0N-panel-N.png     -> public/cases/c0N/panel-N.webp   (export_panels.py)

Usage (from the project root). ONE batch_imagegen.py run for all eighteen (codex-imagegen skill;
--per-exec 9: two Codex launches, the 18 prompts in one launch exceed the Windows command-line limit):
    python scripts/art/jobs_batch4.py
    python "%USERPROFILE%/.claude/skills/codex-imagegen/scripts/batch_imagegen.py" \
        --jobs <abs>/art-src/jobs/batch4-intro.json --manifest <abs>/art-src/manifest.json --per-exec 9
    python scripts/art/export_art.py bg portraits
    python scripts/art/export_panels.py --sheet
    python scripts/art/trace_silhouette.py        # victim.silhouette paths for the object portraits

    python scripts/art/jobs_batch4.py c06-panel-2   # writes batch4-retry.json with only those items

The victims of the intro cases are objects (a milk bottle, a snowman, a cut rose), so the
"portrait" is a dignified still life on the usual dark ground, and the shard mask is traced from
it (trace_silhouette.py). The people (a boy, two children, a girl, a florist, a mother) appear only
from behind, as silhouettes or as hands. Gentle, warm, a little mysterious — these cases are for
children and first-time players: nothing scary, nothing sad-looking. No existing works or artists
are named. No text anywhere.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, NEGATIVE, PANEL_NEGATIVE  # noqa: E402

# Same ink-and-screentone DNA as style.STYLE, with a gentler mood for the intro cases.
STYLE_INTRO = (
    "Art style: bold graphic-novel illustration, confident black ink linework, flat cel shading "
    "with subtle halftone screentone dots in the shadows, limited palette (ink navy #0B0D12, "
    "bone white #F2EFE6, cold teal shadows #1B3A44) plus the single accent colour given in this prompt, "
    "theatrical lighting, stylish and elegant, gentle, warm and quietly curious mystery mood, "
    "cozy rather than unsettling, suitable for children. Polished key-visual quality for a "
    "premium mystery adventure video game."
)


def panel_style_intro(accent_name: str, accent_hex: str) -> str:
    return (
        "Format: ONE single wordless (silent) manga / graphic-novel panel that fills the whole "
        "canvas edge to edge: full bleed, no panel border, no gutter, no multi-panel page layout. "
        "Art style: bold confident black ink brush and pen linework, crisp cross-hatching and "
        "printed dot screentone (halftone) for all greys and shadows, on warm off-white paper "
        "(#F2EAD8). STRICTLY MONOCHROME: everything is black ink and neutral grey screentone on the "
        "cream paper EXCEPT for ONE single spot accent "
        f"colour, {accent_name} ({accent_hex}), used sparingly only where the scene says. No other "
        "hue anywhere: no skin tones, no wood or brick colours, no blue or orange sky, no green "
        "leaves, no orange carrot noses. Clear, readable composition, strong silhouettes, deep blacks, "
        "gentle, warm and curious mood suitable for children, a little mysterious but never scary. "
        "People are drawn from behind or as silhouettes, or only their hands; faces are NEVER shown, "
        "no front or three-quarter view of anyone's face. Premium published graphic-novel quality."
    )


PORTRAIT_FRAME = (
    "Framing (important, the image is later cut into glass shards along the subject's outline): "
    "the subject stands upright, centred horizontally, fully inside the frame with a clear margin "
    "on every side; its top is about 12% below the top edge and its bottom about 8% above the "
    "bottom edge; it takes up about 55-65% of the image width at its widest. Nothing else in the "
    "picture: no table edge, no floor line, no props, no reflections, no cast shadow."
)


def portrait(subject: str, rim_name: str, rim_hex: str) -> str:
    return f"""
Still-life "portrait" of an object for a mystery adventure game, treated with the dignity of a
character portrait. Plain, solid, very dark navy background (#0B0D12), completely uniform, with a
soft {rim_name} rim light ({rim_hex} fading into #1B3A44) tracing one side of the subject.
Subject: {subject}
The object is whole, clean and undamaged, shown at its best, calm and quietly proud. It has no
face and no cartoon features.
{PORTRAIT_FRAME}
Painterly graphic-novel rendering with ink linework, flat cel shading and subtle halftone
screentone. {STYLE_INTRO}
{NEGATIVE}
"""


def background(scene: str, accent: str) -> str:
    return f"""
Wide 16:9 background illustration for a mystery adventure video game, no characters.
{scene}
Accent colour of this case: {accent}.
{STYLE_INTRO}
Composition: the key subjects are kept inside the central 60% of the width so the image can be
cropped to a narrower frame, with clean readable depth and atmospheric perspective. No person.
{NEGATIVE}
"""


CASES = {
    # ------------------------------------------------------------------ CASE 01 milk bottle
    "c05": {
        "accent": ("soft cornflower blue", "#6FA8FF"),
        "note": "CASE 01 milk bottle",
        "bg": background(
            "Scene: a small Japanese home kitchen late on a summer night. A tall refrigerator whose top "
            "freezer door stands slightly open; cold pale blue light and a thin curl of frosty mist spill "
            "out of the gap. On the counter a small glass of cold barley tea, a folded dish towel and an "
            "empty glass jar. Through the window, a summer night and the silhouette of a glass wind chime. "
            "Quiet, homely, faintly curious.",
            "cornflower blue #6FA8FF for the freezer light",
        ),
        "portrait": portrait(
            "a classic Japanese glass milk bottle, full to the brim with white milk, sealed with a small "
            "round paper cap pressed into its mouth; thick clear glass with a rounded shoulder, a short "
            "neck with a lip, straight sides and a heavy rounded base; a few tiny beads of condensation on "
            "the glass; the white milk glows softly through the glass. The paper cap is completely blank.",
            "cornflower blue",
            "#6FA8FF",
        ),
        "panels": [
            # p1 — evening: the boy puts the full bottle (and the half one) in the freezer
            "Scene: evening in a home kitchen, the window behind already dark night. A small boy in a "
            "T-shirt and shorts, seen from behind, "
            "stands on tiptoe in front of a refrigerator with its top freezer door open, carefully placing "
            "a FULL glass milk bottle with a small round paper cap into the freezer, next to another glass "
            "milk bottle that is only HALF full. The milk in the full bottle is tinted cornflower blue (the "
            "spot colour). Frost on the freezer walls, a couple of ice trays. Cheerful, cosy, a little "
            "mischievous.",
            # p2 — night inside the freezer: the milk freezes from the glass inward
            "Scene: the dark inside of a household freezer at night, seen straight on as if the door were "
            "glass. Two glass milk bottles stand side by side on the frosty shelf: the left one is full to "
            "the very top, the right one only half full. In both, the milk is starting to freeze: a pale "
            "ring of ice grows inward from the glass walls and the milk surface, drawn in cornflower blue "
            "(the spot colour), while the centre is still liquid. Frost crystals, cold mist, silence.",
            # p3 — the key: the ice rises out of the neck and pushes the glass
            "Scene: dramatic close-up of the FULL glass milk bottle inside the freezer. A short white column "
            "of frozen milk has risen out of the bottle's mouth like a little tower, lifting the round paper "
            "cap on top of it like a tiny hat. Thin cracks spread across the bottle's shoulder and side. "
            "The frozen milk inside and the rising column are cornflower blue (the spot colour). Small "
            "radiating motion lines show the push from inside outward. No liquid is spilling. Tense but "
            "not scary.",
            # p4 — morning: the found bottles, the half one intact with a domed surface
            "Scene: early morning light in the kitchen. The freezer door is held open by a woman's hand "
            "and sleeve only (no face, no body). On the freezer shelf: the full milk bottle with a white "
            "frozen column sticking out of its mouth, the paper cap perched on top, cracks on its side; "
            "and next to it the HALF-full bottle, unbroken, its frozen milk surface bulging up into a low "
            "dome in the middle. The difference between the two is lit in cornflower blue (the spot "
            "colour): the empty space above the milk in the half bottle. Calm, a small surprise.",
        ],
    },
    # ------------------------------------------------------------------ CASE 02 snowman
    "c06": {
        "accent": ("warm sunlight yellow", "#FFD84A"),
        "note": "CASE 02 snowman",
        "bg": background(
            "Scene: a snowy garden of a small wooden Japanese house in a snowy town on a bright, clear, "
            "windless winter afternoon, deep blue sky, long blue shadows on the snow. In the sunny middle "
            "of the garden stand two snowmen side by side, both made of two plain snowballs with small "
            "charcoal eyes and charcoal buttons, NO nose, NO carrot, NO hat, NO mouth: the one on the "
            "right is whole and wears NOTHING around its neck (no scarf at all); the one on the left has "
            "lost its head, which lies on the snow beside its round body together with a dark knitted "
            "scarf (the only scarf in the picture). A thermometer hangs in the shade under "
            "the eaves (its dial blank, no numbers). A few oval boot prints of children's shoes and two small "
            "snow shovels; absolutely NO animal paw prints and NO animal tracks anywhere. "
            "Peaceful, bright, a small mystery.",
            "warm sunlight yellow #FFD84A for the sunlight",
        ),
        "portrait": portrait(
            "a friendly snowman made of two stacked round snowballs, a larger one below and a smaller "
            "one on top, with two small round charcoal eyes, three charcoal buttons and a short twig arm "
            "on each side, a dark knitted scarf wrapped once around its neck with the ends hanging down; "
            "clean, fresh, sparkling white snow. No hat, no nose, no mouth drawn.",
            "warm sunlight yellow",
            "#FFD84A",
        ),
        "panels": [
            # p1 — morning: the siblings build two snowmen; the girl wraps her black scarf
            "Scene: a bright winter morning in a snowy garden. Two children seen from behind in thick "
            "winter coats and knitted hats: a small girl reaches up to wrap her own dark knitted scarf "
            "around the neck of her snowman; her older brother beside her pats the round body of his own "
            "snowman, which wears no scarf. Both snowmen are two plain snowballs with small charcoal "
            "eyes and buttons, NO nose, NO carrot, NO hat, NO mouth. The low "
            "winter sun and its rays are warm sunlight yellow (the spot colour). Happy, cosy.",
            # p2 — noon: sunlight on the black scarf; the neck under it melts
            "Scene: noon, close-up of the snowman's neck and head (a plain snowball head with two small "
            "charcoal eyes, NO nose, NO carrot, NO hat, NO mouth). Strong sunlight, drawn as warm sunlight "
            "yellow rays (the spot colour, the ONLY colour), falls on the dark knitted scarf; tiny drops of "
            "melt water drip from under the scarf and the snow of the neck beneath it has become thin and "
            "wet, while the white snow of the head and body around it stays crisp and bright. The small "
            "charcoal eyes sit in little sunken dimples. The air is clearly freezing: icicles hang from "
            "the eaves in the background. Quiet, curious.",
            # p3 — afternoon: the thin neck gives way; the other snowman still stands
            "Scene: early afternoon in the same sunny snowy garden. Both snowmen are plain snowballs with "
            "charcoal eyes and buttons, NO nose, NO carrot, NO hat, NO mouth. The snowman's neck has grown thin like "
            "a waist and its round head has rolled off onto the snow beside the body, the dark scarf lying "
            "loose. Next to it, the other snowman without a scarf still stands whole. No people; only a few "
            "oval boot prints of children's shoes from the morning, absolutely NO animal paw prints and NO animal tracks. Long shadows; the sun in warm sunlight yellow (the spot colour). "
            "A small, gentle, slightly comic surprise, not sad.",
            # p4 — dusk: the brother's experiment, black cloth sinks, white cloth does not
            "Scene: late afternoon in the snowy garden, low sun, seen from above, close to the snow. Only "
            "hands are in the picture: NO heads, NO faces, NO bodies. A boy's gloved hands have laid "
            "two small squares of cloth side by side on the flat snow in the sunshine: the BLACK cloth has "
            "sunk into a little hollow in the snow, while the WHITE cloth still lies flat on the surface. "
            "The sunlight on them is warm sunlight yellow (the spot colour). A little girl's mittened hand "
            "points at the black one. Discovery, wonder.",
        ],
    },
    # ------------------------------------------------------------------ CASE 03 rose
    "c07": {
        "accent": ("rose red", "#E8435A"),
        "note": "CASE 03 rose",
        "bg": background(
            "Scene: a Japanese home dining table at dawn, soft light through a lace curtain. On the table a "
            "clear glass vase filled almost to the top with clean water holds a single red rose whose head "
            "has drooped over at the neck just below the flower, as if bowing; its leaves hang limp. Beside "
            "the vase lies a small folded handmade card, completely blank. Through the window, the house "
            "next door, where another red rose stands upright in a vase on the windowsill. Quiet morning, "
            "tender, a small mystery.",
            "rose red #E8435A for the rose",
        ),
        "portrait": portrait(
            "a single long-stemmed red rose in full, fresh bloom, standing perfectly upright: a large "
            "velvety flower head in the upper part of the frame, a straight green stem running down to the "
            "bottom, and two or three healthy leaves on the stem; a few thorns. Crisp, fresh petals.",
            "rose red",
            "#E8435A",
        ),
        "panels": [
            # p1 — morning flower shop: two roses, the florist's advice (cut under water)
            "Scene: morning inside a small flower shop full of buckets of flowers. A girl of about ten with "
            "a backpack, seen from behind, receives two single roses, each wrapped in plain paper, from the "
            "florist, who is shown only as hands and an apron. The florist's other hand holds a rose stem "
            "down inside a bucket of water, showing how to cut the stem under water with small shears. The "
            "two roses are rose red (the spot colour, the ONLY colour). Warm, friendly.",
            # p2 — midday: the paper-wrapped rose hidden on a sunny windowsill, no water
            "Scene: midday in a child's bedroom. On a sunny windowsill, half hidden behind a curtain, lies a "
            "single red rose (the spot colour, the ONLY colour) still wrapped in plain paper, with no water "
            "at all; its cut stem end sticks out of the paper and is dry. Bright sun pours in and warms the "
            "sill; the sky and trees outside the window are drawn in grey ink and screentone only. A backpack "
            "and a handmade card (blank) on the desk. Secretive, sweet, a small worry.",
            # p3 — evening: the stem is cut in the air, then the vase
            "Scene: evening at a kitchen sink, close-up. A woman's hands (hands and sleeves only, no face) "
            "snip the end of the rose's stem with kitchen scissors in the open air above the sink, NOT under "
            "water. A tiny stylised magnified circle beside the cut shows the inside of the stem: a thin "
            "tube with a small air bubble stuck in it (drawn simply, no labels, no text). A clear glass vase "
            "full of fresh water waits on the counter. No other people and no animals in the picture. The "
            "stem, leaves and the magnified circle are drawn in black ink and grey screentone only; ONLY the "
            "rose flower is rose red (the spot colour).",
            # p4 — next morning: the rose bowed in the full vase; the other rose upright next door
            "Scene: the next morning, a dining table by a window. In a clear glass vase full of water the "
            "red rose's head has bent down at the neck just below the flower, bowing; its leaves droop; the "
            "water level is still high. Through the window, in the house next door, another red rose stands "
            "straight and fresh in a vase on a windowsill. Both roses are rose red (the spot colour). No "
            "people. Quiet, a gentle mystery.",
        ],
    },
}


def build_jobs() -> list[dict]:
    jobs: list[dict] = []
    for cid, c in CASES.items():
        name, hexv = c["accent"]
        jobs.append({"prompt": c["bg"].strip(), "out": (ART_SRC / "bg" / f"{cid}-bg.png").as_posix(), "size": "2048x1152",
                     "quality": "high", "note": f"background {cid}-bg ({c['note']})"})
        jobs.append({"prompt": c["portrait"].strip(), "out": (ART_SRC / "portraits" / f"{cid}-portrait.png").as_posix(),
                     "size": "1024x1536", "quality": "high", "note": f"victim portrait {cid} ({c['note']})"})
        for i, scene in enumerate(c["panels"], start=1):
            prompt = "\n\n".join([
                "One panel of a wordless four-panel story sequence for a mystery adventure video game "
                "for all ages.",
                scene,
                panel_style_intro(name, hexv),
                PANEL_NEGATIVE,
            ])
            jobs.append({"prompt": prompt, "out": (ART_SRC / "panels" / f"{cid}-panel-{i}.png").as_posix(),
                         "size": "1536x1024", "quality": "high", "note": f"reconstruction panel {cid} p{i} ({c['note']})"})
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
        out = jobs_dir / "batch4-retry.json"
    else:
        out = jobs_dir / "batch4-intro.json"
    out.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(jobs)} jobs to {out}")


if __name__ == "__main__":
    main()
