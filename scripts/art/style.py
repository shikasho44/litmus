"""Shared art-direction strings for every generated image (design-bible §7).

Import from other scripts in this folder:
    from style import STYLE, NEGATIVE, ROOT, ART_SRC, job
Batch 2 (comic panels) should build its prompts from the same STYLE / NEGATIVE so the
whole game reads as one visual system.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ART_SRC = ROOT / "art-src"
PUBLIC = ROOT / "public"

STYLE = (
    "Art style: bold graphic-novel illustration, confident black ink linework, flat cel shading "
    "with subtle halftone screentone dots in the shadows, limited palette (ink navy #0B0D12, "
    "bone white #F2EFE6, formalin green #C6FF3D accents, alarm magenta #FF2E63 accents, "
    "cold teal shadows #1B3A44), dramatic theatrical lighting, stylish, elegant, slightly "
    "unsettling, intelligent mystery mood. Polished key-visual quality for a premium "
    "mystery adventure video game."
)

NEGATIVE = (
    "Strict constraints: NO gore, NO blood, NO wounds, NO text, NO letters, NO numbers, "
    "NO numerals, NO writing of any kind, NO captions, NO speech bubbles, NO logos, "
    "NO watermark, NO signature, NO frame, NO border."
)


# ---- batch 2: reconstruction comic panels (design-bible §7-5) ---------------------------
# Same ink-and-screentone DNA as STYLE, but printed-manga look: black ink on warm paper with
# ONE spot colour per case. Manga panels love lettering, so the ban is spelled out at length.

def panel_style(accent_name: str, accent_hex: str) -> str:
    return (
        "Format: ONE single wordless (silent) manga / graphic-novel panel that fills the whole "
        "canvas edge to edge: full bleed, no panel border, no gutter, no multi-panel page layout. "
        "Art style: bold confident black ink brush and pen linework, crisp cross-hatching and "
        "printed dot screentone (halftone) for all greys and shadows, on warm off-white paper "
        "(#F2EAD8). The image is essentially black ink on paper EXCEPT for ONE single spot accent "
        f"colour, {accent_name} ({accent_hex}), used sparingly only where the scene says; no other "
        "colours. Dynamic cinematic composition, dramatic camera angle, strong readable "
        "silhouettes, deep blacks, elegant and restrained, intelligent and quietly unsettling "
        "mystery mood, respectful and non-graphic. Figures are drawn as dark silhouettes or seen "
        "from behind; faces are never shown. Premium published graphic-novel quality."
    )


PANEL_NEGATIVE = (
    "ABSOLUTELY NO TEXT OF ANY KIND ANYWHERE: no lettering, no speech balloons, no thought "
    "bubbles, no caption boxes, no narration boxes, no sound-effect lettering or onomatopoeia "
    "(neither Japanese kana/kanji nor Latin letters), no numbers or numerals (clocks, screens "
    "and dials are blank), no signs or signage, no labels, no brand names, no logos, no "
    "watermark, no signature, no panel number. Use only pictures, lines, tone and light. "
    "NO gore, NO blood, NO wounds, NO injuries shown, NO dead bodies, NO nudity, NO bare skin "
    "beyond hands, NO frightening faces."
)


# Per-job manifests are written OUTSIDE the repo and merged into art-src/manifest.json by
# parallel_imagegen.py --merge-into, so no *.manifest.json litter ends up in art-src/.
TMP_MANIFESTS = Path(tempfile.gettempdir()) / "janedoe-art-manifests"


def job(prompt: str, out: Path, size: str, note: str, quality: str = "high",
        refs: list[Path] | None = None) -> dict:
    """One entry for parallel_imagegen.py --jobs."""
    d = {
        "prompt": prompt.strip(),
        "out": out.as_posix(),
        "size": size,
        "quality": quality,
        "note": note,
        "manifest": (TMP_MANIFESTS / f"{out.stem}.manifest.json").as_posix(),
    }
    if refs:
        d["refs"] = [p.as_posix() for p in refs]
    return d
