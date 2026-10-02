"""The full refresh's share counts (src/market_data/share_counts.py, desk/cap-weight).

Yahoo is never called: each test hands the step a fake `fetch` built from
Yahoo's own quote summaries for these names, as yfinance returned them on
2026-10-01 (sharesOutstanding, impliedSharesOutstanding, marketCap,
regularMarketPrice, currency)."""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.desk import presets
from src.market_data import share_counts as sc

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 10, 1, 21, 0, tzinfo=timezone.utc)  # 17:00 in New York


@pytest.fixture(autouse=True)
def no_yahoo(monkeypatch):
    """No test reaches Yahoo: the step's default fetch fails the test if it is ever called."""
    def called(sym):
        raise AssertionError(f"a test asked Yahoo for {sym}")

    monkeypatch.setattr(sc, "yahoo_info", called)


def info(shares, mcap, price, implied=None, currency="USD"):
    return {"sharesOutstanding": shares, "impliedSharesOutstanding": implied if implied is not None else shares,
            "marketCap": mcap, "regularMarketPrice": price, "currentPrice": price, "currency": currency, "quoteType": "EQUITY"}


# Yahoo on 2026-10-01.
NVDA = info(24_147_000_000, 5_574_576_046_080, 230.86)
TSM = info(5_186_474_013, 2_381_628_833_792, 459.20)  # the ADR: one ADR is five ordinary shares; Yahoo counts ADRs
CRWV = info(458_871_690, 48_849_596_416, 88.57, implied=551_536_602)  # Class A listed; Class B not
NBIS = info(238_400_165, 63_146_532_864, 232.28, implied=271_855_218)
SAMPLE = {"NVDA": NVDA, "AVGO": info(4_773_629_865, 1_640_410_251_264, 343.64), "AMD": info(1_632_475_042, 1_005_163_773_952, 615.73),
          "TSM": TSM, "MU": info(1_129_393_151, 1_239_384_719_360, 1097.39), "ANET": info(1_261_224_648, 257_907_851_264, 204.49),
          "VRT": info(384_988_173, 94_753_284_096, 246.12), "CEG": info(354_307_379, 91_737_276_416, 258.92), "CRWV": CRWV, "NBIS": NBIS}


# ── The check against Yahoo's market cap ─────────────────────────────────────

def test_one_share_class_passes_as_given():
    assert sc.checked_count("NVDA", NVDA) == (24_147_000_000, None)


def test_an_adr_counted_in_adr_units_passes_as_given():
    """TSM: 5,186,474,013 ADRs × $459.20 is Yahoo's $2.38T market cap; the count is in the price's unit."""
    shares, note = sc.checked_count("TSM", TSM)
    assert shares == 5_186_474_013 and note is None
    assert shares * 459.20 == pytest.approx(2_381_628_833_792, rel=1e-6)


def test_an_adr_counted_in_ordinary_shares_is_stored_in_adr_units():
    """The same ADR as a provider might give it: 25.93B ordinary shares, five per ADR, so the count times the
    ADR's price is five times the market cap. Stored ÷ 5, in ADR units, and the note says so."""
    ordinary = info(25_932_370_065, 2_381_628_833_792, 459.20)
    shares, note = sc.checked_count("TSM", ordinary)
    assert shares == pytest.approx(5_186_474_013) and shares * 459.20 == pytest.approx(2_381_628_833_792, rel=1e-6)
    assert note == "TSM: Yahoo counts 25,932.4M ordinary shares, 5 per ADR; 5,186.5M ADRs stored"


def test_a_multi_class_company_keeps_its_listed_class():
    """CRWV: Yahoo's market cap is every class at the Class A price (551.5M shares); the listed Class A has 458.9M,
    which is what the S&P and the Nasdaq count. Stored, with the difference named."""
    shares, note = sc.checked_count("CRWV", CRWV)
    assert shares == 458_871_690
    assert note == "CRWV: listed class 458.9M shares stored; Yahoo's market cap counts every class, 551.5M"
    assert sc.checked_count("NBIS", NBIS)[0] == 238_400_165


