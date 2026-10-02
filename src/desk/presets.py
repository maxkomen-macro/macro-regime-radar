"""src/desk/presets.py — the preset baskets Basket & Hedge offers (desk/cap-weight).

The page writes these baskets into a browser that has none
(web/src/screens/desk/basket/weights.ts `PRESET`); the full refresh stores a
share count for every constituent (src/market_data/share_counts.py), so a
preset can be weighted by market cap. tests/test_share_counts.py holds this
list equal to the page's, name for name and in order.

Stdlib only: the refresh step and the API both import it.
"""

from __future__ import annotations

# Preset name → its constituents, in the page's order.
PRESET_BASKETS: dict[str, tuple[str, ...]] = {
    "AI Infrastructure 10": ("NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG", "CRWV", "NBIS"),
}


def constituents() -> list[str]:
    """Every preset basket's names, each once, in the presets' order."""
    out: list[str] = []
    for names in PRESET_BASKETS.values():
        out.extend(s for s in names if s not in out)
    return out
