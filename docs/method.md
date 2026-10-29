# Method: what the kit computes and how

Everything below runs from the Events tab and the Config tab. `src/stats.js` holds the
statistics, `src/engine.js` the table logic; both are plain JavaScript with tests under
`tests/`.

## Definitions

- **Subject**: one person or account that received the offer. One row.
- **Arm**: `call` (control, qualification call first) or `skip` (treatment, straight to the
  next stage).
- **Offered**: the date of the first arm-bearing message. Age = `snapshot_date - offered_at`.
- **Endpoint**: a dated event after the offer. Four are built in: reached the next stage,
  qualified by any route, proposal, won. Each has a **window** in days (Config `maturity_*_days`).
- **Mature on an endpoint**: age ≥ window. A conversion **within window**: event date minus
  offer date ≤ window.
- **Prior engagement**: any outcome dated before the offer. The subject is excluded by default.
- **Censored**: any outcome dated after the snapshot. Blanked for that read.

## Plan

| Quantity | Formula |
|---|---|
| Subjects per arm, superiority | n = [ z₁₋α/₂ √(2 p̄ q̄) + z₁₋β √(p₁q₁ + p₂q₂) ]² / (p₁ − p₂)², with p₁ = baseline, p₂ = baseline + MDE, p̄ their mean |
| Subjects per arm, non-inferiority | n = (z₁₋α + z₁₋β)² · 2 p q / margin², assuming equal true rates p = baseline |
| Weeks to enrol | ⌈ 2n / offers_per_week ⌉ |
| Freeze date | start + weeks × 7 (or the Config value) |
| Read dates | freeze + window, per endpoint |
| Readability of secondary endpoints | power at the planned n to detect the same **relative** lift on that endpoint's baseline. Below 50% the plan says "not readable" |

Normal quantiles use Acklam's algorithm; the CDF uses an erfc approximation accurate to about
1e-7, which is plenty for p-values at three decimals.

## Readout

For each endpoint and arm: offered, mature n, converted within window, rate on mature,
Wilson 95% interval, converted to date, rate to date. Then a comparison line:

- **Difference** skip − call on the mature rates, in percentage points.
- **Interval of the difference**: Newcombe's hybrid score method, which stays sensible at zero
  conversions where the Wald interval collapses.
- **p-value**: two-sided Fisher exact test on the 2×2 of mature subjects, computed in log space.
  Fisher rather than a z-test because conversions in these funnels are often single digits.
- **Verdict**: "significant: X higher" when p < α, else "no significant difference".

For the primary endpoint, when not significant:

- **Non-inferiority**: the one-sided (1 − α) lower bound of (p_skip − p_call) is compared with
  −margin. Above it, the skip arm is non-inferior within the margin. Otherwise the readout
  says the data cannot rule out a loss larger than the margin.
- **Power at current n**: the probability this many mature subjects would have detected the
  planned MDE. Below 80% the line says to keep enrolling or wait for maturity.

By segment: for the primary endpoint, mature n and rate per arm, Fisher p, and each segment's
share of each arm. Unequal shares are the mix warning.

## Maturation

**A. Curve.** For each endpoint, arm and age checkpoint a: exposed n = subjects with age ≥ a;
converted = those with event date − offer date ≤ a. Rate = converted / exposed. This is the
exposure-correct denominator: a subject contributes to a cell only when it could have
converted by that age.

**B. Young cohorts.** Subjects are grouped by offer week (Monday start). For every week whose
youngest subject is below the primary window, the kit computes:

- observed = conversions to date in the week;
- expected = Σ over subjects of curve(min(age_i, window)), where the curve is the arm's own
  maturation curve built from fully observed subjects (≥ 30 of them, else both arms pooled)
  and linearly interpolated between checkpoints;
- status: "ahead" if the expected rate is below the Wilson interval of the observed rate,
  "behind" if above, else "on pace"; "too few" below 20 subjects.

This replaces the usual "cohort age = days since the week started", which scores the Sunday
entrant as if it had the Monday entrant's exposure and paints the three newest weeks red.

## Checks

| Check | Statistic | Status rule |
|---|---|---|
| Header, duplicates, unknown arm, missing offer | counts | FAIL / WARN |
| Prior engagement | count | INFO |
| Offers outside start/freeze | count | WARN if any |
| Arm balance vs planned split | exact binomial two-sided | WARN if p < 0.05 |
| Non-randomized share per arm | Fisher on (auto + manual) vs randomizer by arm | FAIL if p < 0.05 |
| Randomizer-only vs pooled, primary endpoint | Fisher on both; difference of differences | WARN if significance disagrees or the gap exceeds MDE / 3 |
| Call arm: qualified without next stage | count of `qualified_at` with blank `stage_at` | INFO |
| Call arm: next stage after a held call | `call_held_at ≤ stage_at` | INFO |
| Power at current mature n | as in Plan | WARN below 80% |
| Subjects younger than the window | count | INFO |

## What the kit does not do

- It does not join your systems. The Events table is yours to produce; `docs/data-contract.md`
  says how, `adapters/` has a CSV mapper.
- It does not sequentially monitor. Reading the test every morning and stopping when p dips
  under 0.05 inflates the false-positive rate; the Plan gives read dates for that reason.
- It does not model revenue. Won and revenue are displayed; at typical volumes the plan will
  tell you they are not readable, and that is the honest answer.
