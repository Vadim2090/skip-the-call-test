---
name: skip-the-call-test
description: Plan, run and read an A/B test that removes a step from a long, sales-led funnel (an intro or qualification call, a demo, a discovery call) without fooling yourself. Use when someone asks whether they can drop the qualification call or another sales step, how many leads or weeks such a test needs, how to turn CRM, outreach and form exports into one table, how to read the result of such a test, or whether a write-up of one is trustworthy. Covers sizing, randomization, joining sources on several keys, maturity, the endpoint choice and an honest conclusion.
---

# skip-the-call-test

A kit for one question: **does removing a step in front of qualification lose qualified
cases, and how many?** The statistics and the checks live in `src/` (plain JavaScript, Node 18+);
the adapters in `adapters/` are Python 3 standard library. Paths below are relative to this
skill's folder. The data stays where the user keeps it; nothing here calls a network.

Pick the mode from what the user has, and say which one you are in.

| The user has | Mode |
|---|---|
| An idea, no data yet | 1. Plan |
| Exports from a CRM, an outreach tool, a form tool | 2. Build the Events table |
| An Events table (or a sheet in that shape) | 3. Readout |
| A written conclusion or a dashboard to judge | 4. Review a write-up |

Read `docs/traps.md` once before the first answer in any mode. Every rule below exists
because one of those traps was hit in a real test.

## 1. Plan: can this test be run at all?

First ask which endpoint the decision will be on, because the numbers depend on it:
"reached the next stage", or "qualified by any route" (the call can qualify someone who never
reaches the next stage, so the first one undercounts the call arm). Set `primary_endpoint`
(`stage` or `qualified`) and its window (`maturity_stage_days` or `maturity_qualified_days`,
the usual lag from offer to that endpoint). Then ask for three numbers:

1. `baseline_rate`: today's rate from the offer to **that endpoint** in the flow **with** the step.
2. `mde`: the smallest absolute difference worth acting on (2% means 3% vs 5%).
3. `offers_per_week`: subjects entering the test per week, both arms together.

Optional: `ni_margin` (how much the skip arm may lose and still count as "no worse"; blank =
mde), `proposal`/`won` baselines (to see whether those endpoints are readable), `start_date`.

```bash
node examples/plan.js --baseline 3% --mde 2% --per-week 200 --proposal 1.2% --won 0.3% \
  --primary_endpoint stage --maturity_stage_days 30
```

Answer with the **Verdict** line first, in the user's words: feasible, long, or not practical,
the weeks for detection and for non-inferiority, and which endpoint they will have to decide
on. If it is not practical, say so plainly and name the levers the verdict names (larger MDE,
wider margin, more volume, or decide without a test and say so in writing). Then walk the
seven "Before launch" lines of the plan and ask, for each automation that can deliver the
offer (auto-replies, sequences, chatbots, reps), whether it knows about the arms.

Before launch, get two decisions in writing from the user, not from you: **the endpoint**
(the one the plan was sized on; changing it means re-running the plan with that endpoint's
baseline and window) and **the first read date** (freeze + window from the plan, not "when the
numbers look interesting").

## 2. Build the Events table

One row per subject who received the offer. Columns and meanings: `docs/data-contract.md`.
The three rules that break most tables:

- `offered_at` is the **first** message that carried the arm, the same event in both arms
  and in every channel. If one channel counts "pitched" and another counts "replied and got
  the link", the second one looks several times better on a warmer denominator.
- `assignment_source` says who put the subject in the arm: `randomizer`, `auto`, `manual`.
  Without it the readout cannot separate the treatment from the selection.
- Outcomes come from the **first** entry into a stage, not the current stage, and only
  outcomes after `offered_at` count.

One export that already holds everything:

```bash
python3 -I adapters/map_csv.py --mapping mapping.json --in export.csv --out events.csv
```

Write `mapping.json` from the export's header and a few rows (format: `adapters/README.md`,
worked example: `examples/mapping-sample.json`). Show the user the mapping before running it.

Outcomes in a separate system (a form tool, a CRM stage log): join them on **every key both
files have**, in order of reliability, and report the match rate:

```bash
python3 -I adapters/join_keys.py --offers events.csv --outcomes fills.csv \
  --keys email,linkedin,name --date-col submitted_at --into stage_at \
  --out events-joined.csv --unmatched unmatched.csv
```

Rename columns first so the key names match in both files. Put the match rate in the readout
next to the numerator. If it is below about 90%, open `unmatched.csv` with the user before
reading anything: an unmatched outcome looks exactly like "did not convert". Never fill a
match by guessing; a shared key value (one company inbox, two people with one name) is a
collision and the script already refuses it.

## 3. Readout

```bash
node examples/demo.js config.csv events.csv --md > readout.md
```

`config.csv` is `key,value` rows (`examples/config.csv`). Set `snapshot_date` to the read
date. Read the output in this order and report it in this order:

1. **Checks.** Any FAIL means the pooled readout is not the number to decide on. A FAIL on
   "Non-randomized assignment share" → decide on the "randomizer-only" line and say why.
2. **The primary endpoint**, mature columns only: both rates, the 95% interval of the
   difference, the non-inferiority verdict, the power at the current mature n.
3. **Qualified by any route**, the endpoint that includes what the call does on its own.
4. **Maturation**, only if the read is before freeze + window: it shows whether the young
   cohorts are on pace, and an arm without the call converts faster, so an early read flatters it.
5. **By segment**, if the arms have different segment shares.

The conclusion follows these rules, with no exceptions:

- Lead with the decision the data supports, then the numbers, each with its denominator.
- A null result is "the skip arm is within X pp of the call arm (95% interval)" or "the data
  cannot rule out a loss larger than X pp". Never "no difference".
- The verdict is on the `primary_endpoint` from the config: it was chosen before the read.
  If another endpoint points the other way, say so in the next sentence and recommend that the
  user weigh it, but do not silently move the decision onto it.
- If a read date has not arrived, say the result is provisional and give the date.
- Proposal and won are reported as counts unless the plan said they are readable.

Write the readout to one Markdown file the user can forward.

## 4. Review a write-up

Go through `docs/traps.md` one trap at a time against the user's text or dashboard and
return a table: trap, what the write-up does, verdict (fine / at risk / wrong), the fix. The
questions that find most problems:

- Who assigned the arm for each subject? Were any automations not arm-aware?
- Is "offered" the same event in every arm and channel?
- Were the arms read before both had the full window?
- Which endpoint is the conclusion on, and was it chosen before the read?
- On how many keys were outcomes matched, and what is the match rate?
- Does "no significant difference" come with an interval?

## Google Sheets instead of the command line

The same engine runs as an Apps Script menu: `docs/setup.md`. Point users who live in
spreadsheets to the template copy link in `README.md`.
