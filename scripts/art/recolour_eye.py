"""Recolour Holma's glass eye from red (#FF2E63) to taxidermy AMBER (#FFB020) without regenerating.

Usage (from the project root):
    python scripts/art/recolour_eye.py            # recolour sources, re-export webp/og, write QA crops
    python scripts/art/recolour_eye.py --no-export

What it does
  1. Keeps the untouched originals once, with a ".red-eye" suffix:
       art-src/holma/split/<name>.red-eye.png, art-src/key-art/key-art.red-eye.png
       art-src/red-eye-originals/{holma-<name>.webp, key-art.webp, og.png}  (published files)
     Every run reads those originals, so it is idempotent.
  2. Finds the eye automatically: saturated red/magenta pixels (hue 300-12 deg, S>0.5, V>0.3)
     inside the HEAD box around the face anchor from art-src/holma/face.json (sprites) or inside
     the rabbit's head area (key art). The most saturated compact component is the eye; tiny
     equally-saturated fragments within a few px are added (the squinting "laugh" eye is split
     in two). The mask is that seed, dilated 2 px plus its convex hull (within 4 px), holes
     filled (so the specular highlights, even where they touch the black rim, are included),
     plus strongly red rim pixels up to 3 px out, with a half-weight 1 px outer ring. The pink
     nose, the open mouths and the paw pads are lower-saturation separate components and never
     enter the mask.
  3. Inside the mask, per pixel in HSV: hue -> 23 + 17*V degrees (bright iris ~40 deg = #FFB020,
     shaded pupil ~30 deg = deep amber-brown instead of olive), S x1.1 and V^0.92, so every
     shading step, the black rim and the white specular highlight survive; pale pink glints
     become warm cream. Weight = spatial mask x hue closeness to red x saturation ramp.
     Alpha is copied bit-exact.
  4. Re-exports public/art/holma/*.webp, public/art/key-art.webp and public/og.png through
     export_art.py, and writes before/after crops to qa/art/.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, PUBLIC, ROOT  # noqa: E402

NAMES = ["normal", "laugh", "surprised", "serious"]
QA = ROOT / "qa" / "art"
ORIG_DIR = ART_SRC / "red-eye-originals"


# ------------------------------------------------------------------ colour helpers

def rgb_to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rgb = rgb.astype(np.float64) / 255.0
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-9
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = ((b - r)[gm] / d[gm]) + 2
    h[bm] = ((r - g)[bm] / d[bm]) + 4
    h *= 60.0
    s = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0.0)
    return h, s, mx


def hsv_to_rgb(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    h6 = (h % 360.0) / 60.0
    i = np.floor(h6).astype(int) % 6
    f = h6 - np.floor(h6)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    out = np.zeros(h.shape + (3,))
    for k, (rr, gg, bb) in enumerate([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]):
        sel = i == k
        out[..., 0][sel] = rr[sel]
        out[..., 1][sel] = gg[sel]
        out[..., 2][sel] = bb[sel]
    return out * 255.0


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def red_closeness(h: np.ndarray) -> np.ndarray:
    """1 for hue in [325, 8] deg, fading to 0 at 300 and 22."""
    dist = np.minimum(np.abs(((h - 346.5) + 180) % 360 - 180), 360)  # distance from 346.5 deg
    return 1 - smoothstep(21.5, 46.5, dist)


# ------------------------------------------------------------------ eye mask

def disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def convex_hull_mask(m: np.ndarray) -> np.ndarray:
    from PIL import ImageDraw
    from scipy.spatial import ConvexHull

    ys, xs = np.nonzero(m)
    pts = np.stack([xs, ys], 1).astype(float)
    hull = ConvexHull(pts)
    poly = [tuple(pts[i]) for i in hull.vertices]
    im = Image.new("L", (m.shape[1], m.shape[0]), 0)
    ImageDraw.Draw(im).polygon(poly, fill=255, outline=255)
    return np.array(im) > 0


def find_eye(rgb: np.ndarray, alpha: np.ndarray | None, box: tuple[int, int, int, int]) -> tuple[np.ndarray, dict]:
    H, W = rgb.shape[:2]
    x0, y0, x1, y1 = (max(0, box[0]), max(0, box[1]), min(W, box[2]), min(H, box[3]))
    h, s, v = rgb_to_hsv(rgb)
    red = ((h >= 300) | (h <= 12)) & (s > 0.5) & (v > 0.3)
    if alpha is not None:
        red &= alpha > 100
    roi = np.zeros_like(red)
    roi[y0:y1, x0:x1] = True
    red &= roi
    lab, n = ndimage.label(red, structure=np.ones((3, 3)))
    if n == 0:
        raise SystemExit("no red pixels in the head box")
    idx = np.arange(1, n + 1)
    size = ndimage.sum_labels(red, lab, idx)
    mean_s = ndimage.mean(s, lab, idx)
    cand = [(int(size[i]), i + 1) for i in range(n) if mean_s[i] > 0.7 and size[i] >= 30]
    if not cand:
        raise SystemExit("no saturated eye-like component found")
    cand.sort(reverse=True)
    main = cand[0][1]
    near = ndimage.binary_dilation(lab == main, structure=disk(6))
    seed = lab == main
    extra = []
    for i in range(n):
        if i + 1 != main and mean_s[i] > 0.7 and size[i] >= 4 and (near & (lab == i + 1)).any():
            seed |= lab == i + 1
            extra.append(int(size[i]))
    # Specular highlights often touch the black rim, so hole-filling alone leaves a pink fringe
    # on them: also take the seed's convex hull, but only within 4 px of the seed (keeps the
    # laugh crescent's concave side and the nose out).
    region = ndimage.binary_dilation(seed, structure=disk(2))
    region |= convex_hull_mask(seed) & ndimage.binary_dilation(seed, structure=disk(4))
    region = ndimage.binary_fill_holes(region)
    # thin rim band: strongly red pixels up to 3 px out (glass meeting the black outline);
    # the nose / mouth pinks are below S 0.55 or further away.
    band = ndimage.binary_dilation(seed, structure=disk(3)) & ~region
    region |= band & ((h >= 300) | (h <= 15)) & (s > 0.55) & (v > 0.2)
    # glints enclosed by the black outline ring (the squinting eye's highlight sits outside
    # the saturated seed): fill the loop formed by the region plus nearby dark outline pixels.
    near = ndimage.binary_dilation(seed, structure=disk(4))
    outline = near & (v < 0.3)
    region |= ndimage.binary_fill_holes(region | outline) & ~outline & near
    # pale pink glints on the rim (bright, low-saturation) within 3 px, unless they belong to
    # another pinkish shape (nose, mouth): those shapes plus 2 px are excluded.
    reddish = ((h >= 300) | (h <= 15)) & (s > 0.25) & (v > 0.3)
    if alpha is not None:
        reddish &= alpha > 100
    rlab, rn = ndimage.label(reddish, structure=np.ones((3, 3)))
    touching = set(np.unique(rlab[ndimage.binary_dilation(seed, structure=disk(1)) & reddish])) - {0}
    others = (rlab > 0) & ~np.isin(rlab, list(touching))
    keep_out = ndimage.binary_dilation(others, structure=disk(2))
    glint = band & ((h >= 300) | (h <= 15)) & (s > 0.12) & (v > 0.75) & ~keep_out
    region |= glint
    # full weight inside the region, half weight on a 1 px outer ring (anti-aliasing); the
    # hue/saturation terms in recolour() already fade the effect to zero on non-red pixels.
    ring = ndimage.binary_dilation(region, structure=disk(1)) & ~region
    spatial = region.astype(np.float64) + 0.5 * ring
    ys, xs = np.nonzero(seed)
    info = {"seed_px": int(seed.sum()), "extra_fragments": extra, "mask_px": int(region.sum()),
            "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            "other_red_components_in_box": int(n - 1 - len(extra))}
    return spatial, info


def recolour(rgb: np.ndarray, spatial: np.ndarray) -> np.ndarray:
    h, s, v = rgb_to_hsv(rgb)
    w = spatial * red_closeness(h) * smoothstep(0.06, 0.22, s)
    new_h = 23.0 + 17.0 * v                      # V=1 -> 40 deg (#FFB020), shade -> amber-brown
    new = hsv_to_rgb(new_h, np.minimum(1.0, s * 1.1), v ** 0.92)  # amber glass reads a touch brighter
    out = rgb.astype(np.float64) * (1 - w[..., None]) + new * w[..., None]
    return np.clip(np.round(out), 0, 255).astype(np.uint8), w


# ------------------------------------------------------------------ files

def keep_original(src: Path, suffix: str = ".red-eye") -> Path:
    orig = src.with_name(src.stem + suffix + src.suffix)
    if not orig.exists():
        shutil.copy2(src, orig)
        print(f"  kept original -> {orig.relative_to(ROOT)}")
    return orig


def keep_published() -> None:
    ORIG_DIR.mkdir(parents=True, exist_ok=True)
    pairs = [(PUBLIC / "art" / "holma" / f"{n}.webp", ORIG_DIR / f"holma-{n}.webp") for n in NAMES]
    pairs += [(PUBLIC / "art" / "key-art.webp", ORIG_DIR / "key-art.webp"), (PUBLIC / "og.png", ORIG_DIR / "og.png")]
    for src, dst in pairs:
        if not dst.exists() and src.exists():
            shutil.copy2(src, dst)
            print(f"  kept published original -> {dst.relative_to(ROOT)}")


def zoom_pair(before: Image.Image, after: Image.Image, box: tuple[int, int, int, int], scale: int) -> Image.Image:
    tiles = []
    for im in (before, after):
        c = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (60, 64, 80, 255))
        c.alpha_composite(im.convert("RGBA").crop(box))
        tiles.append(c.resize((c.width * scale, c.height * scale), Image.NEAREST))
    out = Image.new("RGBA", (tiles[0].width * 2 + 8, tiles[0].height), (0, 0, 0, 255))
    out.paste(tiles[0], (0, 0))
    out.paste(tiles[1], (tiles[0].width + 8, 0))
    return out


def stack(rows: list[Image.Image]) -> Image.Image:
    W = max(r.width for r in rows)
    H = sum(r.height for r in rows) + 8 * (len(rows) - 1)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    y = 0
    for r in rows:
        out.paste(r, (0, y))
        y += r.height + 8
    return out


def main() -> None:
    QA.mkdir(parents=True, exist_ok=True)
    faces = json.loads((ART_SRC / "holma" / "face.json").read_text(encoding="utf-8"))
    keep_published()
    report: dict = {}
    zooms, heads = [], []

    print("holma sprites")
    for name in NAMES:
        src = ART_SRC / "holma" / "split" / f"{name}.png"
        orig = keep_original(src)
        im = Image.open(orig).convert("RGBA")
        a = np.array(im)
        H, W = a.shape[:2]
        fx, fy = faces[name]["x"] * W, faces[name]["y"] * H
        box = (int(fx - 0.25 * W), int(fy - 0.12 * H), int(fx + 0.25 * W), int(fy + 0.10 * H))
        spatial, info = find_eye(a[..., :3], a[..., 3], box)
        rgb, w = recolour(a[..., :3], spatial)
        out = np.dstack([rgb, a[..., 3]])
        assert np.array_equal(out[..., 3], a[..., 3])
        changed = int((np.abs(rgb.astype(int) - a[..., :3].astype(int)).sum(-1) > 0).sum())
        info["changed_px"] = changed
        report[name] = info
        after = Image.fromarray(out, "RGBA")
        after.save(src, optimize=True)
        print(f"  {name}: {info}")
        bx0, by0, bx1, by1 = info["bbox"]
        cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2
        zooms.append(zoom_pair(im, after, (cx - 28, cy - 24, cx + 28, cy + 24), 6))
        heads.append(zoom_pair(im, after, (int(fx - 110), int(fy - 110), int(fx + 110), int(fy + 110)), 2))

    print("key art")
    src = ART_SRC / "key-art" / "key-art.png"
    orig = keep_original(src)
    im = Image.open(orig).convert("RGB")
    a = np.array(im)
    H, W = a.shape[:2]
    # Holma stands in the right third; his head is in the upper half of that third.
    box = (int(0.62 * W), int(0.05 * H), int(0.95 * W), int(0.50 * H))
    spatial, info = find_eye(a, None, box)
    rgb, w = recolour(a, spatial)
    info["changed_px"] = int((np.abs(rgb.astype(int) - a.astype(int)).sum(-1) > 0).sum())
    # proof that nothing outside the eye moved (the magenta/red accents elsewhere stay)
    outside = spatial == 0
    info["outside_mask_changed_px"] = int((np.abs(rgb.astype(int) - a.astype(int)).sum(-1)[outside] > 0).sum())
    report["key-art"] = info
    after = Image.fromarray(rgb, "RGB")
    after.save(src, optimize=True)
    print(f"  key-art: {info}")
    bx0, by0, bx1, by1 = info["bbox"]
    cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2
    zooms.append(zoom_pair(im, after, (cx - 28, cy - 24, cx + 28, cy + 24), 6))
    heads.append(zoom_pair(im, after, (cx - 150, cy - 120, cx + 90, cy + 120), 2))

    stack(zooms).convert("RGB").save(QA / "eye-recolour-zoom.png")
    stack(heads).convert("RGB").save(QA / "eye-recolour-heads.png")
    (QA / "eye-recolour-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"  QA crops: {QA / 'eye-recolour-zoom.png'}, {QA / 'eye-recolour-heads.png'}")

    if "--no-export" not in sys.argv:
        import export_art
        export_art.export_holma()
        export_art.export_key()


if __name__ == "__main__":
    main()
