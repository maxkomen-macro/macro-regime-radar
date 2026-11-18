# Phase 3 held-out freeze (P3-A21)

Branch `claude/project-thread-p630pt`. Tooling commit P3-F1 `eddcb54`; freeze file
`scripts/options_bench/calibration/phase3-freeze.json` (commit P3-F2, this file beside it). Dev seed 20261026 only; no held-out case
has been drawn or inspected. Design: `designs/design-P3-approved.md` (8.2, 8.3, 8.5, 10) with P3-AM1..AM8.

## 1. What is frozen

| Item | Frozen value | Where |
|---|---|---|
| Numerical code | SHA-256 of 35 files: the engine (options_math, options_finder, options_engine, options_adaptive, options_fd, options_greeks, session), the adaptive-p2.1 copy and its loader, every bench module | `files_sha256`; `heldout_p3.py` refuses any difference |
| Configuration | config-am2 (h_sigma 0.00125, h_r 2.5e-4, h_d_frac 0.0025, m 0.5, p 0.25, F_G 2, F_h 4/3, smooth_divs on) plus **F_P = 2.0** | `phase3-config.json` |
| Seed | 1861184458, drawn 2026-11-18T19:22:57Z with `secrets.randbelow(2**31)`; not 20261026, 20261029, 20261102, 20261111 or 20261117 | `held_out.seed` |
| Claim regions | Ω from the dev draws; Ω_G = Ω for every Greek; Ω_X = Ω minus `sigma < 0.01` | `phase3-regions.json` |
| Sizes | G0 400, G1 530, G2 460, G3 1,217, G4 1,286, G5 900, G6 570, T1 958, X1 400 (6,721 draws) + 23 named | `held_out.sizes` |
| Targeted | every Greek in every group with applicable dev contexts (dividend: G2-G6, T1); cross-check pair in G1-G6, T1 | `targeted`, `cross_check_required` |
| Controls | C2-FD and C2-Q per group, C2-lattice + C1 per E-stratum (below) | `controls` |
| Scoring | score_p3.py, controls_p3.c2_verdict, report_p3.py (hashed). The report refuses a run whose manifest does not name this freeze file, seed, sizes and population, and any result that is not a job of it (foreign case, unknown key, duplicate). Every targeted pair has a row; any failure, straddle or bound violation inside Ω_G, sampled or named, fails that Greek's row (freeze review F-1) | |
| CPU | cap 130 h aggregate; no submission within 0.5 h of it; stop within 0.05 h of it | `cpu` |

## 2. Claim regions (8.2, 10), from dev evidence

- **Ω** (`regions_p3.support_from_dev` over the 960 in-domain dev draws): days 1-1,464; σ in [0.001, 1.5] ∪
  [2.0, 5.0]; K/S calls [0.557, 1.747], puts [0.535, 1.925] (0.5-99.5 percentiles); r [-0.0492, 0.1194];
  q [-0.0999, 0.0999]; up to 16 dividends; PV/S ≤ 0.2264.
- **Ω_G carve-outs: none.** Under Ω, the dev records have 0 confirmed failures, 0 straddles, 0 bound
  violations and 0 estimator-coverage misses in every (G, g) pair (`greek_evidence`), so no input is excluded.
