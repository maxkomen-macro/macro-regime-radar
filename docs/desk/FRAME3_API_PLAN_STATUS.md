# Frame-3 API plan: status

Checked 2026-09-26.

## The plan

- **File:** `docs/desk/FRAME3_API_PLAN.md` on `desk/frame-3-api-plan`.
- **Last plan commit:** `584a4af4c230d5fd9a6eab4e766e5b1c5cdebe20` ("frame-3: API plan, Codex
  round-8 fix (S-30 today curve)").
- **Base:** `42298cb`, `desk/frame-3` as of the re-check. That branch's tip is now `ee373dc`
  ("frame-3: codex-3 fixes"). The plan is not rebased onto it.
- **Estimates:** B1 21.25 h, B2 25 h.

## Review history

The plan went through **eight Codex rounds**, each applied in its own commit:

| Commit | What |
|---|---|
| `bb43ab8` | the original plan |
| `2494741` | Codex round 1 |
| `caae5a3` | the intraday validation ruling |
| `e60da43` | the operator rulings on §6 |
| `84cccfc` | Codex round 2 |
| `faa8d80` | Codex round 3 |
| `f842751` | Codex round 4 |
| `7050f57` | Codex round 5 |
| `1bb7a52` | re-checked against spec `42298cb` |
| `7a40167` | Codex round 6 |
| `292674b` | Codex round 7 |
| `584a4af` | Codex round 8 (S-30 extended to today's curve) |

## §6 spec rows

The plan has **32 rows**, S-01 to S-32.

- **11 are ruled:** S-01, S-04, S-10, S-12, S-21, S-25 and S-28 to S-32.
- **The other 21** are built as the plan's "Plan does" column says.
- **S-01 to S-27** are folded into `DESK_FRAME3_SPEC.md` at `42298cb`.

## Session-A prerequisites

Session A owns the spec fold of S-28 to S-32. S-30 and S-32 also need session A's UI work.

The "at the tip" column probes the committed spec at `ee373dc`. The last column records an
uncommitted edit to the spec that the `mrr-frame3` worktree held at this check. It is not
committed and may change.

| Row | What it adds | Folded at the tip (`ee373dc`) | Uncommitted edit in `mrr-frame3` |
|---|---|---|---|
| S-28 | §12.0 `error` carries `provider` and `retryable` only on `schema_check` | **Yes** | none needed |
| S-29 | §12.8 `month_ago` when `today.date` is null: per-tenor dates, each difference null | **No** | carries it |
| S-30 | §6 curve card: each snapshot checked on its own date. A null `today.date` or `month_ago.date` draws that snapshot's tenors as labelled points with no connecting line, its dates listed under the chart. Session A's regression test covers both snapshots | **No** | covers the month-ago snapshot only. Today's curve (round 8's R-20) is not in it |
| S-31 | §12.2 RSI preset: 422 `unsupported` with any `horizon`, awaiting without one | **Partly.** The 422 half follows from R-27's "a horizon outside the study's `allowed_horizons`", since that list is empty; the awaiting half is not stated | states both halves |
| S-32 | §1.1 and §11: the Client view footer prints `Snapshot · <as_of>` with no generation id and is hidden in print; the mixed-generation check still runs there | **No** | carries it |
