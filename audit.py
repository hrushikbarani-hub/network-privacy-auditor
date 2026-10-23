"""Quiet Hours: aggregate locally; emit no domains, device IDs or event rows."""

import argparse
import csv
import json
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

BLOCKED = {1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 18}
ALLOWED = {2, 3, 12, 13, 14, 17}


def parse_time(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Missing timezone.")
    return parsed.astimezone(timezone.utc)


def aggregate(rows, now=None, days=7, source="csv"):
    now = now or datetime.now(timezone.utc)
    if not 1 <= days <= 30:
        raise ValueError("Use retention between 1 and 30 days.")
    # Keep only whole UTC dates inside the retention window.
    cutoff = (now - timedelta(days=days - 1)).date()
    buckets = {}
    skipped = 0
    for index, row in enumerate(rows):
        if index >= 100000:
            raise ValueError(
                "Import limit is 100,000 rows. Split the source into smaller windows."
            )
        try:
            when = parse_time(row.get("time"))
            outcome = row.get("outcome")
            if outcome not in {"blocked", "allowed", "unknown"}:
                raise ValueError()
            if when > now or when.date() < cutoff:
                skipped += 1
                continue
            day = when.date().isoformat()
            bucket = buckets.setdefault(
                day,
                {
                    "date": day,
                    "blocked": 0,
                    "allowed": 0,
                    "unknown": 0,
                    "devices": set(),
                },
            )
            bucket[outcome] += 1
            device = str(row.get("device", "")).strip()
            if device:
                bucket["devices"].add(device)
        except (ValueError, TypeError, OverflowError):
            raise ValueError(
                f"Invalid time or outcome at data row {index + 1}."
            ) from None
    daily = []
    for key in sorted(buckets):
        row = buckets[key]
        row["unique_devices"] = len(row.pop("devices"))
        daily.append(row)
    return {
        "schema": 1,
        "created_at": now.isoformat().replace("+00:00", "Z"),
        "retention_days": days,
        "source": source,
        "daily": daily,
        "skipped": skipped,
    }


def csv_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames or not {"time", "device", "outcome"}.issubset(
            reader.fieldnames
        ):
            raise ValueError("CSV needs time, device and outcome headers.")
        yield from reader


def pihole_rows(path, now, days):
    source = Path(path).resolve()
    if not source.is_file():
        raise ValueError("The source database does not exist.")
    cutoff = datetime.combine(
        (now - timedelta(days=days - 1)).date(),
        datetime.min.time(),
        tzinfo=timezone.utc,
    ).timestamp()
    try:
        with closing(
            sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=3)
        ) as db:
            db.execute("PRAGMA query_only=ON")
            db.execute("PRAGMA trusted_schema=OFF")
            # Deliberately exclude domain and additional_info from the projection.
            for timestamp, status, client in db.execute(
                "SELECT timestamp,status,client FROM queries WHERE timestamp>=? AND timestamp<=? ORDER BY timestamp LIMIT 100001",
                (cutoff, now.timestamp()),
            ):
                yield {
                    "time": timestamp,
                    "device": client,
                    "outcome": "blocked"
                    if status in BLOCKED
                    else "allowed"
                    if status in ALLOWED
                    else "unknown",
                }
    except sqlite3.Error:
        raise ValueError(
            "Cannot read the expected Pi-hole queries view. Use a compatible backup or the CSV adapter."
        ) from None


def main():
    parser = argparse.ArgumentParser(
        description="Print aggregate-only DNS blocking statistics. Original inputs are untouched."
    )
    parser.add_argument("source", help="Local CSV or Pi-hole database backup")
    parser.add_argument(
        "--pihole",
        action="store_true",
        help="Read a compatible Pi-hole queries view in read-only mode",
    )
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    try:
        rows = (
            pihole_rows(args.source, now, args.days)
            if args.pihole
            else csv_rows(args.source)
        )
        report = aggregate(rows, now, args.days, "pihole" if args.pihole else "csv")
        print(json.dumps(report, indent=2))
    except (ValueError, OSError, csv.Error) as error:
        print(
            str(error)
            if isinstance(error, ValueError)
            else "Unable to read the local input file.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
