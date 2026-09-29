"""Convert raw generated PNGs in art-src/ into the web assets the game loads.

Usage (from the project root):
    python scripts/art/export_art.py            # everything that has a source
    python scripts/art/export_art.py holma      # only one group: holma | portraits | bg | key
    python scripts/art/export_art.py --check-face   # writes art-src/holma/split/_face-check.png

Outputs
    public/art/holma/{normal,laugh,surprised,serious}.webp   RGBA: lossy q95 colour + lossless alpha, max height 1400
    public/art/holma/meta.json                               {"normal":{"w","h","face":{"x","y"}}}
    public/cases/c0N/portrait.webp                           1024x1536, q88
    public/art/bg-*.webp, public/cases/c0N/bg.webp           1920x1080, q82
    public/art/key-art.webp                                  1920x1080, q85
    public/og.png                                            1200x630

Face centres for meta.json come from art-src/holma/face.json (normalized x/y, hand-checked);
a red-glass-eye heuristic fills in any missing entry (it only finds the eye on the red-eye
originals; since the amber recolour, keep face.json complete).
Holma's eye is recoloured red -> amber by recolour_eye.py, which edits art-src/holma/split/*.png
and art-src/key-art/key-art.png in place (originals: *.red-eye.png) and then calls this script.

Reusable helpers for batch 2: cover_resize(), save_webp().
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from style import ART_SRC, PUBLIC  # noqa: E402

HOLMA_NAMES = ["normal", "laugh", "surprised", "serious"]
HOLMA_MAX_H = 1400
HOLMA_QUALITY = 95

BG_MAP = {
    "room-zero": PUBLIC / "art" / "bg-room-zero.webp",
    "inquest": PUBLIC / "art" / "bg-inquest.webp",
    "science": PUBLIC / "art" / "bg-science.webp",
    "c01-bg": PUBLIC / "cases" / "c01" / "bg.webp",
    "c02-bg": PUBLIC / "cases" / "c02" / "bg.webp",
    "c03-bg": PUBLIC / "cases" / "c03" / "bg.webp",
    "c04-bg": PUBLIC / "cases" / "c04" / "bg.webp",
    # intro cases (2026-09-28): c05-c07 are CASE 01-03 in the game
    "c05-bg": PUBLIC / "cases" / "c05" / "bg.webp",
    "c06-bg": PUBLIC / "cases" / "c06" / "bg.webp",
    "c07-bg": PUBLIC / "cases" / "c07" / "bg.webp",
    # 2026-09-29: c08 is the new CASE 01 (the tutorial); the intro cases moved to CASE 02-04
    "c08-bg": PUBLIC / "cases" / "c08" / "bg.webp",
}


# ------------------------------------------------------------------ helpers

def cover_resize(im: Image.Image, w: int, h: int, focus: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    """Crop to the target aspect around `focus` (normalized), then resize with Lanczos."""
    sw, sh = im.size
    target = w / h
    if sw / sh > target:
        cw, ch = round(sh * target), sh
    else:
        cw, ch = sw, round(sw / target)
    cx = min(max(focus[0] * sw - cw / 2, 0), sw - cw)
    cy = min(max(focus[1] * sh - ch / 2, 0), sh - ch)
    box = (round(cx), round(cy), round(cx) + cw, round(cy) + ch)
    return im.crop(box).resize((w, h), Image.LANCZOS)


def save_webp(im: Image.Image, path: Path, quality: int | None = None, lossless: bool = False) -> None:
    """Lossy by default. An RGBA image keeps its alpha lossless (alpha_quality=100) either way."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if lossless:
        im.save(path, "WEBP", lossless=True, quality=100, method=6)
    else:
        im.save(path, "WEBP", quality=quality or 82, method=6, alpha_quality=100)
    print(f"  -> {path.relative_to(PUBLIC.parent)}  {im.size[0]}x{im.size[1]}  {path.stat().st_size // 1024} KB")


# ------------------------------------------------------------------ holma

def guess_face(im: Image.Image) -> dict:
    """Heuristic: the red glass eye (#FF2E63) sits on the face; the face centre is the middle of
    the opaque run on the eye's row, nudged slightly down."""
    a = np.array(im.convert("RGBA")).astype(int)
    h, w = a.shape[:2]
    top = a[: int(h * 0.45)]
    r, g, b, al = top[..., 0], top[..., 1], top[..., 2], top[..., 3]
    red = (al > 200) & (r > 190) & (g < 110) & (b > 40) & (b < 160) & (r - g > 110)
    ys, xs = np.nonzero(red)
    if len(xs) < 5:
        return {"x": 0.5, "y": 0.2}
    ey, ex = int(np.median(ys)), int(np.median(xs))
    row = a[ey, :, 3] > 24
    x0 = ex
    while x0 > 0 and row[x0 - 1]:
        x0 -= 1
    x1 = ex
    while x1 < w - 1 and row[x1 + 1]:
        x1 += 1
    cx = (x0 + x1) / 2
    cy = ey + h * 0.02
    return {"x": round(cx / w, 3), "y": round(cy / h, 3)}


