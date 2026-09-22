"""api/freshness.py — source-aware freshness verdicts (2026-09-06).

One place decides what "current" means per feed, because every feed has a
different clock: EODHD ticks are sub-minute during a session, FRED daily
series post next business day, monthly macro prints follow the BLS / Fed
release calendar, and the regime engine can only be as fresh as its slowest
complete input. Verdict vocabulary matches web/src/screens/shared/freshness.ts
(current / delayed / stale / unavailable / reference); the reason string is
what the shell prints, so it stays a plain sentence.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from api import calendar as cal

# Monthly regime inputs and their publication rule: (series, release-day-of-
# month after which last month's print is expected). UNRATE is the Employment
# Situation (first Friday); CPI ~10th–15th; INDPRO mid-month (G.17).
MONTHLY_INPUTS: dict[str, dict[str, Any]] = {
    "INDPRO": {"label": "Industrial production", "rule": "day", "day": 18},
    "CPIAUCSL": {"label": "CPI (all items)", "rule": "day", "day": 15},
    "UNRATE": {"label": "Unemployment rate", "rule": "first_friday"},
}
DAILY_INPUTS = ["DGS10", "DGS2", "VIXCLS"]
NEWS_SLA_MIN_WEEKDAY = 90
NEWS_SLA_MIN_OFFHOURS = 6 * 60

# ── Per-series state (B3, 2026-09-18) ──────────────────────────────────────
# One vocabulary for every number on screen, beside the four-word SLA verdict:
#   live      streaming during the session (delay_min 0)
#   delayed   a quote or bar N minutes old (delay_min = N)
#   close     the newest official close or print that is due (cycles_behind 0
#             for markets and monthly prints; FRED daily within 2 business days)
#   stale     behind the newest expected publication (cycles_behind says by how many)
#   fallback  a stated default, not data
#   unknown   the as-of cannot be established (no true observation date yet,
#             a feed still connecting, a seeded snapshot)
# Spec: docs/redesign-v2/FRESHNESS_CONTRACT.md. The registry mirrors the FRED
# series fetched by src/config.py (parity pinned by tests/test_freshness_state.py);
# api/ never imports src.config.
SERIES_REGISTRY: dict[str, dict[str, Any]] = {
    "DGS10": {"label": "10-year Treasury yield", "cadence": "daily", "calendar": "bond"},
    "DGS2": {"label": "2-year Treasury yield", "cadence": "daily", "calendar": "bond"},
    "VIXCLS": {"label": "VIX close (CBOE)", "cadence": "daily", "calendar": "nyse"},
    "BAMLH0A0HYM2": {"label": "High-yield OAS", "cadence": "daily", "calendar": "bond"},
    "BAMLC0A0CM": {"label": "Investment-grade OAS", "cadence": "daily", "calendar": "bond"},
    "BAMLH0A1HYBB": {"label": "BB OAS", "cadence": "daily", "calendar": "bond"},
    "BAMLH0A2HYB": {"label": "Single-B OAS", "cadence": "daily", "calendar": "bond"},
    "BAMLH0A3HYC": {"label": "CCC OAS", "cadence": "daily", "calendar": "bond"},
    "T10YIE": {"label": "10-year breakeven inflation", "cadence": "daily", "calendar": "bond"},
    "T5YIE": {"label": "5-year breakeven inflation", "cadence": "daily", "calendar": "bond"},
    "DFII10": {"label": "10-year TIPS yield", "cadence": "daily", "calendar": "bond"},
    "DFII5": {"label": "5-year TIPS yield", "cadence": "daily", "calendar": "bond"},
    "SOFR": {"label": "SOFR", "cadence": "daily", "calendar": "bond"},
    "INDPRO": {"label": "Industrial production", "cadence": "monthly", "rule": "day", "day": 18},
    "CPIAUCSL": {"label": "CPI (all items)", "cadence": "monthly", "rule": "day", "day": 15},
    "UNRATE": {"label": "Unemployment rate", "cadence": "monthly", "rule": "first_friday"},
    "FEDFUNDS": {"label": "Fed funds (effective, monthly)", "cadence": "monthly", "rule": "day", "day": 3},
    "USREC": {"label": "NBER recession indicator", "cadence": "monthly", "rule": "day", "day": 3},
    "USSLIND": {"label": "Leading index", "cadence": "monthly", "discontinued": True},
}
DAILY_TOLERANCE = 2  # FRED daily: current within 2 business days (FRED posts next day)


def _state(sid: str, label: str, kind: str, cadence: str, as_of: str | None, state: str, *, delay_min: int | None = None,
           cycles_behind: int | None = None, discontinued: bool = False, reason: str = "") -> dict:
    return {"id": sid, "label": label, "kind": kind, "cadence": cadence, "as_of": as_of, "state": state,
            "delay_min": delay_min, "cycles_behind": cycles_behind, "stale": state == "stale",
            "discontinued": discontinued, "reason": reason}


def _expected_month_for(meta: dict, today: date) -> date:
    if meta.get("rule") == "first_friday":
        released = today >= cal.first_friday(today.year, today.month)
    else:
        released = today.day >= int(meta.get("day", 15))
    return cal.month_add(date(today.year, today.month, 1), -1 if released else -2)


def _daily_expected_and_lag(d: date, today_ny: date, rates: bool) -> tuple[date, int]:
    is_td = cal.is_bond_trading_day if rates else cal.is_trading_day
    prev_td = cal.previous_bond_trading_day if rates else cal.previous_trading_day
    between = cal.bond_business_days_between if rates else cal.business_days_between
    exp = prev_td(today_ny + timedelta(days=1)) if not is_td(today_ny) else prev_td(today_ny)
    return exp, between(d, exp)


def fred_series_state(sid: str, *, today_ny: date, stored_date: str | None, watermark: dict | None) -> dict:
    """State of one FRED series. Daily series need a watermark (their stored
    rows are month-stamped); monthly prints are dated by month either way."""
    meta = SERIES_REGISTRY.get(sid) or {"label": sid, "cadence": "monthly", "rule": "day", "day": 15}
    label, cadence = meta["label"], meta["cadence"]
    obs = (watermark or {}).get("last_obs")
    if meta.get("discontinued"):
        as_of = obs or stored_date
        if not as_of:
            return _state(sid, label, "fred", cadence, None, "unknown", discontinued=True, reason=f"{label} has no stored observations.")
        return _state(sid, label, "fred", cadence, as_of[:10], "close", cycles_behind=0, discontinued=True,
                      reason=f"{label} is discontinued at the source; {as_of[:10]} is its final value, kept as historical data.")
    if cadence == "daily":
        d = _parse_date(obs)
        if d is None:
            return _state(sid, label, "fred", cadence, None, "unknown",
                          reason=f"{label}: the true observation date is not recorded yet (stored rows are month-stamped).")
        exp, lag = _daily_expected_and_lag(d, today_ny, meta.get("calendar") == "bond")
        state = "close" if lag <= DAILY_TOLERANCE else "stale"
        reason = (f"{label} observed {d.isoformat()}, the newest print due." if lag == 0
                  else f"{label} observed {d.isoformat()}; {lag} business day(s) behind the {exp.isoformat()} print.")
        return _state(sid, label, "fred", cadence, d.isoformat(), state, cycles_behind=lag, reason=reason)
    d = _parse_date(obs or stored_date)
    if d is None:
        return _state(sid, label, "fred", cadence, None, "unknown", reason=f"{label} has no stored observations.")
    month = date(d.year, d.month, 1)
    exp = _expected_month_for(meta, today_ny)
    cycles = max(0, (exp.year - month.year) * 12 + exp.month - month.month)
    reason = (f"{label} for {month.strftime('%b %Y')} is the newest print due." if cycles == 0
              else f"{label}: {cycles} release(s) behind; {exp.strftime('%b %Y')} is due.")
    return _state(sid, label, "fred", cadence, month.isoformat(), "close" if cycles == 0 else "stale", cycles_behind=cycles, reason=reason)


# The Desk's daily series the full refresh stores (src/desk/series.fetched at
# REFRESH_TIER), mirrored here because this module stays stdlib + api/
# (scripts/validate_db.py runs it on the lean installs; tests/test_workflows.py
# pins it). tests/test_desk_api.py pins the mirror to the registry. Rates and
# spreads follow the bond calendar, VIX the NYSE's (desk/integration).
DESK_REFRESH_SERIES: dict[str, dict[str, str]] = {
    "DGS10": {"label": "10Y Treasury", "kind": "fred", "calendar": "bond"},
    "DGS2": {"label": "2Y Treasury", "kind": "fred", "calendar": "bond"},
    "T10Y2Y": {"label": "2s10s curve", "kind": "fred", "calendar": "bond"},
    "VIXCLS": {"label": "VIX", "kind": "fred", "calendar": "nyse"},
    "BAMLH0A0HYM2": {"label": "US HY OAS", "kind": "fred", "calendar": "bond"},
}


def desk_refresh_specs() -> list[dict]:
    """The series the drawer's desk_series verdict judges, in registry order."""
    return [{"id": sid, **meta} for sid, meta in DESK_REFRESH_SERIES.items()]


