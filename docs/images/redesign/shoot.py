"""Screenshot every section/panel of the redesigned dashboard with Playwright.

Run (dev only):  .venv/bin/python docs/images/redesign/shoot.py
Writes JPEGs next to this file. Needs the app on http://localhost:8511.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8511"

# (file, [buttons to click in order], settle seconds)
SHOTS = [
    ("01-overview",            [],                                       6),
    ("02-overview-signals",    ["Signals & risks"],                      8),
    ("03-overview-charts",     ["Charts"],                               8),
    ("04-overview-why",        ["Why this regime"],                      8),
    ("05-overview-intel",      ["Intelligence"],                         10),
    ("06-overview-data",       ["Data"],                                 6),
    ("07-markets-snapshot",    ["Markets"],                              12),
    ("08-markets-alerts",      ["Alerts & pricing"],                     8),
    ("09-markets-credit",      ["Credit"],                               10),
    ("10-risk-recession",      ["Risk"],                                 12),
    ("11-risk-backtests",      ["Backtests"],                            10),
    ("12-risk-news",           ["News & events"],                        10),
    ("13-models-lbo",          ["Models"],                               10),
    ("14-models-allocation",   ["Asset allocation"],                     20),
    ("15-models-methodology",  ["Methodology"],                          8),
]

FULLPAGE_CSS = (
    '[data-testid="stMain"],[data-testid="stAppViewContainer"],[data-testid="stApp"],html,body'
    "{overflow:visible!important;height:auto!important;max-height:none!important;position:static!important}"
)


def click(page, label: str) -> None:
    # Streamlit pills / segmented control render as role="radio" buttons; match by text.
    ok = page.evaluate(
        """(l) => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===l);
                    if(!b) return false; b.click(); return true; }""",
        label,
    )
    if not ok:
        raise RuntimeError(f"button not found: {label}")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
    page.goto(URL, wait_until="networkidle", timeout=120_000)
    page.wait_for_selector("text=OPEN A PANEL", timeout=120_000)
    page.add_style_tag(content=FULLPAGE_CSS)
    for name, clicks, settle in SHOTS:
        for c in clicks:
            click(page, c)
            time.sleep(1)
        time.sleep(settle)
        page.add_style_tag(content=FULLPAGE_CSS)
        alerts = [a.inner_text()[:120] for a in page.query_selector_all('[data-testid="stAlert"]')]
        page.screenshot(path=str(OUT / f"{name}.jpg"), full_page=True, type="jpeg", quality=82)
        print(f"{name}: ok  alerts={alerts}")
    browser.close()
