"""Split a transparent character sheet (N figures side by side) into N trimmed RGBA PNGs.

Figures are found by ALPHA COLUMN PROJECTION: columns that contain opaque pixels form runs;
runs are merged (smallest first, into the nearest neighbour) until N remain, or the widest run
is cut at its thinnest column if figures touch. Each figure is then trimmed to its alpha bbox
plus a transparent margin.

Usage:
    python scripts/art/split_sheet.py --sheet art-src/holma/holma-sheet.png \
        --names normal,laugh,surprised,serious --out-dir art-src/holma/split [--margin 24] [--uniform]

If the sheet came back without real alpha (RGB, or alpha extrema (255,255)), pass --key-bg to
remove a flat background colour first with the Codex imagegen skill's remove_chroma_key.py.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ALPHA_ON = 24          # alpha above this counts as "figure"
MIN_SPECK_AREA = 150   # isolated blobs smaller than this (px) are treated as noise and cleared
CHROMA_SCRIPT = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".codex/skills/.system/imagegen/scripts/remove_chroma_key.py"


def has_real_alpha(im: Image.Image) -> bool:
    return im.mode == "RGBA" and im.getchannel("A").getextrema()[0] == 0


def key_out(sheet: Path) -> Path:
    out = sheet.with_name(sheet.stem + "-keyed.png")
    cmd = [sys.executable, str(CHROMA_SCRIPT), "--input", str(sheet), "--out", str(out), "--force",
           "--auto-key", "corners", "--soft-matte", "--despill", "--spill-cleanup", "--edge-feather", "1"]
    subprocess.run(cmd, check=True)
    return out


def clear_specks(rgba: np.ndarray) -> int:
    from scipy import ndimage

    mask = rgba[:, :, 3] > ALPHA_ON
    labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return 0
    areas = ndimage.sum_labels(mask, labels, index=np.arange(1, n + 1))
    small = np.where(areas < MIN_SPECK_AREA)[0] + 1
    if len(small):
        kill = np.isin(labels, small)
        # also clear the faint fringe around them
        kill = ndimage.binary_dilation(kill, iterations=2)
        rgba[kill, 3] = 0
    return len(small)


def find_columns(mask: np.ndarray, n: int) -> list[tuple[int, int]]:
    proj = mask.sum(axis=0)
    on = proj > 0
    segs: list[list[int]] = []
    x = 0
    W = len(proj)
    while x < W:
        if on[x]:
            s = x
            while x < W and on[x]:
                x += 1
            segs.append([s, x - 1])
        else:
            x += 1
    if not segs:
        raise SystemExit("no opaque pixels found")

    def mass(s):
        return int(proj[s[0]:s[1] + 1].sum())

    while len(segs) > n:
        i = min(range(len(segs)), key=lambda k: mass(segs[k]))
        left_gap = segs[i][0] - segs[i - 1][1] if i > 0 else 10**9
        right_gap = segs[i + 1][0] - segs[i][1] if i + 1 < len(segs) else 10**9
        j = i - 1 if left_gap <= right_gap else i + 1
        a, b = sorted((i, j))
        segs[a] = [segs[a][0], segs[b][1]]
        del segs[b]

    while len(segs) < n:
        i = max(range(len(segs)), key=lambda k: segs[k][1] - segs[k][0])
        s0, s1 = segs[i]
        lo = s0 + (s1 - s0) // 5
        hi = s1 - (s1 - s0) // 5
        cut = lo + int(np.argmin(proj[lo:hi + 1]))
        segs[i:i + 1] = [[s0, cut], [cut + 1, s1]]
        print(f"WARN: figures touch; cut run {s0}-{s1} at column {cut}", file=sys.stderr)

    return [(a, b) for a, b in segs]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True)
    ap.add_argument("--names", required=True, help="comma separated, left to right")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--margin", type=int, default=24)
    ap.add_argument("--key-bg", action="store_true", help="chroma-key a flat background first")
    ap.add_argument("--uniform", action="store_true",
                    help="pad every figure to one common canvas, bottom-aligned and centred on its base "
                         "(the bottom rows, e.g. the crate) so expression swaps never shift the character")
    ap.add_argument("--alpha-levels", default="8,245",
                    help="lo,hi: alpha<=lo -> 0, alpha>=hi -> 255, linear between. gpt-image often "
                         "returns 'opaque' pixels at alpha 251-254 plus a faint 1-8 haze; this fixes both. "
                         "Use 0,255 to disable.")
    args = ap.parse_args()

    sheet = Path(args.sheet)
    names = [s.strip() for s in args.names.split(",") if s.strip()]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    im = Image.open(sheet)
    if not has_real_alpha(im):
        if not args.key_bg:
            raise SystemExit(f"{sheet} has no real alpha (mode={im.mode}); rerun with --key-bg or regenerate")
        im = Image.open(key_out(sheet))
    rgba = np.array(im.convert("RGBA"))
    lo, hi = (int(v) for v in args.alpha_levels.split(","))
    if (lo, hi) != (0, 255):
        a = rgba[:, :, 3].astype(np.float32)
        rgba[:, :, 3] = np.clip((a - lo) * 255.0 / (hi - lo), 0, 255).round().astype(np.uint8)
    cleared = clear_specks(rgba)
    mask = rgba[:, :, 3] > ALPHA_ON
    cols = find_columns(mask, len(names))

    report = {"sheet": str(sheet), "size": list(im.size), "specks_cleared": cleared,
              "uniform": args.uniform, "figures": {}}
    m = args.margin
    crops = []
    for name, (x0, x1) in zip(names, cols):
        sub = rgba[:, x0:x1 + 1]
        rows = np.where((sub[:, :, 3] > ALPHA_ON).any(axis=1))[0]
        y0, y1 = int(rows[0]), int(rows[-1])
        crop = sub[y0:y1 + 1]
        # base centre: horizontal middle of the opaque pixels in the bottom 4% of the figure
        band = crop[-max(4, crop.shape[0] // 25):, :, 3] > ALPHA_ON
        bx = np.where(band.any(axis=0))[0]
        base_cx = (bx[0] + bx[-1]) / 2 if len(bx) else crop.shape[1] / 2
        crops.append((name, x0, x1, y0, y1, crop, base_cx))

    if args.uniform:
        half = max(max(cx, c.shape[1] - cx) for *_, c, cx in crops)
        W = int(np.ceil(half)) * 2 + 2 * m
        H = max(c.shape[0] for *_, c, _ in crops) + 2 * m

    for name, x0, x1, y0, y1, crop, base_cx in crops:
        h, w = crop.shape[:2]
        if args.uniform:
            canvas = np.zeros((H, W, 4), dtype=np.uint8)
            ox = int(round(W / 2 - base_cx))
            oy = H - m - h
            canvas[oy:oy + h, ox:ox + w] = crop
        else:
            canvas = np.zeros((h + 2 * m, w + 2 * m, 4), dtype=np.uint8)
            canvas[m:m + h, m:m + w] = crop
        out = Image.fromarray(canvas, "RGBA")
        path = out_dir / f"{name}.png"
        out.save(path, optimize=True)
        ext = out.getchannel("A").getextrema()
        report["figures"][name] = {
            "path": str(path), "src_box": [int(x0), y0, int(x1), y1],
            "size": list(out.size), "alpha_extrema": list(ext),
            "touches_edge": bool(x0 == 0 or x1 == im.size[0] - 1 or y0 == 0 or y1 == im.size[1] - 1),
        }
    print(json.dumps(report, indent=2))
    bad = [k for k, v in report["figures"].items() if tuple(v["alpha_extrema"]) != (0, 255)]
    if bad:
        print(f"ERROR: alpha extrema not (0,255) for {bad}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