def desk_series_states(*, stored: dict[str, str] | None, specs: list[dict], watermarks: dict | None,
                       now: datetime | None = None) -> list[dict]:
    """One state per series of the Desk's daily history, `desk_series`
    (desk/integration: the event-study report's §10 follow-up, a desk_series
    row in the Data Pipeline inventory). `specs` lists the series in order
    (id, label, kind, calendar), the ones the full refresh stores first;
    `stored` maps series_id to its newest stored date, None when the database
    has no desk_series table yet. The table stores true observation dates, so
    the newest stored date is the as-of, judged by the FRED daily rule above
    (current within DAILY_TOLERANCE business days of the newest print due, on
    the bond calendar for rates and spreads). The writer's per-series watermark
    (`desk:<id>`) adds what the last refresh saw: a failed fetch, or a source
    serving less history than the registry declares."""
    now = now or datetime.now(timezone.utc)
    today_ny = now.astimezone(cal.NY).date()
    out: list[dict] = []
    for spec in specs:
        sid, label, kind = spec["id"], spec["label"], spec["kind"]
        rid = f"desk:{sid}"
        wm = (watermarks or {}).get(rid) or {}
        d = _parse_date((stored or {}).get(sid))
        if stored is None:
            out.append(_state(rid, label, kind, "daily", None, "unknown",
                              reason=f"{label} is awaiting the first full refresh: this database has no desk_series table yet, and that refresh stores it."))
            continue
        if d is None:
            why = (f"The last full refresh could not fetch {label} ({wm.get('detail')}); nothing is stored yet."
                   if wm.get("status") == "error" else f"{label} is not stored yet; the next full refresh stores it.")
            out.append(_state(rid, label, kind, "daily", None, "unknown", reason=why))
            continue
        exp, lag = _daily_expected_and_lag(d, today_ny, spec.get("calendar") == "bond")
        state = "close" if lag <= DAILY_TOLERANCE else "stale"
        reason = (f"{label} observed {d.isoformat()}, the newest print due." if lag == 0
                  else f"{label} observed {d.isoformat()}; {lag} business day(s) behind the {exp.isoformat()} print.")
        if wm.get("status") == "short":
            reason += f" The source serves less history than the registry declares ({wm.get('detail')})."
        elif wm.get("status") == "error":
            reason += f" The last full refresh could not fetch it ({wm.get('detail')}); the stored rows stand."
        out.append(_state(rid, label, kind, "daily", d.isoformat(), state, cycles_behind=lag, reason=reason))
    return out


