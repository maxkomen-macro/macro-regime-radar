"""api/desk_catalog.py — the Desk's study catalog (desk/frame-3-api, B1).

DESK_FRAME3_SPEC §12.3: fifteen studies, each with one canonical label and
short reused by every tab, a Client-view title, the question its five slots
ask, and the engine query that answers it (`engine_kwargs`, plain
`src.desk.event_study.Query` keyword arguments). The two RSI rows ask the
S&P's RSI(14) crossing 70 or 30 (desk/fill-compute), scored like every row.

Also here: the Ledger's order and groups (§8, §12.5), the Technicals
allowlist (§12.7), the Data Pipeline's groups (§12.9), and `normalize`, the
one reading of a request's parameters into a catalog study and a horizon
(plan R11, S-20, S-31). A request must normalize to one catalog row; anything
else is 422 `unsupported`, naming what.

Stdlib only: api/security.py imports this module to route a lookup, and the
engine (pandas, numpy, exchange_calendars) is never imported here. The
engine's slugs for the thirteen queries are written out (ENGINE_SLUGS) and
pinned against `event_study.slug_for` by tests/test_desk_v2_study.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from api.desk_envelope import Unsupported  # 422 `unsupported`: the request does not normalize to a catalog study

REGIMES = ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
MOVES = ("up2s", "down2s", "cross_above", "cross_below", "rsi_above_70", "rsi_below_30")
# The moves that take no window: the two 50/200-day crosses and the two RSI crossings.
NO_WINDOW_MOVES = ("cross_above", "cross_below", "rsi_above_70", "rsi_below_30")
WINDOWS = (5, 20, 60)
HORIZONS = (5, 10, 20, 60)
WHILE = ("none", "spx_below_50", *(f"regime:{r}" for r in REGIMES))
Z = 2.0  # every shock study in the catalog (§12.3)


@dataclass(frozen=True)
class Question:
    shock: str
    window: int | None
    move: str
    while_: str
    target: str

    def as_dict(self) -> dict:
        return {"shock": self.shock, "window": self.window, "move": self.move, "while": self.while_,
                "target": self.target}


@dataclass(frozen=True)
class Study:
    slug: str
    label: str
    short: str
    client_label: str | None
    question: Question | None

    @property
    def engine_kwargs(self) -> dict | None:
        return None if self.question is None else engine_kwargs(self.question)

    @property
    def allowed_horizons(self) -> tuple[int, ...]:
        # §12.3 (S-16): every row with a question allows all four, available or not
        return HORIZONS if self.question is not None else ()


def engine_kwargs(q: Question) -> dict:
    """The engine query a question asks (§12.2's slots → `Query`)."""
    if q.move in ("cross_above", "cross_below"):
        return {"kind": "cross", "cross": "golden" if q.move == "cross_above" else "death", "target": q.target}
    if q.move in ("rsi_above_70", "rsi_below_30"):
        return {"kind": "rsi", "cross": "above" if q.move == "rsi_above_70" else "below", "target": q.target}
    kw: dict = {"shock": q.shock, "w": q.window, "z": Z, "sign": "+" if q.move == "up2s" else "-", "target": q.target}
    if q.while_ == "spx_below_50":
        kw["cond"] = "spx_below_50dma"
    elif q.while_.startswith("regime:"):
        kw.update(cond="regime", cond_value=q.while_.split(":", 1)[1])
    return kw


def _q(shock: str, window: int | None, move: str, while_: str, target: str) -> Question:
    return Question(shock, window, move, while_, target)


# DESK_FRAME3_SPEC §12.3, in its order.
CATALOG: tuple[Study, ...] = (
    Study("gold-2sigma-spx-weak", "Gold +2σ while S&P weak", "gold while S&P weak",
          "Gold jumps over a month while the S&P is weak", _q("gold", 20, "up2s", "spx_below_50", "spx")),
    Study("golden-cross", "S&P golden cross", "golden cross",
          "The S&P's 50-day average rises above its 200-day", _q("spx", None, "cross_above", "none", "spx")),
    Study("death-cross", "S&P death cross", "death cross",
          "The S&P's 50-day average falls below its 200-day", _q("spx", None, "cross_below", "none", "spx")),
    Study("vix-spike-2sigma-5d", "VIX spike +2σ, 5 days", "VIX spike",
          "Stock-market volatility jumps within a week", _q("vix", 5, "up2s", "none", "spx")),
    Study("hy-2sigma-20d", "HY spreads +2σ, 20 days", "HY spreads widening",
          "High-yield credit spreads widen sharply over a month", _q("hy_oas", 20, "up2s", "none", "spx")),
    Study("10y-2sigma-20d", "10y yield +2σ, 20 days", "10y yield up",
          "The 10-year Treasury yield jumps over a month", _q("us10y", 20, "up2s", "none", "spx")),
    Study("dollar-2sigma-20d", "Dollar −2σ, 20 days", "dollar weak",
          "The dollar falls sharply over a month", _q("dxy", 20, "down2s", "none", "spx")),
    Study("oil-2sigma-gold", "Oil +2σ → gold", "oil → gold",
          "Oil jumps over a month, and what gold does next", _q("wti", 20, "up2s", "none", "gold")),
    Study("spx-2sigma-10y", "S&P −2σ → 10y", "S&P drop → 10y",
          "The S&P falls sharply over a month, and what the 10-year yield does next", _q("spx", 20, "down2s", "none", "us10y")),
    Study("spx-20d-2sigma", "S&P 20-day move over 2σ", "S&P 20-day move",
          "The S&P rallies sharply over a month", _q("spx", 20, "up2s", "none", "spx")),
    Study("spx-5d-2sigma", "S&P 5-day move over 2σ", "S&P 5-day move",
          "The S&P rallies sharply within a week", _q("spx", 5, "up2s", "none", "spx")),
    Study("2s10s-2sigma-steepening", "2s10s +2σ steepening", "2s10s steepening",
          "The yield curve steepens sharply over a month", _q("curve_2s10s", 20, "up2s", "none", "spx")),
    Study("oil-2sigma-20d", "Oil +2σ, 20 days", "oil spike",
          "Oil jumps over a month", _q("wti", 20, "up2s", "none", "spx")),
    Study("rsi-above-70", "RSI above 70", "RSI > 70",
          "The S&P's 14-day momentum gauge (RSI) climbs above 70", _q("spx", None, "rsi_above_70", "none", "spx")),
    Study("rsi-below-30", "RSI below 30", "RSI < 30",
          "The S&P's 14-day momentum gauge (RSI) drops below 30", _q("spx", None, "rsi_below_30", "none", "spx")),
)
BY_SLUG: dict[str, Study] = {s.slug: s for s in CATALOG}
CATALOG_SLUGS: tuple[str, ...] = tuple(s.slug for s in CATALOG)
CATALOG_QUERY_SLUGS: tuple[str, ...] = tuple(s.slug for s in CATALOG if s.question is not None)

# §12.3's "engine query" column: the engine's own slug for each query (the presets by name);
# the aliases a `preset` parameter accepts besides the catalog slugs (v3 §2). `slug_for` is untouched.
ENGINE_SLUGS: dict[str, str] = {
    "gold-2sigma-spx-weak": "gold-2sigma-spx-weak",
    "golden-cross": "spx-golden-cross",
    "death-cross": "spx-death-cross",
    "vix-spike-2sigma-5d": "vix-w5-z2.0-up-none-spx",
    "hy-2sigma-20d": "hy_oas-w20-z2.0-up-none-spx",
    "10y-2sigma-20d": "us10y-w20-z2.0-up-none-spx",
    "dollar-2sigma-20d": "dxy-w20-z2.0-down-none-spx",
    "oil-2sigma-gold": "wti-w20-z2.0-up-none-gold",
    "spx-2sigma-10y": "spx-w20-z2.0-down-none-us10y",
    "spx-20d-2sigma": "spx-w20-z2.0-up-none-spx",
    "spx-5d-2sigma": "spx-w5-z2.0-up-none-spx",
    "2s10s-2sigma-steepening": "curve_2s10s-w20-z2.0-up-none-spx",
    "oil-2sigma-20d": "wti-w20-z2.0-up-none-spx",
    "rsi-above-70": "spx-rsi-above-70",
    "rsi-below-30": "spx-rsi-below-30",
}
BY_ENGINE_SLUG: dict[str, str] = {v: k for k, v in ENGINE_SLUGS.items()}

# §8: the Ledger's twelve rows, in exactly this order (v3 §2, v4 B-03).
LEDGER_ORDER: tuple[str, ...] = (
    "2s10s-2sigma-steepening", "dollar-2sigma-20d", "golden-cross", "rsi-below-30", "vix-spike-2sigma-5d",
    "gold-2sigma-spx-weak", "hy-2sigma-20d", "spx-20d-2sigma", "death-cross", "rsi-above-70", "oil-2sigma-20d",
    "spx-5d-2sigma",
)
_SPX_GROUP = {"golden-cross", "death-cross", "spx-20d-2sigma", "spx-5d-2sigma", "rsi-above-70", "rsi-below-30"}
# §12.5
LEDGER_GROUP: dict[str, str] = {s: ("spx" if s in _SPX_GROUP else "cross") for s in LEDGER_ORDER}
# §12.7 (v2 §13): the S&P rows, the two RSI rows among them (desk/fill-compute)
TECHNICALS_ALLOWLIST: tuple[str, ...] = ("golden-cross", "death-cross", "rsi-above-70", "rsi-below-30", "spx-20d-2sigma",
                                         "spx-5d-2sigma")
# §12.9 (plan §1.9: the names of A's fixture and audit §1)
PIPELINE_GROUPS: tuple[str, ...] = ("Rates", "Credit", "Equities & vol", "FX & commodities", "Macro (monthly)")

SLOTS = ("shock", "window", "move", "while", "target")
PARAMETERS = ("preset", "horizon", *SLOTS)


def study_for(question: Question) -> Study | None:
    """The catalog row that asks exactly this question, or None."""
    return next((s for s in CATALOG if s.question == question), None)


def _one(params: Iterable[tuple[str, str]], route: str) -> dict[str, str]:
    seen: dict[str, str] = {}
    for key, value in params:
        if key not in PARAMETERS:
            raise Unsupported(f"{key} is not a parameter of {route}.")
        if key in seen:
            raise Unsupported(f"{key} is given more than once.")
        seen[key] = value
    return seen


def _horizon(study: Study, raw: str | None) -> int | None:
    """§12.2: `horizon` selects the study's results, default 20; one outside
    the row's allowed horizons is refused. A row with none (S-31) takes no
    horizon at all, and the default is never applied to it (every catalog row
    has all four since desk/fill-compute gave the RSI rows their question)."""
    if not study.allowed_horizons:
        if raw is not None:
            raise Unsupported(f"horizon is not allowed for {study.slug}: the study has no horizons.")
        return None
    if raw is None:
        return 20
    try:
        h = int(raw)
    except ValueError:
        h = None
    if h is None or str(h) != raw.strip() or h not in study.allowed_horizons:
        raise Unsupported(f"horizon {raw} is not allowed for {study.slug} "
                          f"({', '.join(map(str, study.allowed_horizons))}).")
    return h


CROSS_RULE = ("A cross is the S&P 500's own 50- and 200-day averages crossing: the shock and the target are spx, "
              "with no condition.")
# desk/fill-compute's RSI moves, asked outside the catalog's two rows (desk/usability §14.3's rebase follow-through).
RSI_RULE = ("An RSI crossing is the S&P 500's own 14-day RSI crossing 70 or 30: the shock and the target are spx, "
            "with no condition.")


def ad_hoc(question: Question) -> Study:
    """A well-formed question outside the catalog (desk/usability §14.3): a
    study the router names and computes on request. Its slug, label, short
    and Client title are the router's (they need the registry's labels and
    the engine's slug); here they are empty."""
    return Study("", "", "", None, question)


def normalize(params: Iterable[tuple[str, str]], route: str = "/study",
              resolve_alias=None, *, allow_any: bool = False) -> tuple[Study, int | None]:
    """A request's parameters as (catalog study, selected horizon); the horizon
    is None for a row with no horizons. `preset` names a catalog slug, or an
    engine slug that parses to a catalog query (`resolve_alias`, which the
    router supplies from the engine; the written-out engine slugs resolve
    without it). Otherwise the six slots name the question.

    desk/usability §14.3: with `allow_any`, a well-formed six-slot question
    that is no catalog row is returned as an `ad_hoc` study at any of the four
    horizons (a cross is still only the S&P's own); the engine validates the
    series."""
    p = _one(params, route)
    if "preset" in p:
        extra = sorted(k for k in p if k in SLOTS)
        if extra:
            raise Unsupported(f"a preset is asked without slot parameters (given {', '.join(extra)}).")
        name = p["preset"]
        slug = name if name in BY_SLUG else BY_ENGINE_SLUG.get(name)
        if slug is None and resolve_alias is not None:
            slug = resolve_alias(name)
        if slug is None:
            raise Unsupported(f"No study in the catalog is preset {name}.")
        study = BY_SLUG[slug]
        return study, _horizon(study, p.get("horizon"))
    missing = [k for k in ("shock", "move", "target") if k not in p]
    if missing:
        raise Unsupported(f"{route} needs preset=<slug>, or the slots shock, window, move, while and target "
                          f"(missing {', '.join(missing)}).")
    move = p["move"]
    if move not in MOVES:
        raise Unsupported(f"move {move} is not one of {', '.join(MOVES)}.")
    cross = move in NO_WINDOW_MOVES
    if cross and "window" in p:
        raise Unsupported("A cross takes no window." if move.startswith("cross") else "An RSI crossing takes no window.")
    if not cross and "window" not in p:
        raise Unsupported(f"The move {move} needs a window (5, 20 or 60 sessions).")
    window = None
    if not cross:
        try:
            window = int(p["window"])
        except ValueError:
            window = None
        if window not in WINDOWS or str(window) != p["window"].strip():
            raise Unsupported(f"window {p['window']} is not one of 5, 20, 60.")
    while_ = p.get("while", "none")
    if while_ not in WHILE:
        raise Unsupported(f"while {while_} is not one of {', '.join(WHILE)}.")
    q = Question(p["shock"], window, move, while_, p["target"])
    study = study_for(q)
    if study is None and allow_any:
        if cross and (q.shock != "spx" or q.target != "spx" or while_ != "none"):
            raise Unsupported(CROSS_RULE if move.startswith("cross") else RSI_RULE)
        study = ad_hoc(q)
    if study is None:
        asked = ", ".join([f"shock {q.shock}", "no window" if window is None else f"window {window}",
                           f"move {move}", f"while {while_}", f"target {q.target}"])
        raise Unsupported(f"No study in the catalog asks {asked}.")
    return study, _horizon(study, p.get("horizon"))


def ops_by_shock() -> dict[str, list[str]]:
    """Plan R14: for each series, the moves the catalog allows with it as the shock, in MOVES order."""
    out: dict[str, list[str]] = {}
    for s in CATALOG:
        if s.question is not None:
            out.setdefault(s.question.shock, [])
            if s.question.move not in out[s.question.shock]:
                out[s.question.shock].append(s.question.move)
    return {k: sorted(v, key=MOVES.index) for k, v in out.items()}


def series_read() -> set[str]:
    """Codex R-03 (desk/fill-etf): the registry keys some catalog study reads,
    as its shock, its target, or the S&P its spx_below_50 condition reads."""
    out: set[str] = set()
    for s in CATALOG:
        if s.question is not None:
            out |= {s.question.shock, s.question.target}
            if s.question.while_ == "spx_below_50":
                out.add("spx")
    return out


def fixes_for(study: Study) -> list[str]:
    """Plan R15, as desk/usability §14.3 amends it (every well-formed question is
    answered on request now): `widen_window` when a larger window exists;
    `drop_condition` when the question has one."""
    q = study.question
    out: list[str] = []
    if q is None:
        return out
    if q.window is not None and q.window != WINDOWS[-1]:
        out.append("widen_window")
    if q.while_ != "none":
        out.append("drop_condition")
    return out