@pytest.mark.parametrize("bad, words", [
    (info(24_147_000_000, 5_574_576_046_080, 230.86, currency="EUR"), "quoted in EUR, not USD"),
    ({**NVDA, "currency": None}, "quoted in an unstated currency"),
    ({**NVDA, "sharesOutstanding": None}, "gives no share count"),
    ({**NVDA, "sharesOutstanding": 0}, "gives no share count"),
    ({**NVDA, "sharesOutstanding": float("nan")}, "gives no share count"),
    ({**NVDA, "marketCap": None}, "no market cap and price"),
    ({**NVDA, "regularMarketPrice": None, "currentPrice": None, "previousClose": None}, "no market cap and price"),
    # 37% of the market cap: neither an ADR ratio nor another class
    (info(24_147_000_000, 5_574_576_046_080 / 0.37, 230.86), "not Yahoo's market cap"),
    # ordinary shares at 150 per ADR: outside the ratios taken
    (info(150 * 1_000_000, 1_000_000 * 10.0, 10.0), "not Yahoo's market cap"),
    # more shares counted than the market cap holds, and no implied count to explain it as another class
    (info(458_871_690, 48_849_596_416, 88.57, implied=458_871_690), "not Yahoo's market cap"),
])
def test_a_count_that_fails_the_check_is_refused(bad, words):
    with pytest.raises(sc.CountRefused) as ei:
        sc.checked_count("NVDA", bad)
    assert words in str(ei.value)


def test_a_boolean_is_not_a_number():
    with pytest.raises(sc.CountRefused):
        sc.checked_count("NVDA", {**NVDA, "sharesOutstanding": True})


# ── Fetching ─────────────────────────────────────────────────────────────────

def test_a_failed_fetch_is_retried_once_and_a_refusal_is_not():
    calls: list[str] = []

    def fetch(sym):
        calls.append(sym)
        if sym == "FLAKY" and calls.count(sym) == 1:
            raise TimeoutError("yahoo")
        if sym == "DOWN":
            raise ConnectionError("yahoo")
        if sym == "NONE":
            raise sc.CountRefused("NONE: Yahoo returned no quote summary")
        return NVDA

    counts, failed, notes = sc.fetch_counts(["FLAKY", "DOWN", "NONE", "OK"], fetch, pause=0, retry_wait=0)
    assert counts == {"FLAKY": 24_147_000_000, "OK": 24_147_000_000}
    assert failed == {"DOWN": "DOWN: not fetched (ConnectionError)", "NONE": "NONE: Yahoo returned no quote summary"}
    assert calls == ["FLAKY", "FLAKY", "DOWN", "DOWN", "NONE", "OK"] and notes == []


# ── The step ─────────────────────────────────────────────────────────────────

def _rows(db: Path) -> dict:
    with sqlite3.connect(db) as c:
        return {r[0]: r[1:] for r in c.execute("SELECT symbol, shares_outstanding, as_of, source FROM share_counts")}


def _mark(db: Path) -> tuple:
    with sqlite3.connect(db) as c:
        return c.execute("SELECT last_obs, status, detail FROM source_watermarks WHERE source = 'share_counts'").fetchone()


def test_every_preset_name_is_stored_with_its_date_and_source(tmp_path):
    db = tmp_path / "m.db"
    s = sc.refresh(db, now=NOW, fetch=SAMPLE.__getitem__, pause=0, retry_wait=0)
    rows = _rows(db)
    assert sorted(rows) == sorted(presets.constituents()) and s["status"] == "ok"
    assert rows["TSM"] == (5_186_474_013, "2026-10-01", "yfinance") and rows["CRWV"][0] == 458_871_690
    last_obs, status, detail = _mark(db)
    assert (last_obs, status) == ("2026-10-01", "ok")
    assert detail.startswith("Yahoo 10 of 10 · CRWV: listed class 458.9M shares stored")


def test_a_partial_fetch_keeps_the_stored_row_and_names_what_failed(tmp_path):
    """A name Yahoo does not answer, or whose count fails the check, keeps yesterday's row with yesterday's date;
    the watermark is `partial`, dated by the oldest stored name, and names both."""
    db = tmp_path / "m.db"
    sc.refresh(db, now=datetime(2026, 9, 30, 21, 0, tzinfo=timezone.utc), fetch=SAMPLE.__getitem__, pause=0, retry_wait=0)

    def fetch(sym):
        if sym == "MU":
            raise ConnectionError("yahoo")
        if sym == "VRT":
            return {**SAMPLE["VRT"], "marketCap": SAMPLE["VRT"]["marketCap"] * 3}
        return SAMPLE[sym]

    s = sc.refresh(db, now=NOW, fetch=fetch, pause=0, retry_wait=0)
    rows = _rows(db)
    assert s["status"] == "partial" and sorted(s["failed"]) == ["MU", "VRT"]
    assert rows["MU"][1] == rows["VRT"][1] == "2026-09-30" and rows["NVDA"][1] == "2026-10-01"
    last_obs, status, detail = _mark(db)
    assert (last_obs, status) == ("2026-09-30", "partial")
    assert "not stored: MU: not fetched (ConnectionError); VRT: " in detail and "not Yahoo's market cap" in detail


