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
            last = (relay.get("feed_last_frame_at") or {}).get("us")
            rows.append(_verdict("live_quotes", last, None, live_ok, delayed_ok or (us_state == "open" and not session["is_open"]), "EODHD US feed is open and ticking." if live_ok else ("US session is closed; the last tick stands as the closing print." if not session["is_open"] else f"US feed state is {us_state}; ticks are not arriving." )))
        vix_state = feeds.get("vix")
        rows.append(_verdict("vix_delayed", (relay.get("feed_last_frame_at") or {}).get("vix"), None, vix_state == "rest", vix_state in ("closed",), "VIX polls the delayed REST quote every 60 s (15–20 min delay by source)." if vix_state == "rest" else "VIX poll is not running."))

    # A stamp ahead of the clock is a fault (runner clock, parser), not freshness.
    horizon = now + timedelta(days=2)
    for r in rows:
        stamp = _parse_dt(r["latest"]) if r["latest"] else None
        if stamp is not None and stamp > horizon:
            r["verdict"] = "unavailable"
            r["reason"] = f"Future-dated stamp {r['latest']} (clock or parse fault); not trusted."

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
