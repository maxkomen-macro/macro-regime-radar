"""Phase 4a post-fix dataset (unserved): the main run's records with each rerun request's records swapped in.

Every (index, configuration, limit) of a rerun request replaces the pre-fix record in place; every other record is
kept byte for byte. The pre-fix file is never modified, so pre-fix and post-fix results stay separate.
Usage: python -m scripts.options_bench.phase4a.combine_postfix <main.jsonl> <rerun.jsonl> <out.jsonl>
"""

import json
import sys


def main(main_path: str, rerun_path: str, out_path: str) -> int:
    rx = {}
    for line in open(rerun_path):
        r = json.loads(line)
        rx[(r["index"], r["config"], r["limit_name"])] = line
    idx = {k[0] for k in rx}
    n = 0
    with open(out_path, "w") as f:
        for line in open(main_path):
            r = json.loads(line)
            if r.get("index") in idx:
                f.write(rx.pop((r["index"], r["config"], r["limit_name"])))
                n += 1
            else:
                f.write(line)
    print("replaced", n, "left", len(rx))
    return 0 if not rx else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
