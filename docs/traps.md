# Eight traps, and the check that catches each

Every item here is a mistake that was actually made while running this test once, found
weeks later, and in two cases reversed a conclusion that had already been written up. The kit
turns each into a line in the Checks tab or a column in the Readout.

## 1. The verdict depends on where you cut the funnel

Both arms end at the same place: the next stage (questionnaire, intake form, trial). The call
is an **extra gate in front of it**, not an alternative to it. But the call also opens a
**second route**: a rep can qualify someone on the call and move them forward without the
next stage ever happening. Score the test on "reached the next stage" alone and the call arm
loses by construction, because part of its qualified cases never touch that step.

Three endpoints, three different answers is the normal outcome, not a paradox:

| Endpoint | Typical reading |
|---|---|
| reached the next stage | skip arm ahead (it is the only thing that arm can do) |
| qualified by any route | no consistent winner, or call arm ahead |
| proposal, won | nothing significant at the volumes most companies have |

**Check:** "Call arm: qualified without reaching the next stage". If it is not zero, read both
endpoints and say which one you are deciding on, before you look at the numbers.

## 2. An automation that is not arm-aware picks the winner

Outreach stacks have more than one path that can deliver the offer: the sequence step, an
AI auto-reply to people who answer early, a chatbot, a rep. If any of those is hard-coded to
one arm, it routes **self-selected early responders**, the highest-intent people in the
population, into that arm. Arm sizes drift away from the planned split and the favoured arm
"wins" on a selection effect.

**Checks:** "Arm balance vs planned split" (exact binomial test), "Non-randomized assignment
share per arm" (Fisher on `assignment_source`), and "Primary endpoint, randomizer-only
subjects", which recomputes the comparison on the randomized subset and warns when it
disagrees with the pooled line. Decide on the randomizer-only line.

A related bug: a random-number step configured over `1–2` that floors to `1` is a coin that
always lands heads. A two-way split needs a width-two range. Check the first week's split
before trusting the randomizer.

## 3. A younger cohort cannot show late conversions

Conversions arrive with a lag. A subject offered last week has had no chance to reach a
45-day endpoint. Pool young and old subjects and the younger arm reads "behind" by
construction. The same error, one level down: a weekly cohort scored at "age 14" contains
people offered on seven different days, so the Sunday entrant has only had eight days.

**Readout:** the "mature n" and "within window" columns use only subjects observed for the
full window. **Maturation:** every age cell counts only subjects observed at least that long,
and the young-cohort scorecard evaluates the expected curve at **each subject's own age**.
**Plan:** the read dates are freeze + window, not "when the numbers look interesting".

## 4. Mix: the blended rate is a weighted average

If one arm has more of a high-converting segment (warm lists, event attendees, inbound), it
wins on the blend while being identical or worse per segment. Simpson's paradox is the
normal state of a multi-channel test, not an edge case.

**Readout:** the by-segment table shows each segment's rate per arm and its share of each
arm. If shares differ, compare within segments. If you want one number, standardise: apply
arm B's segment rates to arm A's segment weights.

## 5. Same word, different denominator

"Offered" must mean the same event in both arms: the **first** arm-bearing touch per person.
If one arm's denominator is "received a link" and the other's is "replied positively and got a
link", you are not comparing arms, you are comparing definitions. Likewise, milestones must
come from **first entry** into a stage, not from the current stage: a deal that moved to
proposal and was then marked lost still reached proposal.

**Contract:** `offered_at` = earliest arm-bearing message. **Parser:** outcomes dated before the
offer are prior engagement and leave the table; they are never re-dated or reassigned.

## 6. A test that never closes cannot be read

Entry must stop on a date. Subjects who arrive later start a new version with its own tables.
Two things go wrong otherwise: the published numbers change under the reader every morning,
and a new experiment that reuses an audience steals rows from the frozen one. When a list or
campaign is reused, claim membership by **identifier and date**, never identifier alone. A
window that opens "today" also absorbs whatever the previous flow sent that morning, which is
pre-randomization contamination.

**Plan:** freeze date and read dates. **Checks:** "Offers outside start/freeze window".

## 7. A null result is not parity

"No significant difference" is the most common honest reading and the most abused one. It
can mean the arms are equal, or that the test could not have seen a difference of the size
that matters. The sentence that is allowed is: "the skip arm is within X pp of the call arm
with 95% confidence", or "the data cannot rule out a loss larger than X pp".

**Readout:** the primary-endpoint block prints the Newcombe interval of the difference, the
one-sided non-inferiority verdict against `ni_margin`, and the power at the current mature n.
**Plan:** "What this test can read at the planned n", so that a won-rate verdict is not promised
on a test sized for a fill rate.

## 8. One join key undercounts, silently

Matching the next-stage event back to the offered person on email alone misses people who
filled a form with a personal address, typo'd their domain, or exist in the CRM under a first
name only. The unmatched look exactly like "did not convert". In the original test a
name-and-profile re-match found fills the email join had missed, and the correction reversed
one published comparison.

**Contract:** match on at least two independent keys with a collision rule, and report the
match rate next to the numerator. The kit cannot do this for you: it starts after the join.
