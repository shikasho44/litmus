"""Remove tiny pseudo-text artefacts (garment labels, sign scribbles) from a generated image.

Only ever REMOVES marks by inpainting from the surroundings; never adds anything.

    python scripts/art/retouch.py --image art-src/bg/c03-bg.png --box 526,568,564,590 [--min-luma 50]

Pixels inside the box brighter than --min-luma are masked (then dilated by 1px) and filled
with OpenCV Telea inpainting. The file is overwritten in place; keep the original elsewhere.
--max-luma limits the mask to pixels darker than it (e.g. white badge on a dark sleeve next
to a mid-grey wall: --min-luma 170). --grain re-adds film/screentone grain measured on a
ring around the mask, so a filled patch in a grainy area does not read as a smooth smudge.
--enclosed keeps only the masked blobs that do NOT touch the box edge (a badge enclosed by a
black ink outline, while the wall behind it touches the box edge and is left alone).
--flat fills with the median colour of the surrounding ring instead of Telea (for a blurred,
out-of-focus flat surface, where Telea leaves a visible gradient smear).
"""

from __future__ import annotations

import argparse

import cv2
import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--box", required=True, help="x0,y0,x1,y1 in pixels (can repeat with ';')")
    ap.add_argument("--min-luma", type=int, default=50)
    ap.add_argument("--radius", type=int, default=3)
    ap.add_argument("--max-luma", type=int, default=256)
    ap.add_argument("--grain", action="store_true")
    ap.add_argument("--enclosed", action="store_true")
    ap.add_argument("--flat", action="store_true")
    ap.add_argument("--grain-scale", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    img = cv2.imdecode(np.fromfile(args.image, dtype=np.uint8), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(gray.shape, np.uint8)
    for box in args.box.split(";"):
        x0, y0, x1, y1 = (int(v) for v in box.split(","))
        sub = gray[y0:y1, x0:x1]
        m = ((sub > args.min_luma) & (sub < args.max_luma)).astype(np.uint8)
        if args.enclosed:
            n, lab = cv2.connectedComponents(m, connectivity=4)
            edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
            m = (np.isin(lab, [i for i in range(1, n) if i not in edge])).astype(np.uint8)
        mask[y0:y1, x0:x1] = m * 255
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    out = cv2.inpaint(img, mask, args.radius, cv2.INPAINT_TELEA)
    if args.flat:
        ring0 = (cv2.dilate(mask, np.ones((7, 7), np.uint8)) > 0) & (mask == 0)
        out = img.copy()
        out[mask > 0] = np.median(img[ring0], axis=0).astype(np.uint8)
    if args.grain:
        f = img.astype(np.float32)
        hp = f - cv2.GaussianBlur(f, (0, 0), 1.5)
        ring = (cv2.dilate(mask, np.ones((15, 15), np.uint8)) > 0) & (mask == 0)
        std = hp[ring].std(axis=0)
        rng = np.random.default_rng(args.seed)
        noise = rng.normal(0, 1, img.shape[:2])[..., None] * std[None, None, :] * args.grain_scale
        o = out.astype(np.float32)
        sel = mask > 0
        o[sel] += noise[sel]
        out = np.clip(o, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".png", out)
    assert ok
    buf.tofile(args.image)
    print(f"inpainted {int((mask > 0).sum())} px in {args.image}")


if __name__ == "__main__":
    main()
