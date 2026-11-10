"""scripts/check_13f_reference.py — check the SEC 13F step against the filings themselves (Desk P4, plan gate 3).

src/market_data/sec_13f.py reads the SEC's Form 13F data sets, a flattened copy
of the filings. This script compares, for a sample of the quarter's counted
filings, the long positions in shares the data set holds for each filing with
the information table the manager filed on EDGAR (the filing's own XML), CUSIP
by CUSIP, at a tolerance of zero shares; and it recomputes the holder counts
and the ten largest holders' shares of the named tickers by a second reading
of the data set, separate from the step's SQL, and compares them with what the
step stored.

The sample: the ten filings with the largest reported table value, ten
restatement or new-holdings amendments, and twenty other filings drawn with a
fixed seed. Requests go through the step's client (the declared contact from
SEC_USER_AGENT, spaced, never past a refusal); `--cache-dir` keeps them.

Run:  python scripts/check_13f_reference.py --db data/macro_radar.db --cache-dir DIR [--symbols NVDA,AVGO,…]
Exit 0 when every comparison matches, 1 otherwise. Prints no contact.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.market_data import sec_13f as s13  # noqa: E402

SEED = 20261110
DEFAULT_SYMBOLS = "NVDA,AVGO,AMD,TSM,MU,ANET,VRT,CEG,CRWV,NBIS,AAPL,MSFT,BRK.B,SPY"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def edgar_positions(client: s13.Client, cik: str, accession: str) -> dict[str, int]:
    """The filing's own information table: long positions in shares per CUSIP."""
    folder = f"/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}"
    index = json.loads(client.get(f"{folder}/index.json"))
    xmls = [i["name"] for i in index["directory"]["item"] if i["name"].lower().endswith(".xml") and i["name"].lower() != "primary_doc.xml"]
    out: Counter = Counter()
    found = False
    for name in xmls:
        root = ET.fromstring(client.get(f"{folder}/{name}"))
        if _local(root.tag) != "informationTable":
            continue
        found = True
        for row in root:
            if _local(row.tag) != "infoTable":
                continue
            f = {}
            for el in row.iter():
                f[_local(el.tag)] = (el.text or "").strip()
            if f.get("putCall") or f.get("sshPrnamtType", "").upper() != "SH":
                continue
            shares = s13._count(f.get("sshPrnamt", ""))
            cusip = f.get("cusip", "").upper()
            if shares and s13.CUSIP_RE.match(cusip):
                out[cusip] += shares
    if not found:
        raise RuntimeError(f"{accession}: no information table in the filing")
    return dict(out)


def data_set_positions(z: zipfile.ZipFile, accessions: set[str]) -> dict[str, dict[str, int]]:
    out: dict[str, Counter] = defaultdict(Counter)
    rows, ix = s13._tsv(z, "INFOTABLE.tsv", s13.INFO_COLUMNS)
    for r in rows:
        if len(r) <= max(ix.values()):
            continue
        acc = r[ix["ACCESSION_NUMBER"]].strip()
        if acc not in accessions or r[ix["PUTCALL"]].strip() or r[ix["SSHPRNAMTTYPE"]].strip().upper() != "SH":
            continue
        shares, cusip = s13._count(r[ix["SSHPRNAMT"]]), r[ix["CUSIP"]].strip().upper()
        if shares and s13.CUSIP_RE.match(cusip):
            out[acc][cusip] += shares
    return {a: dict(c) for a, c in out.items()}


