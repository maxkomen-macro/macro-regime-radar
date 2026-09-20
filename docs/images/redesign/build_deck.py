"""Compose the redesign screenshots into a 16:9 PDF deck (for Canva import).

Run (dev only):  .venv/bin/python docs/images/redesign/build_deck.py
Output: docs/images/redesign/Macro-RR-UI-Redesign.pdf
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE   = Path(__file__).resolve().parent
ASSETS = HERE.parent.parent.parent / "dashboard" / "assets"
W, H   = 1920, 1080
NAVY   = (0, 11, 61)
GOLD   = (198, 152, 66)
WHITE  = (242, 244, 250)
MUTED  = (154, 165, 200)

PAGES = [
    ("01-overview",           "Overview",            "Read-through, recession strip and key indicators. Everything else is one click away."),
    ("02-overview-signals",   "Signals & risks",     "Regime probabilities, top risks, signal monitor, what's priced, surprises."),
    ("03-overview-charts",    "Charts",              "One series at a time, window and normalization behind Chart settings."),
    ("04-overview-why",       "Why this regime",     "Drivers panel and 12-month regime history."),
    ("05-overview-intel",     "Intelligence",        "Narrative card, playbook, analogues and scenarios."),
    ("07-markets-snapshot",   "Markets / Snapshot",  "Live prices, sector heat, volatility and rates."),
    ("09-markets-credit",     "Markets / Credit",    "BAML spreads, LBO cost, regime tables and transition matrices."),
    ("10-risk-recession",     "Risk / Recession",    "Logistic model gauge, yield curve monitor, sensitivity sliders."),
    ("12-risk-news",          "Risk / News & events", "Calendar plus scored headline feed with AI read-through."),
    ("13-models-lbo",         "Models / LBO",        "Deal parameters, returns, schedule and IRR sensitivity."),
    ("14-models-allocation",  "Models / Allocation", "Regime-conditional performance, optimization, risk analysis."),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    cands = ["Manrope-Bold.ttf", "Arial Bold.ttf", "Helvetica.ttc"] if bold else ["Manrope-Regular.ttf", "Arial.ttf", "Helvetica.ttc"]
    for name in cands:
        for base in (str(Path.home() / "Library/Fonts"), "/Library/Fonts",
                     "/System/Library/Fonts/Supplemental", "/System/Library/Fonts"):
            f = Path(base) / name
            if f.exists():
                try:
                    return ImageFont.truetype(str(f), size, index=1 if (bold and f.suffix == ".ttc") else 0)
                except Exception:
                    continue
    return ImageFont.load_default(size)


def cover() -> Image.Image:
    im = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(im)
    logo = Image.open(ASSETS / "logo_white.png").convert("RGBA")
    lw = 760
    logo = logo.resize((lw, int(logo.height * lw / logo.width)))
    im.paste(logo, ((W - lw) // 2, 330), logo)
    d.line([(560, 560), (1360, 560)], fill=GOLD, width=2)
    t = "UI redesign on the Macro RR brand kit"
    d.text(((W - d.textlength(t, font=font(40))) // 2, 600), t, fill=WHITE, font=font(40))
    t2 = "4 sections, every model one click deeper. All 11 original views kept."
    d.text(((W - d.textlength(t2, font=font(26))) // 2, 664), t2, fill=MUTED, font=font(26))
    return im


# Vertical crop start (px at 2x) so each page shows its panel, not the shared hero.
OFFSETS = {"01-overview": 0}
def _offset(stem: str) -> int:
    if stem in OFFSETS:
        return OFFSETS[stem]
    return 1960 if stem.startswith(("02", "03", "04", "05", "06")) else 330


def page(shot: Path, title: str, sub: str, stem: str = "") -> Image.Image:
    im = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(im)
    crown = Image.open(ASSETS / "crown.png").convert("RGBA")
    ch = 44
    crown = crown.resize((int(crown.width * ch / crown.height), ch))
    im.paste(crown, (80, 60), crown)
    d.text((80 + crown.width + 18, 56), title, fill=WHITE, font=font(38, bold=True))
    d.text((80, 118), sub, fill=MUTED, font=font(22))
    d.line([(80, 164), (W - 80, 164)], fill=GOLD, width=1)
    s = Image.open(shot).convert("RGB")
    off = min(_offset(stem), max(0, s.height - 1400))
    s = s.crop((0, off, s.width, s.height))
    box_w, box_h = W - 160, H - 220
    s.thumbnail((box_w, box_h * 4))          # keep width, allow tall pages
    s = s.crop((0, 0, s.width, min(s.height, box_h)))
    im.paste(s, (80, 190))
    return im


def main() -> None:
    pages = [cover()]
    for stem, title, sub in PAGES:
        shot = HERE / f"{stem}.jpg"
        if shot.exists():
            pages.append(page(shot, title, sub, stem))
        else:
            print("missing", shot.name)
    out = HERE / "Macro-RR-UI-Redesign.pdf"
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=96)
    print("wrote", out, len(pages), "pages")


if __name__ == "__main__":
    main()
