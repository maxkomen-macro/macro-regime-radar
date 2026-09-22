"""tests/test_allocation_concat.py — the two DatetimeIndex concats in the
allocation module name their sort (launch-1, item 4).

pandas 3 deprecates sorting by default when every frame in an `axis=1` concat
carries a DatetimeIndex (`Pandas4Warning`, a DeprecationWarning, so
`-W error::FutureWarning` never sees it). The code has always relied on the
sorted alignment; saying so keeps the result the same under pandas 4. The
verifier of item 4 found no test reaching either call site.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
import pytest
from pandas.errors import Pandas4Warning

from src.analytics import allocation


@pytest.fixture()
def shuffled():
    """Monthly returns whose index is deliberately out of order, so the
    default-sort path would have to decide something."""
    idx = pd.DatetimeIndex(["2024-03-31", "2024-01-31", "2024-04-30", "2024-02-29", "2024-06-30", "2024-05-31"])
    rng = np.random.default_rng(7)
    port = pd.Series(rng.normal(0.01, 0.03, len(idx)), index=idx, name="port")
    facts = pd.DataFrame(rng.normal(0, 0.02, (len(idx), 3)), index=idx[::-1], columns=["Mkt-RF", "SMB", "HML"])
    return port, facts


def test_factor_exposures_concat_names_its_sort(shuffled):
    port, facts = shuffled
    with warnings.catch_warnings():
        warnings.simplefilter("error", Pandas4Warning)
        allocation.calculate_factor_exposures(port, facts)


def test_hedging_impact_concat_names_its_sort(shuffled):
    port, facts = shuffled
    hedge = pd.Series(np.random.default_rng(3).normal(0, 0.02, len(port)), index=port.index[::-1], name="hedge")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Pandas4Warning)
        allocation.calculate_hedging_impact(port, hedge)
