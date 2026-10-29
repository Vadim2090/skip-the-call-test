# Adapters

The kit starts at the Events table. Getting there from your stack is a join of the outreach
tool (who got which offer, when, through which path), the next-stage system (form tool,
product event, CRM stage entry) and the CRM (proposal, won). That join is yours; the shape
of the result is fixed by `docs/data-contract.md`.

## `map_csv.py`: any CSV export → Events

Standard library only. You describe which of your columns map to which Events columns in a
small JSON file, and the script writes a clean `events.csv`.

```bash
python3 -I adapters/map_csv.py --mapping my-mapping.json --in crm-export.csv --out events.csv
```

`my-mapping.json`:

```json
{
  "columns": {
    "subject_id": "Person ID",
    "arm": "Offer variant",
    "offered_at": "First offer sent",
    "assignment_source": "Offer sent by",
    "channel": "Channel",
    "segment": "List",
    "call_booked_at": "Intro call booked",
    "call_held_at": "Intro call held",
    "stage_at": "Questionnaire submitted",
    "qualified_at": "Assessment requested",
    "proposal_at": "Proposal sent",
    "won_at": "Won date",
    "revenue": "Deal value"
  },
  "arm_values": { "call": ["Call first", "meeting"], "skip": ["Questionnaire first", "questionnaire"] },
  "source_values": { "randomizer": ["Sequence step"], "auto": ["AI reply", "Autoresponder"], "manual": ["Rep"] },
  "date_format": "%d/%m/%Y"
}
```

- Unmapped Events columns are written blank.
- `arm_values` and `source_values` translate your labels; anything unmatched is kept as-is
  and the engine's Checks tab will report it.
- `date_format` is a `strptime` pattern for your export; ISO dates pass through unchanged.

The script does not call any API and does not know any particular CRM. If your stack has an
API, the pattern is the same: pull once per source, join on at least two keys, write this CSV.
