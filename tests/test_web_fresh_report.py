"""tests/test_web_fresh_report.py: the web's awaiting freshness label (desk/hardening, Codex R-31).

An endpoint outside the Desk serves `freshness: {status: "awaiting", reason}` when the
Desk store's schema check could not run (verifier V-53). The web's
`useFreshReport.ts` let a cached report's date label those new numbers. This runs
Codex's repro with node: TypeScript's own transpiler over
web/src/screens/shared/fresh-state.ts and useFreshReport.ts, and the query cache
the app uses (@tanstack/query-core). It needs node and the web's dependencies: this
tree's web/node_modules, else MRR_WEB_NODE_MODULES, else the main checkout's beside
a worktree. It is skipped without them.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

REPRO = r"""
const fs = require("fs");
const dep = process.env.WEB_NODE_MODULES + "/";
const ts = require(dep + "typescript");
const { QueryClient } = require(dep + "@tanstack/query-core");
function loadSource(path, bindings) {
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  new Function("require", "module", "exports", code)((n) => { if (n in bindings) return bindings[n]; throw Error("Unexpected import " + n); }, m, m.exports);
  return m.exports;
}
const state = loadSource("web/src/screens/shared/fresh-state.ts", {});
const fresh = loadSource("web/src/screens/shared/useFreshReport.ts",
  { "react": {}, "../../api/queries": {}, "../../api/snapshot": {}, "./fresh-state": state });
(async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const stored = { generated_at: "2026-09-24T22:00:00Z", series: [{ id: "DGS10", label: "10Y", state: "close", as_of: "2026-09-24",
    kind: "fred", cadence: "daily", cycles_behind: 0, reason: "Sep 24 was the latest print" }] };
  qc.setQueryData(["freshness"], stored);
  try { await qc.fetchQuery({ queryKey: ["freshness"], queryFn: () => Promise.reject(Error("503 schema_check")) }); } catch {}
  const q = qc.getQueryState(["freshness"]);
  const block = { status: "awaiting", reason: "The freshness of these numbers could not be judged this time: schema check failed" };
  const report = fresh.freshReport(q.data, false, null, { isError: q.status === "error" });
  const seeded = fresh.freshReport(q.data, true, { generated_at: "2026-09-24T22:00:00Z" }, {});
  console.log(JSON.stringify({
    query_status: q.status, cached: q.data === stored, block,
    control: report.series("DGS10", null),
    series: report.series("DGS10", block), group: report.group(["DGS10"], block),
    at: report.at("DGS10", "2026-09-25", block), derived: report.derived("DGS10", block),
    seeded: seeded.series("DGS10", block),
    no_cached_report: fresh.freshReport(undefined, false, null, { isError: true }).series("DGS10", block),
  }));
  qc.clear();
})();
"""


def _node_modules() -> Path | None:
    for cand in (os.environ.get("MRR_WEB_NODE_MODULES"), ROOT / "web" / "node_modules",
                 ROOT.parent / "macro-regime-radar" / "web" / "node_modules"):
        if cand and (Path(cand) / "typescript").is_dir() and (Path(cand) / "@tanstack" / "query-core").is_dir():
            return Path(cand)
    return None


def test_an_awaiting_block_overrides_a_cached_freshness_date():
    """Codex R-31's repro: the query cache holds a report dating DGS10 Sep 24, the
    next freshness fetch fails (the cache keeps the report), and the credit data
    comes back with an awaiting block. Every reader, series, group, at and
    derived, seeded or not, labels those numbers "—" in the caution tone with the
    server's reason beside them, never "Sep 24"; without the block the cached
    report still reads Sep 24 (the repro's premise). On the staged code the
    series label read "Sep 24"."""
    node, modules = shutil.which("node"), _node_modules()
    if not node or modules is None:
        pytest.skip("node and the web dependencies (typescript, @tanstack/query-core) are needed")
    proc = subprocess.run([node, "-e", REPRO], cwd=ROOT, capture_output=True, text=True, timeout=120,
                          env={**os.environ, "WEB_NODE_MODULES": str(modules)})
    assert proc.returncode == 0, proc.stderr[-3000:]
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["query_status"] == "error" and out["cached"] is True, out
    assert out["control"]["word"] == "Sep 24", out["control"]
    reason = out["block"]["reason"]
    for reader in ("series", "group", "at", "derived", "seeded", "no_cached_report"):
        label = out[reader]
        assert label == {"word": "—", "muted": reason, "tone": "delayed", "reason": reason, "stale": False}, (reader, label)
        assert "Sep 24" not in json.dumps(label), (reader, label)


def test_the_recession_route_labels_an_awaiting_block_as_the_hook_does(tmp_path):
    """Verifier V-62: the Recession screen never passed its payload's block to the
    hook, so R-31's rule did not reach it. Codex's repro on /app/recession
    (tests/web/RecessionScreen.awaiting.test.tsx): the real screen, rendered with
    vitest in a copy of web/ (web/ itself is not written), a cached report dating
    the inputs Sep 24, a failed freshness fetch, and an awaiting block. The hero
    chip and the Inputs through row read "—" with the reason; the premise without
    the block reads Sep 24. On the staged code the chip read the cached dates."""
    node, modules = shutil.which("node"), _node_modules()
    if not node or modules is None:
        pytest.skip("node and the web dependencies are needed")
    web = tmp_path / "web"
    shutil.copytree(ROOT / "web", web, ignore=shutil.ignore_patterns("node_modules", "dist", "test-results", "playwright-report"))
    (web / "node_modules").symlink_to(modules)
    test = "src/screens/recession/RecessionScreen.awaiting.test.tsx"
    shutil.copy(ROOT / "tests" / "web" / "RecessionScreen.awaiting.test.tsx", web / test)
    proc = subprocess.run([str(web / "node_modules" / ".bin" / "vitest"), "run", test], cwd=web, capture_output=True, text=True,
                          timeout=300, env={**os.environ, "CI": "1", "NO_COLOR": "1"})
    out = proc.stdout + proc.stderr
    assert proc.returncode == 0, out[-5000:]
    assert "2 passed" in out, out[-3000:]


def test_the_recession_and_credit_screens_carry_no_cached_date_under_an_awaiting_block(tmp_path):
    """Codex R-31, round 10: the awaiting block passed through the Recession panels
    (ModelInputs, CurveMonitor, TransparencyPanel) and the LBO date helpers
    (lbo-copy.ts), asserted across the whole rendered Recession and Credit
    screens (tests/web/AwaitingScreens.test.tsx), with a premise run for each.
    On the staged code both screens printed the cached dates."""
    node, modules = shutil.which("node"), _node_modules()
    if not node or modules is None:
        pytest.skip("node and the web dependencies are needed")
    web = tmp_path / "web"
    shutil.copytree(ROOT / "web", web, ignore=shutil.ignore_patterns("node_modules", "dist", "test-results", "playwright-report"))
    (web / "node_modules").symlink_to(modules)
    test = "src/screens/AwaitingScreens.test.tsx"
    shutil.copy(ROOT / "tests" / "web" / "AwaitingScreens.test.tsx", web / test)
    proc = subprocess.run([str(web / "node_modules" / ".bin" / "vitest"), "run", test], cwd=web, capture_output=True, text=True,
                          timeout=300, env={**os.environ, "CI": "1", "NO_COLOR": "1"})
    out = proc.stdout + proc.stderr
    assert proc.returncode == 0, out[-6000:]
    assert "4 passed" in out, out[-3000:]
