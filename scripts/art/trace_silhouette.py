"""Traces the shard-mask outline of an object soul's portrait into case.json (victim.silhouette).

The intro cases' victims are objects (a milk bottle, a snowman, a rose). Their portraits are
still lifes on the usual plain dark navy ground, so the outline can be read straight from the
image instead of being hand-drawn: everything that is clearly lighter or more colourful than the
ground is the subject. The mask is closed, a little dilated (thin twigs and stems still get
glass shards) and simplified into an SVG path in the 300×400 box that ShardPortrait uses
(src/ui/shards.ts). The portrait is shown there with preserveAspectRatio="xMidYMid slice", so a
1024×1536 image is scaled to 300×450 and cut 25 units top and bottom — the same mapping here.

Usage (from the project root, after export_art.py portraits):
    python scripts/art/trace_silhouette.py              # c05 c06 c07 → writes victim.silhouette
    python scripts/art/trace_silhouette.py c06 --dry    # print the path only
    python scripts/art/trace_silhouette.py --preview    # also writes qa/art/silhouette-<id>.png
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, ROOT  # noqa: E402

BOX_W, BOX_H = 300, 400
CASES = {"c05": "c05-tiptoe-milk-bottle", "c06": "c06-snowman-below-zero", "c07": "c07-thirst-beside-water"}
# per case: colour distance from the ground that counts as subject, closing kernel (source pixels,
# bridges dark parts such as the snowman's scarf), extra dilation for thin twigs / stems,
# simplification tolerance (box units)
TUNE = {"c05": (38, 31, 10, 1.2), "c06": (20, 141, 16, 1.2), "c07": (38, 31, 26, 1.0)}
GROUND = np.array([0x0B, 0x0D, 0x12], dtype=np.float32)


def mask_of(img: np.ndarray, threshold: float, close: int, dilate: int) -> np.ndarray:
    diff = np.linalg.norm(img.astype(np.float32) - GROUND, axis=2)
    m = (diff > threshold).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)                         # specks of halftone in the ground
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close)))
    if dilate:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate * 2 + 1, dilate * 2 + 1)))
    # fill holes (the inside of a glass bottle, gaps between arms and body stay open only if outside)
    ff = m.copy()
    h, w = m.shape
    cv2.floodFill(ff, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 255)
    return m | cv2.bitwise_not(ff)


def trace(cid: str, preview: bool = False) -> str:
    src = ART_SRC / "portraits" / f"{cid}-portrait.png"
    img = np.array(Image.open(src).convert("RGB"))
    h, w = img.shape[:2]
    threshold, close, dilate, eps = TUNE[cid]
    m = mask_of(img, threshold, close, dilate)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contours = [c for c in contours if cv2.contourArea(c) > 0.004 * w * h]
    scale = max(BOX_W / w, BOX_H / h)
    ox, oy = (BOX_W - w * scale) / 2, (BOX_H - h * scale) / 2
    parts = []
    for c in sorted(contours, key=cv2.contourArea, reverse=True):
        pts = c.reshape(-1, 2).astype(np.float32) * scale + np.array([ox, oy], dtype=np.float32)
        pts[:, 0] = np.clip(pts[:, 0], 0, BOX_W)
        pts[:, 1] = np.clip(pts[:, 1], 0, BOX_H)
        approx = cv2.approxPolyDP(pts.reshape(-1, 1, 2), eps, True).reshape(-1, 2)
        if len(approx) < 3:
            continue
        parts.append("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in approx) + " Z")
    path = " ".join(parts)
    if preview:
        out = ROOT / "qa" / "art" / f"silhouette-{cid}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        disp = Image.fromarray(img).resize((round(w * scale), round(h * scale)))
        canvas = Image.new("RGB", (BOX_W, BOX_H), (40, 0, 0))
        canvas.paste(disp, (round(ox), round(oy)))
        d = ImageDraw.Draw(canvas)
        for part in parts:
            nums = [float(v) for v in part.replace("M", " ").replace("L", " ").replace("Z", " ").split()]
            xy = list(zip(nums[0::2], nums[1::2]))
            d.line(xy + [xy[0]], fill=(0, 255, 180), width=2)
        canvas.resize((BOX_W * 2, BOX_H * 2)).save(out)
    return path


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry, preview = "--dry" in sys.argv, "--preview" in sys.argv
    for cid in args or list(CASES):
        path = trace(cid, preview)
        print(f"{cid}: {len(path)} chars, {path.count('M')} part(s)")
        if dry:
            print(path)
            continue
        f = ROOT / "content" / "cases" / CASES[cid] / "case.json"
        data = json.loads(f.read_text(encoding="utf-8"))
        data["victim"]["silhouette"] = path
        f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  -> {f.relative_to(ROOT)} victim.silhouette")


if __name__ == "__main__":
    main()
