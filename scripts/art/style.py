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
