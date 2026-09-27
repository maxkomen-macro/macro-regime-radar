"""tests/test_desk_etf.py — the Desk's ETFs (desk/fill-etf).

Item 1: the 24 ETFs are registered in the Desk registry, stored in
asset_prices by the allocation refresh (src/market_data/asset_history.py; its
own tests cover the fetch, the volume and the short-history check), and
listed in the Data Pipeline inventory.
"""

from __future__ import annotations

from api import desk_pipeline as pipe
from src.desk import series as registry

SECTORS = ("XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY")
OTHERS = ("SPY", "RSP", "IWM", "QQQ", "SMH", "SOXX", "IGV", "TLT", "IEF", "HYG", "LQD", "GLD", "UUP")
ETFS = SECTORS + OTHERS


def test_the_24_etfs_are_registered_in_asset_prices_at_tier_2():
    specs = {s.series_id: s for s in registry.SERIES}
    for sym in ETFS:
        s = specs[sym]
        assert (s.source, s.table, s.tier, s.unit, s.available) == ("asset_prices", "asset_prices", 2, "log_return", True), sym
        assert s.key == sym.lower() and registry.stored_by_refresh(s), sym
    assert [t for t, *_ in registry.SECTOR_ETFS] == list(SECTORS)


def test_the_short_histories_are_declared_with_their_listing_dates():
    """XLC listed in June 2018 and XLRE in October 2015: the registry declares
    the provider's first close and says what that means for a statistic."""
    assert registry.get("xlc").history_from == "2018-06-19"
    assert registry.get("xlre").history_from == "2015-10-08"
    for key in ("xlc", "xlre"):
        assert "not available" in registry.get(key).note
    assert {registry.get(t.lower()).history_from for t in SECTORS if t not in ("XLC", "XLRE")} == {"1998-12-22"}


def test_only_the_nine_older_sector_etfs_keep_their_event_study_roles():
    """The nine that list from 1998-12-22 keep the roles the event study
    declared (the frozen entries of tests/fixtures/desk_entries_cc721f0.json
    name them); the other fifteen are read by the Sectors, Technicals and Macro
    tabs only, so no study can select them."""
    for sym in ETFS:
        want = ("shock", "condition") if sym in registry.SECTOR_NAMES else ()
        assert registry.get(sym.lower()).roles == want, sym


def test_every_etf_is_a_row_of_the_data_pipeline_inventory():
    groups = dict(pipe.PIPELINE_GROUPS)
    assert groups["Sector ETFs"] == SECTORS
    assert set(groups["Equity ETFs"]) | set(groups["Bond, gold & dollar ETFs"]) == set(OTHERS)
    assert set(ETFS) <= set(pipe.row_ids())
