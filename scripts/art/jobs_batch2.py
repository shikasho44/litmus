"""Writes art-src/jobs/batch2-panels.json: the 15 reconstruction comic panels (5 per case).

Usage (from the project root):
    python scripts/art/jobs_batch2.py
    python <skill>/parallel_imagegen.py --jobs art-src/jobs/batch2-panels.json \
        --merge-into art-src/manifest.json
    python scripts/art/export_panels.py

Briefs come from content/cases/<id>/case.json reconstruction.panels[].scene (translated and
tightened here). One spot colour per case: c01 cyan, c02 amber, c03 formalin green.
Raw PNGs: art-src/panels/c0N-panel-N.png  ->  public/cases/c0N/panel-N.webp (export_panels.py).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, PANEL_NEGATIVE, job, panel_style  # noqa: E402

ACCENTS = {
    "c01": ("luminous cold cyan", "#3DE0FF"),
    "c02": ("warm amber", "#FFB020"),
    "c03": ("formalin green", "#C6FF3D"),
}

# Recurring look of each case's people, so the five panels read as one story.
CAST = {
    "c01": (
        "Recurring character in this story: a slim young Japanese woman researcher with a short "
        "straight black bob haircut; at work she wears a knee-length white lab coat."
    ),
    "c02": (
        "Recurring characters in this story: an 18-year-old girl with a long high black ponytail, "
        "a plain white T-shirt and dark shorts, a leather softball catcher's mitt on her left hand; "
        "her little brother, a slim ten-year-old boy in a plain T-shirt and shorts, bareheaded."
    ),
    "c03": (
        "Recurring character in this story: a lone woman mountain photographer; she wears a "
        "fleece top and a knit cap in the spot colour, a dark shell jacket, dark trousers, dark "
        "gloves and mountaineering boots."
    ),
}

PANELS: dict[str, list[str]] = {
    "c01": [
        # p1 — the alarm at 0:52
        "Scene: deep night inside a small apartment bedroom, almost completely dark, rendered in "
        "heavy solid blacks. The only light is a smartphone on the bedside table whose blank "
        "glowing screen casts a cold cyan glow (the spot colour) across the sheets. A young "
        "woman with a short black bob, in plain pyjamas, has just pushed herself half upright in "
        "bed; she is seen from behind and slightly above, a dark silhouette rim-lit in cyan, her "
        "face not visible, turning toward the light. On the wall a round clock with a completely "
        "blank face (no numbers, no marks), its two hands at ten to one. The phone screen shows "
        "only light, nothing written. Intimate, hushed, the moment sleep is broken.",
        # p2 — enters the storage room alone, door closes, ventilation off
        "Scene: a long deserted university basement corridor at night, seen at a tilted dutch "
        "angle with strong one-point perspective. Only low emergency lamps and the distant cold "
        "cyan glow of a plain drinks vending machine (blank front, no logos) light the floor in "
        "pools. In the foreground a woman in a white lab coat with a short black bob, seen from "
        "behind, leans her shoulder into a heavy steel fire door and pushes it open, stepping "
        "into a dark room. A hydraulic door-closer arm is fixed at the top of the door. Above the "
        "door a square ventilation grille shows a still, stopped fan behind the slats. Plain "
        "walls, no signs, no exit signs, no posters. Quiet, lonely, ominous.",
        # p3 — refilling; LN2 overflows and spreads as fog
        "Scene: a small windowless storage room with bare steel shelves of plain unmarked boxes. "
        "A tall silver liquid-nitrogen supply vessel on a wheeled base is connected by a flexible "
        "ribbed metal hose to a squat cylindrical storage tank. Thick white freezing fog "
        "overflows from the tank's open mouth, spills down its sides and creeps low across the "
        "whole floor in rolling tendrils, lit by a cold cyan glow (the spot colour). In the "
        "foreground a woman with a short black bob in a white lab coat and thick insulated "
        "cryogenic gloves, seen from behind, is calmly lifting the lid of a plain box on a "
        "shelf, unaware of the fog rising around her ankles. Low camera angle so the fog "
        "dominates the lower half. Blank gauges, no labels.",
        # p4 — the dead O2 monitor; she sits down
        "Scene: close-up in the same cold storage room. In sharp focus in the foreground, a small "
        "plain wall-mounted gas-monitor box whose little screen is completely black and dead, "
        "displaying nothing at all, a thin cyan reflection (the spot colour) sliding across its "
        "dark glass. Far behind it, soft and out of focus, the vague dark silhouette of a woman "
        "in a white lab coat slowly sitting down on the floor with her back against a steel "
        "shelf, as if resting for a moment; no expression drawn, no sign of pain. Thin white "
        "frost patterns on the floor, a faint layer of low mist. Very still, cold, sad and quiet, "
        "non-graphic.",
        # p5 — morning: guard opens the door, radios for help
        "Scene: early morning. Viewed from the basement corridor: the heavy steel door of the "
        "storage room stands wide open, held by a simple rubber door wedge on the floor. Pale "
        "white morning light pours along the floor through the doorway, catching white frost "
        "marks on the cold floor inside; the interior of the room is washed out and hazy with "
        "light and thin mist, empty of any visible person. Beside the doorway, a security guard "
        "in a plain uniform and cap, seen from behind, has stepped back out and holds a radio "
        "handset to his mouth, calling for help. Faint cyan (the spot colour) only in the "
        "lingering mist. No badges, no patches, no signs. A sense of air finally moving.",
    ],
    "c02": [
        # p1 — sister catching her brother's pitches at dusk
        "Scene: a riverside park in Japan on a summer evening. Wide shot from low behind the "
        "catcher: in the foreground the girl with the high ponytail crouches in a catcher's "
        "stance, seen from behind, her mitt raised as a target. Far away across the grass her "
        "little brother winds up to pitch. The low evening sun and the sky glow warm amber "
        "(the spot colour); the two long shadows stretch across the grass toward us. River "
        "embankment, a distant bridge silhouette, summer clouds drawn in screentone. Peaceful, "
        "nostalgic, tender.",
        # p2 — the last pitch lost in the sun
        "Scene: point of view from the catcher's eye level, looking straight toward the pitcher. "
        "The small silhouette of the boy has just released the ball, his arm following through; "
        "directly behind him a huge setting sun sits right on the horizon, an overwhelming disc "
        "of amber light (the spot colour) with strong radiating glare and a blooming halo drawn "
        "with fine radial lines and screentone. The small white ball's path dissolves into the "
        "glare and cannot be seen. Blinding, dazzling, a held breath.",
        # p3 — the ball meets the vulnerable moment of the heartbeat (abstract)
        "Scene: side view in pure silhouette against pale paper: the girl's catcher's mitt "
        "swipes through empty air a moment too late, while a small white ball just touches the "
        "left side of her chest. From that point a single thin line of light, shaped like a "
        "calm heartbeat trace (a gentle rounded wave), extends horizontally across the panel in "
        "amber (the spot colour); on that line, one single point just BEFORE the top of a gentle "
        "rounded wave flares as a sharp bright star. Everything else is frozen and silent, "
        "abstract, time stopped. No grid, no numbers, no injury shown, non-graphic.",
        # p4 — "I'm fine", a few seconds before she collapses
        # (take 2: take 1 drifted to a hilltop over a lake with a church spire; now pinned to
        # the same riverside ballfield as p1/p2)
        "Scene: the same riverside sports park at dusk as before: flat grass beside the dirt "
        "edge of a small ballfield, a low grassy river embankment, a wide calm river and a long "
        "steel truss bridge far in the distance. Strong backlight: the sun is low near the "
        "horizon, amber (the spot colour). Seen from behind in the foreground, the girl with "
        "the high ponytail stands upright holding the white ball in her mitt and casually "
        "raises her other hand toward her brother in a light reassuring wave. The boy stands "
        "still far away on the grass, a small silhouette facing her. Their two shadows stretch "
        "long and calm across the field. Deceptively peaceful, as if nothing at all has "
        "happened. Flat riverside ground only: NO hilltop, NO lake, NO islands, NO church, NO "
        "town below.",
        # p5 — adults cool her in the shade; the AED stays in its box 300 m away
        # (take 2: take 1 gave the running shoe a brand-like stripe pattern and lost the AED box)
        "Scene: in the shade of a tree on the grass by the river at dusk. A very low camera "
        "close to the ground shows only the shoes, knees and hands of two worried adults "
        "crouching (a man with a dog leash looped at his wrist, a woman in running clothes), a "
        "round flat paper hand fan mid-wave and a clear unlabelled plastic water bottle; the "
        "person they are tending is entirely outside the frame and never shown. Their shoes are "
        "plain and unbranded: solid dark uppers with NO stripes, NO swooshes, NO logos. In the "
        "far background, on top of the river embankment, stands a small plain community hall "
        "whose windows are lit in plain paper white; on its outside wall hangs one small plain "
        "white cabinet box that glows amber (the spot colour, the ONLY amber in the panel), "
        "small but clearly visible, far out of reach. Evening, anxious, quiet. The box and the "
        "building carry no symbols, no signs and no lettering.",
    ],
    "c03": [
        # p1 — photographing on the ridge as the storm approaches
        "Scene: a wide shot from behind: a lone woman photographer, small in the frame, crouches "
        "on a snowy mountain ridge beside a small tripod-mounted camera, framing a range of "
        "distant jagged peaks. Her knit cap and the collar of her fleece are the only spot "
        "colour (formalin green). On the far horizon a towering wall of grey snow cloud, drawn in "
        "dense screentone, is rolling in. Cold afternoon light, long shadows on wind-carved snow. "
        "Vast, beautiful, a first hint of threat. Plain camera, no brand.",
        # p2 — whiteout, sprained ankle, off the trail
        "Scene: a near-total whiteout on the mountain ridge: swirling snow drawn with strong "
        "diagonal speed lines and white-on-grey screentone erases the horizon. A faint dark "
        "silhouette of the hiker seen from behind, her green cap (the spot colour) the only "
        "colour, one leg buckling as her boot plunges off the hidden edge of a snow drift, arms "
        "thrown out for balance. Far off to the side, away from her path, a single thin "
        "trail-marker pole is barely visible through the snow. Disorienting, dangerous. No "
        "injury shown, no face visible.",
        # p3 — night, shivering in the lee of a boulder
        "Scene: night in a rocky mountain gully, heavy solid blacks. Seen from a distance and "
        "slightly behind, a small silhouette of the woman sits hunched in the lee of a large "
        "boulder, knees drawn up, arms wrapped tightly around herself; her outline is echoed by "
        "a few short parallel vibration strokes to show she is shivering hard (lines only, no "
        "letters). The green of her cap and fleece (the spot colour) is dim. Snow streaks "
        "sideways in the wind; a faint cold moonlit edge on the rocks. Lonely, enduring.",
        # p4 — paradoxical undressing: cap, gloves, jacket dropped along the trail
        "Scene: a clear, completely still night after the storm, bright moonlight on a snow "
        "slope among dark rocks, a sky of screentone stars. A single line of uneven, stumbling "
        "footprints winds up toward a cluster of boulders; along it, spaced far apart, lie a "
        "green knit cap (the spot colour), a pair of dark gloves and a dark shell jacket lying "
        "flat and empty, dropped one after another. Far in the distance a small dark silhouette "
        "seen from behind, fully clothed in a fleece top (spot colour) and dark trousers, "
        "stumbles toward the rocks. Quiet, eerie, beautiful. No bare skin, no nudity, no face.",
        # p5 — terminal burrowing: the crevice at dawn (no person)
        "Scene: pre-dawn, the sky turning pale and clear above. A close, low view of two large "
        "dark boulders leaning together with a narrow sheltered crevice between them, fresh "
        "snow drifted at its mouth. A single trail of footprints and dragging hand marks in the "
        "snow leads into the dark gap and disappears inside. The only colour is a thin, faint "
        "formalin-green glow (the spot colour) along the first light on the horizon and on the "
        "rim of the crevice. No person visible, nothing inside the gap is shown. Still, solemn, "
        "respectful, not frightening.",
    ],
}


def build_jobs() -> list[dict]:
    jobs = []
    for cid, scenes in PANELS.items():
        name, hexv = ACCENTS[cid]
        for i, scene in enumerate(scenes, start=1):
            prompt = "\n\n".join([
                "One panel of a wordless five-panel story sequence for a mystery adventure video game.",
                scene,
                CAST[cid],
                panel_style(name, hexv),
                PANEL_NEGATIVE,
            ])
            jobs.append(job(prompt, ART_SRC / "panels" / f"{cid}-panel-{i}.png", "1536x1024",
                            f"reconstruction panel {cid} p{i}"))
    return jobs


def main() -> None:
    jobs_dir = ART_SRC / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    (ART_SRC / "panels").mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])  # e.g. c01-panel-3 c02-panel-5 -> writes a retry file
    jobs = build_jobs()
    if only:
        jobs = [j for j in jobs if Path(j["out"]).stem in only]
        out = jobs_dir / "batch2-retry.json"
    else:
        out = jobs_dir / "batch2-panels.json"
    out.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(jobs)} jobs to {out}")


if __name__ == "__main__":
    main()
