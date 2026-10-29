# Field notes from the test this kit comes from

One B2B services company with a long sales cycle, outbound-led, 2026. The qualification
step was a 10-minute intro call before an online questionnaire; the hypothesis was that
sending people straight to the questionnaire would not lower the fill rate while freeing the
reps' calendars. The company's own numbers are not published. **Every number below is an
illustrative sample**: invented, sized like a typical outbound test, and built to reproduce the
**shape** of what happened. It is not the real data and not a benchmark.

## Volume

| Cohort | Treatment (skip) | Control (call) |
|---|---|---|
| randomized A/B, frozen window | ~620 offers | ~580 offers |
| observational pre/post, same months | ~540 offers | ~1,150 offers |

Won: two deals in the call flow and one in the skip flow in the observational cohort, none in
the randomized one. No revenue
verdict was possible, and the plan should have said so on day one.

## The three endpoints

| Endpoint | Randomized cohort | Observational cohort |
|---|---|---|
| filled the questionnaire | skip ahead, p ≈ 0.02 | parity, p ≈ 0.7 |
| questionnaire OR qualified on the call | no significant difference, p ≈ 0.3 | call ahead, p ≈ 0.04 |
| proposal | nothing significant | nothing significant |

The first write-up answered "does the fill rate drop when the call is removed?" with "no",
and that stayed true. It was not the same question as "which flow produces more qualified
cases". In the sample, the call is taken several times more often than the questionnaire is
filled (about 11% vs 3% of offers in the observational control arm); of those who take the
call, about one in four go on to fill the questionnaire and about two in five reach a
qualification request without it. The call **substituted** for the questionnaire as the
qualifying step, whatever the copy said about "preparing you for the questionnaire".

## What went wrong, in order of discovery

1. **Arm sizes came out visibly unequal for a 50/50 split** (in the sample, 236 vs 178 among
   the ~410 replies that reached the split step). An AI auto-reply that answered early
   responders was hard-coded to send the questionnaire link. Early responders are the
   highest-intent people in the population. Within the randomized split node the arms had the
   same reply rate; the surplus in the treatment arm was the auto-routed people. Compared on
   the randomized subset only, nothing was significant.
2. **A random-number step over `1–2` floored to `1`.** Every auto-reply assignment before the
   fix went to one arm. Fixed by widening the range; the affected weeks were caveated.
3. **"Meeting" meant two things.** The intro call (before the questionnaire) and the
   proposal meeting (after it) were both "meeting" in the CRM. The arm whose whole point was
   "no intro call" showed intro calls, which were in fact post-questionnaire results calls.
   Fixed by requiring the call to precede the fill.
4. **The newest three cohort-weeks were "behind" every week.** The cohort age was clocked
   from the week's Monday; subjects offered on Sunday were scored as if they had had six more
   days. Fixed with per-subject exposure, which is what the Maturation tab does.
5. **Email-only matching of fills to offered people missed a material share of them.** A
   name-and-profile re-match found fills the email join had read as "no outcome". The
   corrected count reversed one published comparison.
6. **A new experiment version reused an audience list.** Claiming membership by list id alone
   pulled rows out of the frozen cohort. Fixed by claiming on id **and** date.

## What it cost, and what it bought

In the sample, the call-first flow books roughly one intro-call slot per six offers, and about
a third of those slots end in a no-show (so about 11% of offers hold a call, as above). All
that calendar time buys about the same fill rate as the questionnaire-first flow. That capacity trade-off, not a conversion lift, was the basis for
making questionnaire-first the default for cold channels while keeping the call for warm ones.

## If you run it

- Size the test on the fill rate and say in writing that won will not be read.
- Make every automation arm-aware before the first offer, and log the assignment source.
- Decide the endpoint before the first read. Both of them.
- Put the first read date in the calendar and do not open the readout before it.