- **Ω_X = Ω minus `sigma < 0.01`.** The FD role rule (production FD at L1, L2 against the corroborated price
  reference, as calibrate_p3's grid stage; a refusal counts as not agreeing) failed on Ω in G5 only: 115 of 120
  (95.8%), 4 refusals "grid not monotone at this volatility and drift" at σ = 0.00103-0.00238 and one
  disagreement (G5/87, 0.105·tol at σ 3.99). The refusal is the Péclet guard: with m_ref at its cap the L1 grid
  has Péclet = |drift|·2w/(2992·σ²); over G5's ranges inside Ω (|r − q| ≤ 0.15, τ ≤ 400/365, |ln K/X0| ≤ 0.675)
  it is at most 0.73 for σ ≥ 0.01, so no G5 input with σ ≥ 0.01 can refuse. On 50,000 dev-seed G5 draws (inputs
  only) refusals stop at σ = 0.0060. With the carve-out: every group 100% except G5 101/102 (99.02%), 0 confirmed
  failures. A Tier 2 price with σ < 0.01 is "cross-check unavailable: FD not validated for these inputs".

## 3. Sizes (8.2)

π per (G, g) is measured on the dev records joined with a production re-run under these regions and F_P = 2
(`.loop/calibration/freeze/prod-dev`, the reference side from run-am8x; in-region Greek values identical to
run-am8x). n = ceil(300/(0.8·π)), n_g = max(400, largest targeted need), cap 2,500 (G6 3,500, D4). No pair is
"decision needed" or "not targeted". The cross-check pair is sized by the same rule and never binds (largest
need 479, G5). Binding pairs: G0 floor; G1 rho/theta 530; G2 theta 460; G3 dividend 1,217; G4 dividend 1,286;
G5 dividend 900; G6 dividend 570; T1 dividend 958. Groups plan only (strata not used, P3-A17).

## 4. Controls (7.3), sized so each can be checked

`c2_verdict` needs 300 scored values per quantity (0 misses in 300 gives a 95% upper limit of 0.997%). At 300
contexts a quantity with a dev scored rate below 1 (theta 0.92-0.97, gamma 0.91 on E-nodiv) or applicable to
some contexts only (the dividend sensitivity) could not reach 300. Each control is therefore sized like a pair:
- C2-FD and C2-Q, per group: the group's first `base` held-out draws run every quantity, base =
  max(300, ceil(300/(0.8·rate))) over the non-dividend quantities (G0 375, G1 375, G2 402, G3 402, G4 385,
  G5 392, G6 375, T1 410); the dividend sensitivity also runs alone on the group's first 375 draws carrying a
  dividend (a filter on inputs, inside the frozen group draws: no extra draw).
- C2-lattice and C1, per E-stratum: the first `base` kept proposals (E-nodiv 413, E-div 385, E-long 382,
  E-vol 388, G0 392); C2-lattice's dividend sensitivity also on the first 375 kept with a dividend. Proposal
  counts by DR-15 from the dev acceptance (20,000 dev proposals each): E-nodiv 3,827, E-div 15,354,
  E-long 20,690, E-vol 27,473, G0 784.
- A plan the population cannot supply is "not established: sample not reached" for that row (no top-up).

## 5. Phase 2 rows on this population (8.3)

Tier 2's answer for every held-out context against the verbatim adaptive-p2.1 file (blob c35574ad, loaded in
the same process): `answer_json` and the full answer (audit included, version apart) bit for bit. Every 50th
case and every named case: production re-run from scratch, identical to the record. The 23 named regressions run
the full case job. Tier 1 golden bit-identity stays the suite's test. Tier 2 price against the FD price
reference is reported, not gated.

## 6. Run mechanics (P3-A21)

- From an immutable checkout of the freeze commit (`git worktree add --detach`), output outside it; refusals:
  changed file, tracked change, registered seed, a directory started under another freeze or population,
  results without a manifest, a result whose case is not its job's.
- Fixed interleaved order (each stream at the same fraction of its length); one JSON line per finished job; a
  crash is a recorded result; resume runs only the unwritten jobs.
- CPU meter: worker and parent user + system CPU sampled every 15 s to `cpu-meter.jsonl`; a session's end
  record is exact (children reaped); a session lost to a container stop adds its last sample plus 4 × 15 s.
  The total over all sessions counts lost and recomputed work. CPU and wall are recorded separately.
- Not run on held-out: the dev-only diagnostics (delta-difference gamma, QuantLib Greeks; 7.6 feeds no gate).

## 7. Forecast (this host)

| Part | CPU h |
|---|---|
| Group cases (production, references, price reference, C1, at dev per-context cost) | 96.6 |
| C2-FD and C2-Q (bases 7.9; dividend runs estimated at half a context's cost, 1.3) | 9.2 |
| E-strata C2-lattice + C1 | 0.9 |
| Named cases, repeats, adaptive-p2.1 comparison | ~1 |
| **Point** | **~107.6** |

Up from 102.85 h: the control sizes of section 4 (+2.8 h), the regions' effect on G1/G2 (+0.7 h), named and Phase
2 rows (+1 h). The 130 h cap is a stop, not a forecast: the dev tails (per-context maxima 2,740 s) make an
overrun before completion possible, and the run then stops with every finished result kept.
