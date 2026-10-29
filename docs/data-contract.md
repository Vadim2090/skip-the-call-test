# Data contract: the Events tab

One row per subject who **received the offer**. Not per lead in the CRM, not per message
sent: per person who was shown either "book a call" or "go straight to the next stage".
The kit never reads your CRM. You produce this table, by export or by script, and
everything else is computed from it.

## Columns

| Column | Required | Type | Meaning |
|---|---|---|---|
| `subject_id` | yes | text | Stable id of the person or account. One row per id; later duplicates are dropped and counted in Checks |
| `arm` | yes | `call` / `skip` | `call` = control, the qualification call comes first. `skip` = treatment, the offer sends them straight to the next stage |
| `offered_at` | yes | date | The **first** message that carried the arm: the pitch wording or the link. Follow-ups do not move this date |
| `assignment_source` | recommended | `randomizer` / `auto` / `manual` | Who put the subject in the arm. `randomizer` = the split node. `auto` = an automation (auto-reply, chatbot, sequence) that picked the arm. `manual` = a person. Blank = `randomizer` |
| `channel` | optional | text | e.g. `linkedin`, `email`, `inbound`. Kept for your own slicing |
| `segment` | optional | text | Any grouping you want the mix check on: audience, list, persona, region |
| `call_booked_at` | optional | date | First qualification call booked |
| `call_held_at` | optional | date | First qualification call that happened. Needed for the "call precedes next stage" check |
| `stage_at` | the primary outcome | date | Reached the **next stage**: the step both arms can reach. Questionnaire filled, intake form submitted, trial started, audit delivered |
| `qualified_at` | recommended | date | Qualified by a route that is **not** the next stage, usually during or right after the call. The kit combines `stage_at` and `qualified_at` into "qualified by any route" |
| `proposal_at` | optional | date | Proposal, quote, or the meeting where price is discussed |
| `won_at` | optional | date | Signed / paid |
| `revenue` | optional | number | Only used for display next to `won` |

Dates: real date cells, `YYYY-MM-DD`, `YYYY-MM-DD hh:mm`, or `dd.mm.yyyy`. Blank = did not
happen (yet).

## Rules the kit applies to every row

1. **Gating.** An outcome dated before `offered_at` is prior engagement, not an effect of the
   offer. The row is flagged `prior`; with `exclude_prior = true` (default) it leaves every table.
   Do not re-date it, do not reassign it.
2. **Censoring.** An outcome dated after `snapshot_date` has not happened yet from the point
   of view of that read. It is blanked for the read and comes back when the snapshot moves.
3. **Maturity.** A subject is *mature* on an endpoint when `snapshot_date - offered_at >= window`.
   Rates in the "mature" columns use only mature subjects and count only conversions within the
   window. The "to date" columns use everyone and are not comparable across arms of different age.
4. **Any route.** `qualified_any = min(stage_at, qualified_at)` when both exist, else whichever exists.
5. **One randomization.** `assignment_source` is what lets the Checks tab separate the treatment
   effect from the selection effect. If you cannot fill it, say so in the readout: the pooled
   comparison then carries whatever your automations did.

## Deriving the rows from a CRM

The row is a join of three things most stacks keep apart:

| Piece | Where it usually lives | What to take |
|---|---|---|
| The offer and the arm | the outreach tool's sent messages, the sequence step, the email campaign | the earliest message per person whose text or template carries the arm; its date and its source (step node vs auto-reply) |
| The next stage | a form tool, a product event, a stage entry in the CRM | the **first entry** date, not the current stage. A deal that moved on and back still reached it |
| Downstream | the CRM | first entry into proposal / won, gated after the offer |

Match the pieces on more than one key. Email alone misses personal-vs-work addresses and
typos; add the profile URL or a normalised full name, and keep a collision rule. A single-key
join is a floor on your numerator and reads as "no outcome", which is invisible.

`adapters/map_csv.py` turns any CSV export into this shape with a small JSON mapping; see
`adapters/README.md`.
