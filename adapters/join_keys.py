#!/usr/bin/env python3
"""join_keys.py: attach an outcome (a form fill, a stage entry) to the people who were offered,
matching on several keys in turn, and say how many it could not match.

    python3 -I adapters/join_keys.py --offers events.csv --outcomes fills.csv \\
        --keys email,linkedin,name --date-col submitted_at --into stage_at --out events-joined.csv

Both files need the key columns under the same names (rename them first if they differ).
The offers file needs `subject_id`. For each outcome row the keys are tried in the order given;
the first key whose normalised value points to exactly one offered subject wins. A key value
shared by two or more subjects is a collision and is never used to match. The earliest outcome
date per subject is written into the `--into` column; an existing earlier date is kept.

The report on stdout is the point: matched share, matches per key, collisions and unmatched rows.
An unmatched outcome is invisible in every readout, it looks exactly like "did not convert".
Standard library only.
"""
import argparse
import csv
import re
import sys
import unicodedata

ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from map_csv import normalise_date  # noqa: E402


def norm_email(v):
    v = (v or "").strip().lower()
    return v if "@" in v else ""


def norm_linkedin(v):
    v = (v or "").strip().lower()
    m = re.search(r"linkedin\.com/in/([^/?#\s]+)", v)
    slug = m.group(1) if m else v.strip("/")
    return slug.strip("/") if slug and " " not in slug else ""


def norm_name(v):
    v = unicodedata.normalize("NFKD", (v or "").strip().lower())
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = re.sub(r"[\W_]+", " ", v)       # keeps letters of any script, drops punctuation
    parts = v.split()
    return " ".join(parts) if len(parts) >= 2 else ""   # a first name alone is not a key


NORMALISERS = {"email": norm_email, "linkedin": norm_linkedin, "name": norm_name}


def normaliser(key):
    for prefix, fn in NORMALISERS.items():
        if key.lower().startswith(prefix):
            return fn
    return lambda v: (v or "").strip().lower()


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offers", required=True, help="CSV with subject_id and the key columns (usually the Events file)")
    ap.add_argument("--outcomes", required=True, help="CSV of outcome events with the key columns and a date")
    ap.add_argument("--keys", required=True, help="key columns in priority order, e.g. email,linkedin,name")
    ap.add_argument("--date-col", required=True, help="outcome date column in --outcomes")
    ap.add_argument("--into", required=True, help="Events column to fill, e.g. stage_at")
    ap.add_argument("--date-format", default=None, help="strptime pattern for the outcome dates")
    ap.add_argument("--out", required=True)
    ap.add_argument("--unmatched", default=None, help="optional CSV for outcome rows that matched no one")
    args = ap.parse_args(argv)
    keys = [k.strip() for k in args.keys.split(",") if k.strip()]

    with open(args.offers, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        offers = list(reader)
        offer_cols = list(reader.fieldnames or [])
    with open(args.outcomes, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        outcomes = list(reader)
        outcome_cols = list(reader.fieldnames or [])
    for k in keys:
        if k not in offer_cols or k not in outcome_cols:
            sys.exit(f"key column '{k}' must exist in both files")
    if "subject_id" not in offer_cols:
        sys.exit("the offers file needs a subject_id column")
    if args.date_col not in outcome_cols:
        sys.exit(f"'{args.date_col}' not found in {args.outcomes}")

    index, collisions = {}, {}
    for k in keys:
        fn, seen = normaliser(k), {}
        for o in offers:
            v = fn(o.get(k))
            if v:
                seen.setdefault(v, set()).add(o["subject_id"])
        index[k] = {v: next(iter(ids)) for v, ids in seen.items() if len(ids) == 1}
        collisions[k] = sum(1 for ids in seen.values() if len(ids) > 1)

    by_key = {k: 0 for k in keys}
    first = {}
    unmatched, undated = [], []
    for row in outcomes:
        date = normalise_date(row.get(args.date_col), args.date_format)
        if not ISO.match(date):
            undated.append(row)
            continue
        sid = None
        for k in keys:
            v = normaliser(k)(row.get(k))
            if v and v in index[k]:
                sid = index[k][v]
                by_key[k] += 1
                break
        if sid is None:
            unmatched.append(row)
            continue
        if sid not in first or date < first[sid]:
            first[sid] = date

    if args.into not in offer_cols:
        offer_cols.append(args.into)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=offer_cols)
        w.writeheader()
        for o in offers:
            new = first.get(o["subject_id"])
            old = normalise_date(o.get(args.into), None)
            if new and (not ISO.match(old) or new < old):
                o[args.into] = new
            elif ISO.match(old):
                o[args.into] = old
            w.writerow(o)
    if args.unmatched and (unmatched or undated):
        with open(args.unmatched, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=outcome_cols + ["reason"])
            w.writeheader()
            w.writerows([dict(r, reason="no key matched") for r in unmatched] +
                        [dict(r, reason="no usable date") for r in undated])

    total = sum(by_key.values()) + len(unmatched)
    print(f"outcome rows with a date: {total}")
    print(f"matched: {total - len(unmatched)} ({(total - len(unmatched)) / total:.0%})" if total else "matched: 0")
    for k in keys:
        print(f"  via {k}: {by_key[k]}" + (f"  ({collisions[k]} shared {k} values ignored)" if collisions[k] else ""))
    print(f"unmatched: {len(unmatched)}" + (f" -> {args.unmatched}" if args.unmatched and unmatched else ""))
    if undated:
        print(f"rows without a usable {args.date_col}: {len(undated)} (not counted above; fix --date-format or the export)")
    print(f"subjects with {args.into} set: {len(first)}; wrote {args.out}")


if __name__ == "__main__":
    main(sys.argv[1:])
