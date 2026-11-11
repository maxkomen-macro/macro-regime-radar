"""Write Basket & Hedge's synthetic price fixture (web/src/fixtures/desk/basket-price-synthetic.json).

    python scripts/desk_basket_synthetic_fixture.py

The page asks /basket/study only after /basket/price has answered for the same basket (the busy fix, option C), so
the one basket the fixtures carry a study for (SMH 40%, SOXX 30%, XLK 30%; basket-study.json) needs a price answer
too. Its closes are invented: a seeded random walk per symbol on the XNYS sessions through the fixture world's last
session (2026-09-23), with an invented volume, priced by the route's own function (api/desk_basket.price_answer).
No provider data is involved (the repository is public; .claude/rules/test-data.md), and each answer says
"Synthetic" in `provider` and "not market data" in `source`. A developer tool: it never runs in the API process, and
it writes only that one file.

The file is `{"note", "answers": {<request key>: <payload>}}`, keyed as basket-price.json is
(web/src/fixtures/desk/index.ts `basketKey`: `legs|method|notional`).
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FRED_API_KEY", "fixture")

OUT = ROOT / "web" / "src" / "fixtures" / "desk" / "basket-price-synthetic.json"
THROUGH = "2026-09-23"
FROM = "2024-09-03"
SEED = 20261111
PROVIDER = "Synthetic"
SOURCE = "Invented daily closes (seeded random walks), not market data (fixture; the API prices from EODHD)"
LEGS = (("SMH", "40"), ("SOXX", "30"), ("XLK", "30"))
# The requests the fixtures answer: the study fixture's basket, held and rebalanced monthly.
REQUESTS = [(LEGS, "hold", "1000000"), (LEGS, "monthly", "1000000")]
# Each symbol's invented start, daily drift and daily volatility (no relation to the ETF's own history).
WALKS = {"SMH": (100.0, 0.0006, 0.018), "SOXX": (80.0, 0.0005, 0.019), "XLK": (120.0, 0.0004, 0.012),
         "QQQ": (150.0, 0.0004, 0.011), "SPY": (200.0, 0.0003, 0.009)}


def sessions() -> list[str]:
    import exchange_calendars as xc

    cal = xc.get_calendar("XNYS", start=FROM, end=THROUGH)
    return [d.strftime("%Y-%m-%d") for d in cal.sessions_in_range(FROM, THROUGH)]


def histories() -> dict:
    from src.desk import basket as bk

    days = sessions()
    rng = random.Random(SEED)
    out = {}
    for sym, (start, drift, vol) in WALKS.items():
        px, close, dv = start, [], []
        for _ in days:
            px *= math.exp(rng.gauss(drift, vol))
            close.append(round(px, 4))
            dv.append(round(px * 2_000_000.0, 2))
        out[sym] = bk.History(tuple(days), tuple(close), tuple(dv), tuple(close))
    return out


def request_key(legs, method: str, notional: str) -> str:
    return ",".join(f"{s}:{w}" for s, w in legs) + f"|{method}|{notional}"


def main() -> None:
    from api import desk_basket as db

    assert all(sym in WALKS for sym, _ in db.BENCHMARKS.values()), "every benchmark needs an invented walk"
    hist = histories()
    answers = {}
    for legs, method, notional in REQUESTS:
        parsed = [(s, float(w)) for s, w in legs]
        answers[request_key(legs, method, notional)] = db.price_answer(hist, parsed, method, float(notional), provider=PROVIDER, source=SOURCE)
    note = (f"Synthetic: invented closes (seeded random walks, seed {SEED}) on the XNYS sessions {FROM} to {THROUGH}, "
            "priced by api/desk_basket.price_answer (scripts/desk_basket_synthetic_fixture.py). Not market data.")
    OUT.write_text(json.dumps({"note": note, "answers": answers}, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {', '.join(answers)}")


if __name__ == "__main__":
    main()