def table_values(z: zipfile.ZipFile) -> dict[str, int]:
    rows, ix = s13._tsv(z, "SUMMARYPAGE.tsv", ("ACCESSION_NUMBER", "TABLEVALUETOTAL"))
    out = {}
    for r in rows:
        if len(r) > max(ix.values()):
            v = s13._count(r[ix["TABLEVALUETOTAL"]])
            if v is not None:
                out[r[ix["ACCESSION_NUMBER"]].strip()] = v
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", required=True)
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--symbols", default=DEFAULT_SYMBOLS)
    a = ap.parse_args(argv)
    contact = os.environ.get(s13.CONTACT_ENV, "").strip()
    if "@" not in contact:
        print(f"{s13.CONTACT_ENV} is not set: the SEC asks for a declared contact")
        return 1
    cache = Path(a.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    client = s13.Client(contact, cache_dir=cache)
    sets = s13.data_sets(client.get(s13._path(s13.SETS_PAGE)).decode("utf-8", "replace"))
    period, prev, needed = s13.choose(sets)
    files = [(s.name, Path(client.get(s.path, cache / f"download-{s.name}"))) for s in needed]
    filings = []
    for name, path in files:
        with zipfile.ZipFile(path) as z:
            filings += s13.read_filings(z, {period, prev}, name)
    keep, _ = s13.effective(filings)
    q = {acc: f for acc, f in keep.items() if f["period"] == period}
    values: dict[str, int] = {}
    for _name, path in files:
        with zipfile.ZipFile(path) as z:
            values.update(table_values(z))
    largest = sorted((acc for acc in q if acc in values), key=lambda acc: (-values[acc], acc))[:10]
    rng = random.Random(SEED)
    amended = sorted(acc for acc, f in q.items() if f["amendment"] and acc not in largest)
    amended = rng.sample(amended, min(10, len(amended)))
    rest = sorted(acc for acc in q if acc not in largest and acc not in amended)
    sample = largest + amended + rng.sample(rest, min(20, len(rest)))
    print(f"period {period} (deadline {s13.deadline_of(period)}), data sets {', '.join(s.name for s in needed)}")
    print(f"sample: {len(sample)} filings ({len(largest)} largest by table value, {len(amended)} amendments, "
          f"{len(sample) - len(largest) - len(amended)} drawn with seed {SEED})")
    ds: dict[str, dict[str, int]] = {}
    for name, path in files:
        with zipfile.ZipFile(path) as z:
            for acc, pos in data_set_positions(z, set(sample)).items():
                ds[acc] = pos
    bad = 0
    for acc in sample:
        f = q[acc]
        try:
            filed = edgar_positions(client, f["cik"], acc)
        except Exception as exc:  # noqa: BLE001 — a filing that cannot be read is a difference, reported
            print(f"  {acc} {f['kind']} {f['amendment'] or '-':12} not compared: {type(exc).__name__}: {exc}")
            bad += 1
            continue
        mine = ds.get(acc, {})
        diff = {c for c in set(filed) | set(mine) if filed.get(c) != mine.get(c)}
        status = "match" if not diff else f"DIFFER in {len(diff)} CUSIP(s)"
        bad += bool(diff)
        print(f"  {acc} {f['kind']:9} {f['amendment'] or '-':12} {len(filed):5} positions, {sum(filed.values()):>16,} shares: {status}")
    # Second reading: holders and the ten largest holders' shares, per stored ticker, without the step's SQL.
    conn = sqlite3.connect(a.db)
    want = [s13.symbol_key(x) for x in a.symbols.split(",") if x.strip()]
    stored_ftd = conn.execute(f"SELECT ftd_files FROM {s13.PERIODS} WHERE period = ?", (period.isoformat(),)).fetchone()[0].split(",")
    page = s13.ftd_paths(client.get(s13._path(s13.FTD_PAGE)).decode("utf-8", "replace"), n=1000)
    pairs, _ = s13.read_ftd([(f.rsplit("/", 1)[-1], client.get(f)) for f in page if f.rsplit("/", 1)[-1] in stored_ftd])
    cusips = {pairs[k]["cusip"]: k for k in want if k in pairs}
    per: dict[tuple[str, str], Counter] = defaultdict(Counter)  # (key, period) → cik → shares
    for _name, path in files:
        with zipfile.ZipFile(path) as z:
            rows, ix = s13._tsv(z, "INFOTABLE.tsv", s13.INFO_COLUMNS)
            for r in rows:
                if len(r) <= max(ix.values()):
                    continue
                f = keep.get(r[ix["ACCESSION_NUMBER"]].strip())
                cusip = r[ix["CUSIP"]].strip().upper()
                if f is None or cusip not in cusips or r[ix["PUTCALL"]].strip() or r[ix["SSHPRNAMTTYPE"]].strip().upper() != "SH":
                    continue
                shares = s13._count(r[ix["SSHPRNAMT"]])
                if shares:
                    per[(cusips[cusip], f["period"].isoformat())][f["cik"]] += shares
    for key in want:
        for p in (prev, period):
            row = conn.execute(f"SELECT holders, shares, top10_shares FROM {s13.TABLE} WHERE symbol_key = ? AND period = ?",
                               (key, p.isoformat())).fetchone()
            c = per.get((key, p.isoformat()))
            mine = (len(c), sum(c.values()), sum(sorted(c.values(), reverse=True)[:s13.TOP_HOLDERS])) if c else None
            ok = row is not None and mine is not None and tuple(row) == mine
            bad += not ok
            print(f"  {key:6} {p}: stored {row}, second reading {mine}: {'match' if ok else 'DIFFER'}")
    print("all match" if not bad else f"{bad} difference(s)")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