def _parse_dt(s: str | None, naive_tz=timezone.utc) -> datetime | None:
    """Parse a stored stamp. Stamps without an offset are taken as `naive_tz`
    — UTC by default; the intraday pipeline stamps Eastern wall time
    (`2026-09-04 15:55:00`), so its caller passes America/New_York."""
    if not s:
        return None
    txt = str(s).strip().replace("T", " ").replace("Z", "+00:00")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            d = datetime.strptime(txt, fmt)
            return d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=naive_tz).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _parse_date(s: str | None) -> date | None:
    d = _parse_dt(s)
    return d.date() if d else None


def expected_month(series: str, today: date) -> date:
    """First day of the latest month whose print should be public today."""
    rule = MONTHLY_INPUTS[series]
    if rule["rule"] == "first_friday":
        released = today >= cal.first_friday(today.year, today.month)
    else:
        released = today.day >= rule["day"]
    this_month = date(today.year, today.month, 1)
    return cal.month_add(this_month, -1 if released else -2)


def _verdict(kind: str, latest: str | None, expected: str | None, ok: bool, delayed_ok: bool, reason: str) -> dict:
    if latest is None:
        v = "unavailable"
    elif ok:
        v = "current"
    elif delayed_ok:
        v = "delayed"
    else:
        v = "stale"
    return {"feed": kind, "latest": latest, "expected": expected, "verdict": v, "reason": reason}