def export_holma(check_face: bool = False) -> None:
    print("holma")
    split = ART_SRC / "holma" / "split"
    out_dir = PUBLIC / "art" / "holma"
    face_file = ART_SRC / "holma" / "face.json"
    faces = json.loads(face_file.read_text(encoding="utf-8")) if face_file.exists() else {}
    meta: dict = {}
    checks = []
    for name in HOLMA_NAMES:
        src = split / f"{name}.png"
        if not src.exists():
            print(f"  missing {src}")
            continue
        im = Image.open(src).convert("RGBA")
        if im.height > HOLMA_MAX_H:
            im = im.resize((round(im.width * HOLMA_MAX_H / im.height), HOLMA_MAX_H), Image.LANCZOS)
        ext = im.getchannel("A").getextrema()
        if ext != (0, 255):
            raise SystemExit(f"{name}: alpha extrema {ext} != (0, 255)")
        face = faces.get(name) or guess_face(im)
        meta[name] = {"w": im.width, "h": im.height, "face": {"x": face["x"], "y": face["y"]}}
        # Lossy colour (q95) + lossless alpha: ~95 KB instead of ~260 KB lossless per mood, with no
        # visible change at display size (fur texture softens only under 6x zoom); every scene
        # with Holma loads all four moods, so this is ~0.65 MB off the first session.
        save_webp(im, out_dir / f"{name}.webp", quality=HOLMA_QUALITY)
        # re-open to prove the alpha survived the round trip bit-exact
        back = Image.open(out_dir / f"{name}.webp")
        assert back.mode == "RGBA" and back.getchannel("A").getextrema() == (0, 255), name
        assert back.getchannel("A").tobytes() == im.getchannel("A").tobytes(), f"{name}: alpha changed"
        if check_face:
            c = Image.new("RGBA", im.size, (40, 44, 56, 255))
            c.alpha_composite(im)
            d = ImageDraw.Draw(c)
            fx, fy = face["x"] * im.width, face["y"] * im.height
            d.ellipse((fx - 12, fy - 12, fx + 12, fy + 12), outline=(0, 255, 255, 255), width=4)
            d.line((fx - 30, fy, fx + 30, fy), fill=(0, 255, 255, 255), width=2)
            d.line((fx, fy - 30, fx, fy + 30), fill=(0, 255, 255, 255), width=2)
            checks.append(c)
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"  -> public/art/holma/meta.json {json.dumps(meta)}")
    if checks:
        H = max(c.height for c in checks)
        sheet = Image.new("RGBA", (sum(c.width for c in checks), H), (20, 22, 30, 255))
        x = 0
        for c in checks:
            sheet.paste(c, (x, 0))
            x += c.width
        sheet.save(split / "_face-check.png")
        print(f"  face check: {split / '_face-check.png'}")


# ------------------------------------------------------------------ others

def export_portraits() -> None:
    print("portraits")
    for cid in ("c01", "c02", "c03", "c04", "c05", "c06", "c07", "c08"):
        src = ART_SRC / "portraits" / f"{cid}-portrait.png"
        if not src.exists():
            print(f"  missing {src}")
            continue
        im = Image.open(src).convert("RGB")
        if im.size != (1024, 1536):
            im = cover_resize(im, 1024, 1536, (0.5, 0.4))
        save_webp(im, PUBLIC / "cases" / cid / "portrait.webp", quality=88)


def export_bgs() -> None:
    print("backgrounds")
    for name, dst in BG_MAP.items():
        src = ART_SRC / "bg" / f"{name}.png"
        if not src.exists():
            print(f"  missing {src}")
            continue
        im = Image.open(src).convert("RGB")
        save_webp(cover_resize(im, 1920, 1080), dst, quality=82)


def export_key() -> None:
    print("key art")
    src = ART_SRC / "key-art" / "key-art.png"
    if not src.exists():
        print(f"  missing {src}")
        return
    im = Image.open(src).convert("RGB")
    save_webp(cover_resize(im, 1920, 1080), PUBLIC / "art" / "key-art.webp", quality=85)
    og = cover_resize(im, 1200, 630, (0.5, 0.3))  # keep ear tips and the glass head; trim floor
    og.save(PUBLIC / "og.png", optimize=True)
    print(f"  -> og.png 1200x630  {(PUBLIC / 'og.png').stat().st_size // 1024} KB")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_face = "--check-face" in sys.argv
    groups = args or ["holma", "portraits", "bg", "key"]
    if "holma" in groups:
        export_holma(check_face)
    if "portraits" in groups:
        export_portraits()
    if "bg" in groups:
        export_bgs()
    if "key" in groups:
        export_key()


if __name__ == "__main__":
    main()
