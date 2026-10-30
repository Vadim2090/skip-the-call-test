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

Try it on the sample first: `examples/crm-export-sample.csv` is a 40-row export with its own
column names, labels and `dd/mm/yyyy` dates, and `examples/mapping-sample.json` is the mapping below.

```bash
python3 -I adapters/map_csv.py --mapping examples/mapping-sample.json --in examples/crm-export-sample.csv --out /tmp/events.csv
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

## `join_keys.py`: attach outcomes on several keys

When the next stage lives in another system (a form tool, a CRM stage log), the outcome has to
be matched back to the offered person. Email alone misses everyone who used a personal
address, and the miss is invisible: it reads as "did not convert". The script tries each key
in the order you give, never uses a key value shared by two subjects, keeps the earliest date,
and prints the match rate per key.

```bash
python3 -I adapters/join_keys.py --offers examples/join-offers-sample.csv \
  --outcomes examples/join-fills-sample.csv --keys email,linkedin,name \
  --date-col submitted_at --date-format %d/%m/%Y --into stage_at \
  --out /tmp/events-joined.csv --unmatched /tmp/unmatched.csv
```

On the sample, email alone matches 3 of 7 fills; email, LinkedIn URL and full name match 6.
Key columns need the same names in both files; `email*`, `linkedin*` and `name*` columns get
normalised (case, URL form, accents, a first name alone is not a key).
