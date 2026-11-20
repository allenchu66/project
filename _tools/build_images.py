#!/usr/bin/env python3
"""Build the optimized images used by index.html.

Reads the original artwork in photos/ and writes resized / cropped WebP
files to img/. Re-run after replacing any source image:

    python3 _tools/build_images.py

Requires Pillow (pip install Pillow). The folder name starts with "_" so
GitHub Pages (Jekyll) does not publish this script.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "photos"
OUT = ROOT / "img"

# Album pages are 1170x828 (A4 landscape). Cover / back cover are cropped to
# the same aspect ratio so every page in the flipbook has identical size.
PAGE_W, PAGE_H = 1170, 828
PAGE_WIDTHS = (800, 1170)
ALBUM_PAGES = 118

# name -> (source file, crop box or None, output widths, quality)
ASSETS = {
    # Header banner (desktop) and a centred crop for phones.
    "banner": ("banner.jpg", None, (960, 1440, 1920), 82),
    "banner-m": ("banner.jpg", (540, 0, 1380, 204), (840,), 82),
    "logo": ("banner.jpg", (887, 33, 1033, 179), (146,), 88),
    # Section photos, cut out of the old all-in-one banner images so the
    # paragraphs can be real HTML text.
    "about": ("about_us.jpg", (0, 246, 1920, 694), (768, 1280, 1920), 88),
    "album-photo": ("album.jpg", (19, 17, 1168, 634), (640, 1149), 82),
    "story-photo": ("story.jpg", (746, 17, 1901, 632), (640, 1155), 82),
    "tips-photo": ("tips.jpg", (17, 17, 1168, 633), (640, 1151), 82),
    # Title badges (kept as images to preserve the original lettering).
    "badge-about": ("about_us.jpg", (129, 726, 314, 914), (185,), 90),
    "badge-album": ("album.jpg", (1192, 13, 1905, 199), (713,), 90),
    "badge-story": ("story.jpg", (15, 13, 726, 201), (711,), 90),
    "badge-tips": ("tips.jpg", (1193, 13, 1905, 199), (712,), 90),
    "badge-team": ("team.jpg", (112, 35, 292, 215), (180,), 90),
    # Team portraits (circles in the original team banner).
    **{
        f"team-{i}": ("team.jpg", (x, 40, x + 140, 180), (140,), 86)
        for i, x in enumerate((360, 617, 817, 1017, 1217))
    },
    # Back-to-top button.
    "gotop": ("回到上面.png", None, (160,), 88),
}
ASSETS.update({f"story{i}": (f"story{i}.jpg", None, (500,), 82) for i in range(7)})


def fit_page(im: Image.Image) -> Image.Image:
    """Centre-crop to the album page aspect ratio, then resize to PAGE_W."""
    target = PAGE_W / PAGE_H
    w, h = im.size
    if abs(w / h - target) > 0.001:
        if w / h > target:
            nw = round(h * target)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w / target)
            im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    if im.size != (PAGE_W, PAGE_H):
        im = im.resize((PAGE_W, PAGE_H), Image.LANCZOS)
    return im


def save_widths(im: Image.Image, stem: Path, widths, quality: int, suffix=True) -> int:
    total = 0
    for w in widths:
        out = im if w >= im.width else im.resize(
            (w, round(im.height * w / im.width)), Image.LANCZOS
        )
        path = stem.with_name(f"{stem.name}-{w}.webp" if suffix else f"{stem.name}.webp")
        out.save(path, "WEBP", quality=quality, method=6)
        total += path.stat().st_size
    return total


def main() -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "album").mkdir(exist_ok=True)
    total = 0

    for name, (src, box, widths, q) in ASSETS.items():
        im = Image.open(SRC / src)
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        if box:
            im = im.crop(box)
        total += save_widths(im, OUT / name, widths, q)

    # Favicon (PNG for the widest browser support).
    logo = Image.open(SRC / "banner.jpg").convert("RGB").crop(ASSETS["logo"][1])
    logo.resize((64, 64), Image.LANCZOS).save(OUT / "favicon.png", optimize=True)

    pages = ["封面"] + [f"背包日記{i}" for i in range(1, ALBUM_PAGES + 1)] + ["封底"]
    for idx, src in enumerate(pages):
        im = fit_page(Image.open(SRC / "album" / f"{src}.jpg").convert("RGB"))
        total += save_widths(im, OUT / "album" / f"p{idx:03d}", PAGE_WIDTHS, 80)

    print(f"wrote {total / 1024 / 1024:.1f} MB to {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
