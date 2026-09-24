"""Export the reconstruction comic panels to the paths the case files reference.

Usage (from the project root):
    python scripts/art/export_panels.py            # all panels that have a source
    python scripts/art/export_panels.py --sheet    # also writes qa/art/panels-contact.png

    art-src/panels/c0N-panel-N.png  ->  public/cases/c0N/panel-N.webp   (1280x853, q84)

Every content/cases/*/case.json reconstruction.panels[].image is checked: a referenced image
without a source, or a source nobody references, is reported and exits non-zero.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from export_art import cover_resize, save_webp  # noqa: E402
from style import ART_SRC, PUBLIC, ROOT  # noqa: E402

W, H, Q = 1280, 853, 84


def referenced() -> dict[str, str]:
    """image path under public/ -> case id, from every case.json."""
    refs: dict[str, str] = {}
    for f in sorted((ROOT / "content" / "cases").glob("*/case.json")):
        case = json.loads(f.read_text(encoding="utf-8"))
        for p in case.get("reconstruction", {}).get("panels", []):
            if p.get("image"):
                refs[p["image"]] = case.get("id", f.parent.name)
    return refs


def main() -> int:
    refs = referenced()
    done: set[str] = set()
    thumbs = []
    for src in sorted((ART_SRC / "panels").glob("c0*-panel-*.png")):
        m = re.fullmatch(r"(c0\d)-panel-(\d)", src.stem)
        if not m:
            continue
        rel = f"cases/{m[1]}/panel-{m[2]}.webp"
        im = Image.open(src).convert("RGB")
        out = cover_resize(im, W, H)
        save_webp(out, PUBLIC / rel, quality=Q)
        done.add(rel)
        thumbs.append((rel, out))
    problems = [f"referenced but not exported: {r}" for r in refs if r not in done]
    problems += [f"exported but not referenced by any case.json: {r}" for r in done if r not in refs]
    for p in problems:
        print("WARN", p)

    if "--sheet" in sys.argv and thumbs:
        tw, th, cols = 426, 284, 5
        rows = (len(thumbs) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw + (cols + 1) * 8, rows * th + (rows + 1) * 8), (11, 13, 18))
        for i, (_, im) in enumerate(thumbs):
            x, y = 8 + (i % cols) * (tw + 8), 8 + (i // cols) * (th + 8)
            sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
        dst = ROOT / "qa" / "art" / "panels-contact.png"
        dst.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(dst)
        print(f"  contact sheet: {dst}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
