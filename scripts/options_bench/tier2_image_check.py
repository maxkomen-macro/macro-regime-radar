"""scripts/options_bench/tier2_image_check.py — the Tier 2 accuracy check's flag-on path, run inside the built API image.

The image carries api/ and src/ only (no scripts/, no tests/), so this proves the frozen configuration the check
serves is the one in the image's own src/desk/options_check.py and equals the registered freeze, that the switch is
off by default and imports nothing, and that with it on a synthetic scan keeps every Tier 1 field. Run with the
network off, so no provider can be called:

    docker build -t mrr-api .
    docker run --rm --network none -v "$PWD:/repo:ro" --entrypoint python mrr-api /repo/scripts/options_bench/tier2_image_check.py

The repository mount supplies only this script, the synthetic chain builder (tests/options_synth.py) and the freeze
file to compare against; api and src are imported from the image (/app first on the path, checked below).
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import asdict
from datetime import date

APP, REPO = "/app", os.environ.get("REPO", "/repo")
sys.path.insert(0, APP)
sys.path.append(os.path.join(REPO, "tests"))


def main() -> int:
    print("python", sys.version.split()[0])
    print("image has scripts/:", os.path.isdir(f"{APP}/scripts"), "| tests/:", os.path.isdir(f"{APP}/tests"))
    from api import desk_options
    os.environ.pop(desk_options.CHECK_ENV, None)
    assert desk_options.engine_check() is None
    assert "src.desk.options_check" not in sys.modules and "src.desk.options_adaptive" not in sys.modules
    print("flag off: no check, no Tier 2 module imported")
    os.environ[desk_options.CHECK_ENV] = "1"
    chk = desk_options.engine_check()
    from src.desk import options_adaptive as oa
    from src.desk import options_check as ock
    from src.desk import options_finder as of
    assert ock.__file__.startswith(APP + "/") and of.__file__.startswith(APP + "/"), (ock.__file__, of.__file__)
    freeze = json.load(open(os.path.join(REPO, "scripts/options_bench/calibration/phase2-freeze-2.json")))
    assert asdict(ock.FROZEN) == freeze["config"] and ock.FROZEN != oa.Config()
    print("flag on: check from", ock.__file__, "| config == registered freeze-2:", asdict(ock.FROZEN))
    import options_synth as syn
    for view, target in (("up", 120.0), ("down", 85.0)):
        off = syn.scan(view, target, date(2026, 12, 18))
        calls = []

        def timed(picks):
            t0 = time.perf_counter()
            out = chk(picks)
            calls.append(time.perf_counter() - t0)
            return out

        on = syn.scan(view, target, date(2026, 12, 18), check=timed)
        blk = on.pop("engine_check")
        assert on == off, "a Tier 1 field changed"
        json.dumps(blk, allow_nan=False)
        assert blk["error"] is None and 1 <= len(blk["picks"]) <= 3
        print(f"{view}: every Tier 1 field identical; check {calls[0] * 1000:.0f} ms, {blk['work']['used']:,} units")
        for r in blk["picks"]:
            t2 = r["tier2"]
            assert r["status"] == "checked" and r["agree"] is True, r
            print(f"  {r['contract']} {r['lenses']}: Tier 1 {r['tier1']['value']:.6f}, Tier 2 {t2['value']:.6f} "
                  f"± {t2['estimate']:.6f} ({t2['price_status']}), agree {r['agree']}, delta agree {r['delta_agree']}")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
