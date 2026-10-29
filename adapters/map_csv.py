#!/usr/bin/env python3
"""map_csv.py: turn any CSV export into the Events shape the kit reads.

    python3 -I adapters/map_csv.py --mapping mapping.json --in export.csv --out events.csv

Standard library only. See adapters/README.md for the mapping file.
"""
import argparse
import csv
import json
import sys
from datetime import datetime

EVENT_COLUMNS = [
    "subject_id", "arm", "offered_at", "assignment_source", "channel", "segment",
    "call_booked_at", "call_held_at", "stage_at", "qualified_at", "proposal_at",
    "won_at", "revenue",
]
DATE_COLUMNS = {"offered_at", "call_booked_at", "call_held_at", "stage_at",
                "qualified_at", "proposal_at", "won_at"}


def normalise_date(value, fmt):
    value = (value or "").strip()
    if not value:
        return ""
    if len(value) >= 10 and value[4] == "-" and value[7] == "-":
        return value[:10]
    if fmt:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    for guess in ("%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d %b %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, guess).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return value  # the engine will report it as unparsable


def translate(value, table):
    v = (value or "").strip()
    for target, aliases in (table or {}).items():
        if v.lower() == target.lower() or v.lower() in [a.lower() for a in aliases]:
            return target
    return v


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mapping", required=True)
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    with open(args.mapping, encoding="utf-8") as f:
        mapping = json.load(f)
    cols = mapping.get("columns", {})
    fmt = mapping.get("date_format")
    missing = [c for c in ("subject_id", "arm", "offered_at") if c not in cols]
    if missing:
        sys.exit("mapping must name source columns for: " + ", ".join(missing))

    n_in = n_out = 0
    with open(args.src, newline="", encoding="utf-8-sig") as fin, \
            open(args.out, "w", newline="", encoding="utf-8") as fout:
        reader = csv.DictReader(fin)
        unknown = [src for src in cols.values() if src not in reader.fieldnames]
        if unknown:
            sys.exit("source columns not found in the export: " + ", ".join(unknown))
        writer = csv.DictWriter(fout, fieldnames=EVENT_COLUMNS)
        writer.writeheader()
        for row in reader:
            n_in += 1
            out = {}
            for col in EVENT_COLUMNS:
                src = cols.get(col)
                val = row.get(src, "") if src else ""
                if col in DATE_COLUMNS:
                    val = normalise_date(val, fmt)
                elif col == "arm":
                    val = translate(val, mapping.get("arm_values")).lower()
                elif col == "assignment_source":
                    val = translate(val, mapping.get("source_values")).lower()
                out[col] = (val or "").strip()
            if not out["subject_id"]:
                continue
            writer.writerow(out)
            n_out += 1
    print(f"read {n_in} rows, wrote {n_out} subjects to {args.out}")


if __name__ == "__main__":
    main(sys.argv[1:])
