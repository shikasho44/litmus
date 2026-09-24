"""Remove tiny pseudo-text artefacts (garment labels, sign scribbles) from a generated image.

Only ever REMOVES marks by inpainting from the surroundings; never adds anything.

    python scripts/art/retouch.py --image art-src/bg/c03-bg.png --box 526,568,564,590 [--min-luma 50]

Pixels inside the box brighter than --min-luma are masked (then dilated by 1px) and filled
with OpenCV Telea inpainting. The file is overwritten in place; keep the original elsewhere.
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
    args = ap.parse_args()

    img = cv2.imdecode(np.fromfile(args.image, dtype=np.uint8), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(gray.shape, np.uint8)
    for box in args.box.split(";"):
        x0, y0, x1, y1 = (int(v) for v in box.split(","))
        sub = gray[y0:y1, x0:x1]
        mask[y0:y1, x0:x1] = (sub > args.min_luma).astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    out = cv2.inpaint(img, mask, args.radius, cv2.INPAINT_TELEA)
    ok, buf = cv2.imencode(".png", out)
    assert ok
    buf.tofile(args.image)
    print(f"inpainted {int((mask > 0).sum())} px in {args.image}")


if __name__ == "__main__":
    main()