def assess(
    *,
    db_fresh: dict,
    series_latest: list[dict],
    relay: dict | None,
    bootstrap: dict | None,
    now: datetime | None = None,
    watermarks: dict | None = None,
) -> dict:
    """`watermarks` (B6, 2026-09-18) maps source → the source_watermarks row
    (true last observation, advanced_at, checked_at). raw_series stores daily
    FRED series month-stamped, so without watermarks the FRED daily verdicts
    measure lag from the 1st of the month (the legacy path, kept for older
    databases); with them, from the real observation date, and a series that
    is checked but stops advancing is reported stale with the reason."""
    now = now or datetime.now(timezone.utc)
    today_ny = now.astimezone(cal.NY).date()
    session = cal.session_state(now)
    last_session = date.fromisoformat(session["last_completed_session"])
    by_series = {str(r.get("series_id")): r for r in series_latest}
    rows: list[dict] = []

    # ── market_daily: last completed session by 06:00 UTC next day ─────────
    md = _parse_date(db_fresh.get("market_daily_date"))
    exp_md = last_session
    grace_until = datetime.combine(last_session + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=6)
    ok = md is not None and md >= exp_md
    within_grace = md is not None and md >= cal.previous_trading_day(exp_md) and now < grace_until
    lag = cal.business_days_between(md, exp_md) if md else None
    rows.append(_verdict("market_daily", db_fresh.get("market_daily_date"), exp_md.isoformat(), ok, within_grace, "Stored closes include the last completed session." if ok else (f"Last completed session {exp_md.isoformat()} not yet stored; the daily refresh has until 06:00 UTC." if within_grace else f"Stored closes end {md.isoformat() if md else 'never'}; {lag} session(s) behind {exp_md.isoformat()}." if md else "No stored closes.")))

    # ── asset_prices: allocation's stored price histories (fix/prelaunch-1) ──
    # Written by the full refresh, judged like market_daily against the last
    # completed session. Not a regime input, so never part of `overall`.
    # Present only when the caller reports the table's date (api/db.freshness,
    # validate_db); None there means the database predates the table.
    ap_known = "asset_prices_date" in db_fresh
    ap = _parse_date(db_fresh.get("asset_prices_date")) if ap_known else None
    ap_detail = ((watermarks or {}).get("asset_prices") or {}).get("detail")
    ap_src = f" Providers: {ap_detail}." if ap_detail else ""
    ap_missing = "Asset price histories are not stored in this database yet; the next full refresh stores them."
    if ap_known:
        ap_ok = ap is not None and ap >= exp_md
        ap_grace = ap is not None and ap >= cal.previous_trading_day(exp_md) and now < grace_until
        ap_lag = cal.business_days_between(ap, exp_md) if ap else None
        if ap is None:
            ap_reason = ap_missing
        elif ap_ok:
            ap_reason = f"Stored histories include the last completed session ({exp_md.isoformat()})." + ap_src
        elif ap_grace:
            ap_reason = f"Last completed session {exp_md.isoformat()} not yet stored; the full refresh has until 06:00 UTC." + ap_src
        else:
            ap_reason = f"Stored histories end {ap.isoformat()}; {ap_lag} session(s) behind {exp_md.isoformat()}." + ap_src
        rows.append(_verdict("asset_prices", db_fresh.get("asset_prices_date"), exp_md.isoformat(), ap_ok, ap_grace, ap_reason))

    # ── desk_series: the Desk's daily series (desk/event-study, 2026-09-21) ──
    # Not a regime input, never in `overall`. With the per-series maxima
    # (api/db.freshness and validate_db both report them since desk/integration,
    # verifier V-06) the verdict is the inventory's own per-series rule over the
    # series the full refresh stores: the bond calendar for rates and spreads,
    # so the day after a bond-market holiday is not "behind", and a tier-2
    # series fetched by hand never pins it. Without them, the table-wide rule:
    # the oldest newest observation at least the session before the last
    # completed one (FRED posts next day).
    ds_known = "desk_series_date" in db_fresh
    if ds_known and "desk_series_latest" in db_fresh:
        by_id = db_fresh.get("desk_series_latest")
        ds_detail = ((watermarks or {}).get("desk_series") or {}).get("detail")
        ds_src = f" Series: {ds_detail}." if ds_detail else ""
        if by_id is None:
            rows.append(_verdict("desk_series", None, None, False, False,
                                 "The Desk's daily series are not stored in this database yet; the next full refresh stores them."))
        else:
            states = desk_series_states(stored=by_id, specs=desk_refresh_specs(), watermarks=watermarks, now=now)
            behind = [s for s in states if s["state"] != "close"]
            dated = [s["as_of"] for s in states if s["as_of"]]
            reason = ("Every series the full refresh stores includes its newest print due (FRED posts next day)." + ds_src if not behind
                      else "Behind: " + " ".join(s["reason"] for s in behind))
            rows.append(_verdict("desk_series", min(dated) if dated else None, None, not behind, False, reason))
    elif ds_known:
        ds = _parse_date(db_fresh.get("desk_series_date"))
        ds_detail = ((watermarks or {}).get("desk_series") or {}).get("detail")
        ds_src = f" Series: {ds_detail}." if ds_detail else ""
        exp_ds = cal.previous_trading_day(exp_md)
        ds_ok = ds is not None and ds >= exp_ds
        ds_grace = ds is not None and ds >= cal.previous_trading_day(exp_ds) and now < grace_until
        ds_lag = cal.business_days_between(ds, exp_ds) if ds else None
        if ds is None:
            ds_reason = "The Desk's daily series are not stored in this database yet; the next full refresh stores them."
        elif ds_ok:
            ds_reason = f"Stored Desk series include {exp_ds.isoformat()} (FRED posts next day)." + ds_src
        elif ds_grace:
            ds_reason = f"Observation for {exp_ds.isoformat()} not yet stored; the full refresh has until 06:00 UTC." + ds_src
        else:
            ds_reason = f"Stored Desk series end {ds.isoformat()}; {ds_lag} session(s) behind {exp_ds.isoformat()}." + ds_src
        rows.append(_verdict("desk_series", db_fresh.get("desk_series_date"), exp_ds.isoformat(), ds_ok, ds_grace, ds_reason))

    # ── market_intraday: 20 min in session, else last session close ─────────
    mi = _parse_dt(db_fresh.get("market_intraday_ts"), naive_tz=cal.NY)  # pipeline stamps ET wall time
    if session["is_open"]:
        ok = mi is not None and now - mi <= timedelta(minutes=20)
        delayed_ok = mi is not None and now - mi <= timedelta(minutes=60)
        sb = cal.session_bounds(today_ny)
        if not ok and not delayed_ok and sb is not None and now < sb[0] + timedelta(minutes=30):
            # Opening grace: the first bars land a few minutes after 09:30;
            # yesterday's closing bar is "delayed", not "stale", until then.
            pb = cal.session_bounds(cal.previous_trading_day(today_ny))
            delayed_ok = mi is not None and pb is not None and mi >= pb[1] - timedelta(minutes=15)
        reason = "Intraday bars are within 20 minutes." if ok else ("Intraday bars are older than 20 minutes during the session." if delayed_ok else "Intraday bars have stopped arriving during the session.")
        exp = (now - timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        b = cal.session_bounds(last_session)
        close = b[1] if b else now
        ok = mi is not None and mi >= close - timedelta(minutes=15)
        delayed_ok = mi is not None and mi.date() >= cal.previous_trading_day(last_session)
        reason = "Intraday bars run to the last completed session's close." if ok else ("Intraday bars stop before the last completed session's close." if delayed_ok else "Intraday bars are more than one session behind.")
        exp = close.strftime("%Y-%m-%dT%H:%M:%SZ")
    rows.append(_verdict("market_intraday", db_fresh.get("market_intraday_ts"), exp, ok, delayed_ok, reason))

    # ── news: 90 min on weekdays in US hours, 6 h otherwise ─────────────────
    np_ = _parse_dt(db_fresh.get("news_published_at"))
    ny_now = now.astimezone(cal.NY)
    business_hours = ny_now.weekday() < 5 and 6 <= ny_now.hour < 22
    sla = NEWS_SLA_MIN_WEEKDAY if business_hours else NEWS_SLA_MIN_OFFHOURS
    ok = np_ is not None and now - np_ <= timedelta(minutes=sla)
    delayed_ok = np_ is not None and now - np_ <= timedelta(hours=24)
    rows.append(_verdict("news", db_fresh.get("news_published_at"), (now - timedelta(minutes=sla)).strftime("%Y-%m-%dT%H:%M:%SZ"), ok, delayed_ok, f"Newest stored headline is within the {sla}-minute window." if ok else (f"Newest stored headline is older than {sla} minutes ({'US business hours' if business_hours else 'off-hours window'})." if delayed_ok else "No headline stored in the last 24 hours; the news pipeline is not running.")))

    # ── FRED daily series: within 2 business days of the last business day ──
    # Treasury yields (DGS*) follow the bond-market calendar: no print exists
    # for Columbus Day or Veterans Day, so those days never count as missed.
    daily_rows = []
    for sid in DAILY_INPUTS:
        rates = sid.startswith("DGS")
        is_td = cal.is_bond_trading_day if rates else cal.is_trading_day
        prev_td = cal.previous_bond_trading_day if rates else cal.previous_trading_day
        between = cal.bond_business_days_between if rates else cal.business_days_between
        exp = prev_td(today_ny + timedelta(days=1)) if not is_td(today_ny) else prev_td(today_ny)
        if watermarks is None:
            r = by_series.get(sid)
            d = _parse_date(r.get("date")) if r else None
            lag = between(d, exp) if d else None
            ok = d is not None and lag is not None and lag <= 2
            delayed_ok = d is not None and lag is not None and lag <= 5
            daily_rows.append(_verdict(f"fred:{sid}", r.get("date") if r else None, exp.isoformat(), ok, delayed_ok, f"{sid} is {lag} business day(s) behind the last business day (FRED posts next day)." if d else f"{sid} has no stored observations."))
            continue
        wm = watermarks.get(f"fred:{sid}") or {}
        d = _parse_date(wm.get("last_obs"))
        if d is None:
            daily_rows.append(_verdict(f"fred:{sid}", None, exp.isoformat(), False, False, f"{sid}: observation date not recorded yet; the refresh that writes source watermarks has not run."))
            continue
        lag = between(d, exp)
        ok, delayed_ok = lag <= 2, lag <= 5
        checked = _parse_dt(wm.get("checked_at"))
        if ok:
            reason = f"{sid} observed {d.isoformat()}; {lag} business day(s) behind {exp.isoformat()} (FRED posts next day)."
        elif checked is not None and now - checked <= timedelta(hours=36):
            reason = f"{sid}: fetched {checked.strftime('%Y-%m-%d %H:%M')}Z, no new observation since {d.isoformat()} ({lag} business day(s) behind {exp.isoformat()})."
        else:
            seen = checked.strftime('%Y-%m-%d') if checked else "never"
            reason = f"{sid}: not checked since {seen}; the refresh has missed cycles (newest observation {d.isoformat()}, {lag} business day(s) behind)."
        daily_rows.append(_verdict(f"fred:{sid}", d.isoformat(), exp.isoformat(), ok, delayed_ok, reason))
    rows.extend(daily_rows)

    # ── monthly regime inputs: publication calendar ─────────────────────────
    inputs = []
    blockers = []
    for sid, meta in MONTHLY_INPUTS.items():
        r = by_series.get(sid)
        d = _parse_date(r.get("date")) if r else None
        exp = expected_month(sid, today_ny)
        latest_month = date(d.year, d.month, 1) if d else None
        ok = latest_month is not None and latest_month >= exp
        delayed_ok = latest_month is not None and latest_month >= cal.month_add(exp, -1)
        row = _verdict(f"fred:{sid}", r.get("date") if r else None, exp.isoformat(), ok, delayed_ok, f"{meta['label']} for {exp.strftime('%b %Y')} is the latest print due by today." if ok else (f"{meta['label']} print for {exp.strftime('%b %Y')} is published but not stored yet." if delayed_ok else f"{meta['label']} is more than one release behind."))
        rows.append(row)
        inputs.append({"series": sid, "label": meta["label"], "latest_month": latest_month.isoformat() if latest_month else None, "expected_month": exp.isoformat(), "verdict": row["verdict"]})

    # ── regime: latest complete common feature month ────────────────────────
    reg = _parse_date(db_fresh.get("regimes_date"))
    reg_month = date(reg.year, reg.month, 1) if reg else None
    available_months = [date.fromisoformat(i["latest_month"]) for i in inputs if i["latest_month"]]
    for sid in DAILY_INPUTS:
        r = by_series.get(sid)
        if watermarks is not None:
            d = _parse_date((watermarks.get(f"fred:{sid}") or {}).get("last_obs"))
        else:
            d = _parse_date(r.get("date")) if r else None
        if d:
            # A daily series counts for a month once its last trading day is in
            # (FRED daily series end on business days, not calendar days).
            last_td = cal.previous_trading_day(_month_end(d) + timedelta(days=1))
            complete = date(d.year, d.month, 1) if d >= last_td else cal.month_add(date(d.year, d.month, 1), -1)
            available_months.append(complete)
    common_month = min(available_months) if available_months else None
    expected_regime_month = min(expected_month(s, today_ny) for s in MONTHLY_INPUTS)
    # Blockers: every monthly input whose latest stored month is the common
    # (slowest) month explains why the regime cannot advance. The cause is
    # either the publication calendar (nothing newer exists yet) or a print
    # that is public but not stored (the refresh is behind).
    for i in inputs:
        lm = date.fromisoformat(i["latest_month"]) if i["latest_month"] else None
        exp_m = date.fromisoformat(i["expected_month"])
        if lm is None:
            blockers.append({**{k: i[k] for k in ("series", "label", "latest_month", "expected_month")}, "cause": "no observations stored"})
        elif common_month is not None and lm <= common_month:
            cause = "publication calendar" if lm >= exp_m else "print published but not stored — refresh needed"
            blockers.append({**{k: i[k] for k in ("series", "label", "latest_month", "expected_month")}, "cause": cause})
    reg_ok = reg_month is not None and reg_month >= expected_regime_month
    reg_delayed = reg_month is not None and reg_month >= cal.month_add(expected_regime_month, -1)
    reg_reason = (
        f"Regime month {reg_month.strftime('%b %Y')} is the latest complete common feature month." if reg_ok and reg_month
        else (f"Regime month {reg_month.strftime('%b %Y')}; {expected_regime_month.strftime('%b %Y')} is due — see blockers." if reg_month else "No regime rows.")
    )
    rows.append(_verdict("regime", db_fresh.get("regimes_date"), expected_regime_month.isoformat(), reg_ok, reg_delayed, reg_reason))
    sig = _parse_date(db_fresh.get("signals_date"))
    sig_month = date(sig.year, sig.month, 1) if sig else None
    sig_ok = sig_month is not None and sig_month >= expected_regime_month
    sig_delayed = sig_month is not None and sig_month >= cal.month_add(expected_regime_month, -1)
    rows.append(_verdict("signals", db_fresh.get("signals_date"), expected_regime_month.isoformat(), sig_ok, sig_delayed, "Signals follow the regime month." if sig_ok else (f"Signals month {sig_month.strftime('%b %Y')} is one cycle behind." if sig_delayed and sig_month else ("Signals are more than one cycle behind." if sig_month else "No signal rows."))))

    # ── live relay (EODHD) ──────────────────────────────────────────────────
    if relay:
        feeds = relay.get("feeds", {})
        stale = relay.get("feed_stale", {})
        us_state = feeds.get("us")
        if not relay.get("token_configured"):
            rows.append(_verdict("live_quotes", None, None, False, False, "EODHD_API_TOKEN is not configured on this server; quotes are stored closes only."))
        else:
            live_ok = us_state == "open" and not stale.get("us") and session["is_open"]
            delayed_ok = us_state in ("open", "connecting", "closed") and not session["is_open"]
            # BH2: the US feed dates itself from the last US quote, not from the
            # arrival of any frame on that socket (acks and heartbeats land at
            # the weekend too). Older payloads without tick stamps fall back.
            last = (relay.get("feed_last_tick_at") or {}).get("us") or (relay.get("feed_last_frame_at") or {}).get("us")
            rows.append(_verdict("live_quotes", last, None, live_ok, delayed_ok or (us_state == "open" and not session["is_open"]), "EODHD US feed is open and ticking." if live_ok else ("US session is closed; the last tick stands as the closing print." if not session["is_open"] else f"US feed state is {us_state}; ticks are not arriving." )))
        vix_state = feeds.get("vix")
        rows.append(_verdict("vix_delayed", (relay.get("feed_last_frame_at") or {}).get("vix"), None, vix_state == "rest", vix_state in ("closed",), "VIX polls the delayed REST quote every 60 s in the US session and every 30 minutes outside it (15–20 min delay by source)." if vix_state == "rest" else "VIX poll is not running."))

    # A stamp ahead of the clock is a fault (runner clock, parser), not freshness.
    horizon = now + timedelta(days=2)
    for r in rows:
        stamp = _parse_dt(r["latest"]) if r["latest"] else None
        if stamp is not None and stamp > horizon:
            r["verdict"] = "unavailable"
            r["reason"] = f"Future-dated stamp {r['latest']} (clock or parse fault); not trusted."

    # ── per-series states (B3) ──────────────────────────────────────────────
    series: list[dict] = []
    for sid in SERIES_REGISTRY:
        stored = by_series.get(sid)
        series.append(fred_series_state(sid, today_ny=today_ny, stored_date=stored.get("date") if stored else None,
                                        watermark=(watermarks or {}).get(f"fred:{sid}")))
    md_str = md.isoformat() if md else None
    md_cycles = cal.business_days_between(md, exp_md) if md else None
    series.append(_state("market_daily", "Daily closes (stored)", "market", "daily", md_str,
                         "unknown" if md is None else ("close" if md >= exp_md else "stale"), cycles_behind=md_cycles,
                         reason="No stored closes." if md is None else (f"Official close of {md_str}, the last completed session." if md >= exp_md
                                else f"Newest stored close {md_str} is {md_cycles} session(s) older than the last completed session ({exp_md.isoformat()}).")))
    if mi is None:
        series.append(_state("market_intraday", "Intraday bars (stored)", "market", "5min", None, "unknown", reason="No stored intraday bars."))
    else:
        mi_et = mi.astimezone(cal.NY).strftime("%Y-%m-%d %H:%M:%S")
        if session["is_open"]:
            age = max(0, int((now - mi).total_seconds() // 60))
            series.append(_state("market_intraday", "Intraday bars (stored)", "market", "5min", mi_et, "delayed" if age <= 60 else "stale",
                                 delay_min=age, cycles_behind=0 if age <= 60 else None,
                                 reason=f"Newest bar {mi_et} ET, {age} min old." if age <= 60 else f"Bars stopped arriving {age} min ago during the session."))
        else:
            b = cal.session_bounds(last_session)
            closed_ok = b is not None and mi >= b[1] - timedelta(minutes=15)
            series.append(_state("market_intraday", "Intraday bars (stored)", "market", "5min", mi_et, "close" if closed_ok else "stale",
                                 cycles_behind=0 if closed_ok else 1,
                                 reason="Bars run to the last completed session's close." if closed_ok else "Bars stop before the last completed session's close."))
    if ap_known:
        ap_str = ap.isoformat() if ap else None
        ap_cycles = cal.business_days_between(ap, exp_md) if ap else None
        if ap is None:
            series.append(_state("asset_prices", "Asset price histories (stored)", "market", "daily", None, "unknown", reason=ap_missing))
        elif ap >= exp_md:
            series.append(_state("asset_prices", "Asset price histories (stored)", "market", "daily", ap_str, "close", cycles_behind=0,
                                 reason=f"Allocation's price histories run to {ap_str}, the last completed session." + ap_src))
        else:
            series.append(_state("asset_prices", "Asset price histories (stored)", "market", "daily", ap_str, "stale", cycles_behind=ap_cycles,
                                 reason=f"Allocation's price histories end {ap_str}, {ap_cycles} session(s) older than the last completed session ({exp_md.isoformat()})." + ap_src))
    if relay:
        feeds = relay.get("feeds", {})
        us, vix = feeds.get("us"), feeds.get("vix")
        last_us = (relay.get("feed_last_tick_at") or {}).get("us") or (relay.get("feed_last_frame_at") or {}).get("us")
        if not relay.get("token_configured") or us is None:
            st, why = "unknown", "The live relay is not configured on this server; quotes are stored closes."
        elif us == "connecting":
            st, why = "unknown", "The live feed is still connecting; freshness is unknown until the first tick."
        elif not session["is_open"]:
            st, why = "close", "US session is closed; the last tick stands as the closing print."
        elif us == "open" and not (relay.get("feed_stale") or {}).get("us"):
            st, why = "live", "Streaming during the session."
        else:
            st, why = "stale", f"US feed state is {us}; ticks are not arriving."
        series.append(_state("live_quotes", "Live quotes (EODHD relay)", "live", "tick", last_us, st, delay_min=0 if st == "live" else None, reason=why))
        if vix == "rest":
            series.append(_state("vix_delayed", "VIX (delayed poll)", "live", "60s", (relay.get("feed_last_frame_at") or {}).get("vix"),
                                 "delayed", delay_min=15, reason="VIX polls the delayed REST quote every 60 s in the US session and every 30 minutes outside it (15-20 min delay by source)."))
        else:
            series.append(_state("vix_delayed", "VIX (delayed poll)", "live", "60s", None, "unknown",
                                 reason="The VIX poll is connecting." if vix == "connecting" else "The VIX poll is not running."))

    model_feeds = {"regime", "signals", "market_daily"} | {f"fred:{s}" for s in list(MONTHLY_INPUTS) + DAILY_INPUTS}
    order = {"current": 0, "delayed": 1, "stale": 2, "unavailable": 3}
    worst = max((order[r["verdict"]] for r in rows if r["feed"] in model_feeds), default=0)
    overall = ["current", "delayed", "stale", "unavailable"][worst]

    return {
        **{k: db_fresh.get(k) for k in ("regimes_date", "signals_date", "market_daily_date", "market_intraday_ts", "news_published_at", "raw_series_date")},
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "overall": overall,
        "session": session,
        "sla": rows,
        "series": series,
        "regime": {
            "latest_month": reg_month.isoformat() if reg_month else None,
            "expected_month": expected_regime_month.isoformat(),
            "common_feature_month": common_month.isoformat() if common_month else None,
            "inputs": inputs,
            "blockers": blockers,
        },
        "bootstrap": bootstrap or {},
        "relay": {k: relay.get(k) for k in ("feeds", "feed_stale", "degraded", "degraded_reasons", "token_configured") if relay and k in relay} if relay else None,
    }


def _month_end(d: date) -> date:
    return cal.month_add(date(d.year, d.month, 1), 1) - timedelta(days=1)