def test_a_failed_fetch_writes_nothing_and_says_so(tmp_path):
    db = tmp_path / "m.db"

    def down(sym):
        raise ConnectionError("yahoo")

    s = sc.refresh(db, now=NOW, fetch=down, pause=0, retry_wait=0)
    assert s["status"] == "error" and _rows(db) == {}
    last_obs, status, detail = _mark(db)
    assert last_obs is None and status == "error" and detail.startswith("Yahoo 0 of 10 · not stored: NVDA: not fetched")


def test_the_command_never_fails_the_refresh(tmp_path, capsys, monkeypatch):
    """Even when the step itself cannot run (here: the database path is a directory), it exits 0 and says why."""
    monkeypatch.setattr(sc, "yahoo_info", SAMPLE.__getitem__)
    assert sc.main(["--db", str(tmp_path)]) == 0
    assert "share_counts: not refreshed" in capsys.readouterr().out


def test_the_table_refuses_a_count_that_is_not_positive(tmp_path):
    db = tmp_path / "m.db"
    with sqlite3.connect(db) as c:
        sc.ensure_table(c)
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("INSERT INTO share_counts VALUES ('X', 0, '2026-10-01', 'yfinance')")


# ── The presets and the workflow ─────────────────────────────────────────────

def test_the_presets_are_the_pages():
    """src/desk/presets.py is the page's PRESET (web/src/screens/desk/basket/weights.ts), name for name, in order."""
    src = (ROOT / "web/src/screens/desk/basket/weights.ts").read_text()
    block = re.search(r"export const PRESET: SavedBasket = \{(.*?)\n\};", src, re.S).group(1)
    name = re.search(r'name: "([^"]+)"', block).group(1)
    assert presets.PRESET_BASKETS == {name: tuple(re.findall(r'\["([A-Z.]+)", "[^"]*"\]', block))}
    assert presets.constituents() == ["NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG", "CRWV", "NBIS"]


def test_the_full_refresh_stores_them_in_a_step_that_never_blocks():
    import yaml

    steps = yaml.safe_load((ROOT / ".github/workflows/refresh-data.yml").read_text())["jobs"]["refresh"]["steps"]
    names = [s["name"] for s in steps]
    step = steps[names.index("Store share counts")]
    assert step["if"] == "steps.mode.outputs.mode == 'full'" and step["run"].strip() == "python -m src.market_data.share_counts"
    assert step["continue-on-error"] is True and int(step["timeout-minutes"]) <= 5
    assert names.index("Store allocation price histories") < names.index("Store share counts") < names.index("Validate the refreshed database")
    # The full mode's install carries yfinance; the API's never does.
    assert re.search(r"^yfinance", (ROOT / "requirements.txt").read_text(), re.M)
    assert not re.search(r"^yfinance", (ROOT / "requirements-api.txt").read_text(), re.M)
    assert "pip install -r requirements.txt -r requirements-snapshot.txt" in (ROOT / ".github/workflows/refresh-data.yml").read_text()


def test_the_step_imports_yahoo_only_when_it_fetches():
    """The module loads without yfinance (the API image has none): it is imported inside the fetch only."""
    import ast

    tree = ast.parse((ROOT / "src/market_data/share_counts.py").read_text())
    top = {a.name for n in tree.body if isinstance(n, ast.Import) for a in n.names}
    top |= {n.module for n in tree.body if isinstance(n, ast.ImportFrom) and n.module}
    inner = {a.name for f in tree.body if isinstance(f, ast.FunctionDef) and f.name == "yahoo_info"
             for n in ast.walk(f) if isinstance(n, ast.Import) for a in n.names}
    assert "yfinance" not in top and inner == {"yfinance"}


def test_a_name_that_leaves_every_preset_is_removed(tmp_path, monkeypatch):
    db = tmp_path / "m.db"
    sc.refresh(db, now=NOW, fetch=SAMPLE.__getitem__, pause=0, retry_wait=0)
    monkeypatch.setattr(presets, "PRESET_BASKETS", {"Two": ("NVDA", "TSM")})
    sc.refresh(db, now=NOW, fetch=SAMPLE.__getitem__, pause=0, retry_wait=0)
    assert sorted(_rows(db)) == ["NVDA", "TSM"]
