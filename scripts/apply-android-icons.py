#!/usr/bin/env python3
"""
Applies the Qualiadept Stream Q-Play icon (public/icon-512.png) to:
1. Web favicons (public/favicon.ico, public/favicon-32x32.png) when --web is passed
2. Capacitor Android launcher icons (adaptive foreground/background, legacy, round)
   and dark Q-Play splash screens inside android/app/src/main/res/ when --android is passed.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC_ICON = ROOT / "public" / "icon-512.png"
BG_HEX = "#070812"
BG_RGBA = (7, 8, 18, 255)


def make_round_icon(img: Image.Image, size: int) -> Image.Image:
    resized = img.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(resized, (0, 0), mask)
    return out


def make_adaptive_foreground(img: Image.Image, size: int) -> Image.Image:
    """
    Android adaptive icon foregrounds are 108dp canvases with a 72dp (~66.7%) safe zone.
    We place the artwork at ~72% of canvas size centered on a matching dark fill so circular,
    squircle, and rounded-square launchers never clip the glowing Q-Play ring.
    """
    canvas = Image.new("RGBA", (size, size), BG_RGBA)
    inner = int(round(size * 0.72))
    art = img.resize((inner, inner), Image.Resampling.LANCZOS).convert("RGBA")
    offset = (size - inner) // 2
    canvas.paste(art, (offset, offset), art)
    return canvas


def make_splash(img: Image.Image, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), BG_RGBA)
    logo_size = max(96, int(round(min(width, height) * 0.34)))
    art = img.resize((logo_size, logo_size), Image.Resampling.LANCZOS).convert("RGBA")
    x = (width - logo_size) // 2
    y = (height - logo_size) // 2
    canvas.paste(art, (x, y), art)
    return canvas.convert("RGB")


def generate_web_favicons(src: Image.Image) -> None:
    pub = ROOT / "public"
    ico_path = pub / "favicon.ico"
    png32_path = pub / "favicon-32x32.png"

    src.resize((32, 32), Image.Resampling.LANCZOS).save(png32_path, format="PNG", optimize=True)
    src.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"Generated {ico_path.relative_to(ROOT)} and {png32_path.relative_to(ROOT)}")


def apply_android_icons(src: Image.Image, android_dir: Path) -> None:
    res_dir = android_dir / "app" / "src" / "main" / "res"
    if not res_dir.exists():
        raise FileNotFoundError(f"Android res directory not found: {res_dir}")

    # 1. Update adaptive icon background color to obsidian dark
    values_dir = res_dir / "values"
    values_dir.mkdir(parents=True, exist_ok=True)
    bg_xml = values_dir / "ic_launcher_background.xml"
    bg_xml.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">{BG_HEX}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )

    # 2. Replace all mipmap densities (legacy, round, adaptive foreground)
    densities = {
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }
    for density, (legacy_px, fg_px) in densities.items():
        d = res_dir / f"mipmap-{density}"
        d.mkdir(parents=True, exist_ok=True)
        src.resize((legacy_px, legacy_px), Image.Resampling.LANCZOS).save(
            d / "ic_launcher.png", format="PNG", optimize=True
        )
        make_round_icon(src, legacy_px).save(
            d / "ic_launcher_round.png", format="PNG", optimize=True
        )
        make_adaptive_foreground(src, fg_px).save(
            d / "ic_launcher_foreground.png", format="PNG", optimize=True
        )

    # 3. Replace default Capacitor splash screens with dark Q-Play splash
    splash_targets = {
        "drawable": (480, 320),
        "drawable-port-mdpi": (320, 480),
        "drawable-port-hdpi": (480, 800),
        "drawable-port-xhdpi": (720, 1280),
        "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xxxhdpi": (1280, 1920),
        "drawable-land-mdpi": (480, 320),
        "drawable-land-hdpi": (800, 480),
        "drawable-land-xhdpi": (1280, 720),
        "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xxxhdpi": (1920, 1280),
    }
    for folder, (w, h) in splash_targets.items():
        d = res_dir / folder
        if d.exists():
            make_splash(src, w, h).save(d / "splash.png", format="PNG", optimize=True)

    print(f"Applied Q-Play Android launcher icons & dark splash screens in {res_dir}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", action="store_true", help="Generate web favicons in public/")
    parser.add_argument("--android", action="store_true", help="Apply icons to Capacitor android/ project")
    parser.add_argument("--android-dir", type=Path, default=ROOT / "android")
    args = parser.parse_args()

    if not args.web and not args.android:
        args.web = True

    src = Image.open(SRC_ICON).convert("RGBA")
    if args.web:
        generate_web_favicons(src)
    if args.android:
        apply_android_icons(src, args.android_dir)


if __name__ == "__main__":
    main()
