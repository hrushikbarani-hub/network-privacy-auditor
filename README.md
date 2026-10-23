# Quiet Hours: Local Network Privacy Auditor

Review DNS blocking without saving a browsing history. [Open the browser app](https://hrushikbarani-hub.github.io/network-privacy-auditor/).

Import a small CSV locally or generate an aggregate report from a Pi-hole database backup. The browser saves only daily counts and per-day distinct-device counts. There are no file uploads, accounts, external analytics, raw event records, domains or saved device identifiers.

## Browser use

CSV headers are `time,device,outcome`. Time must be ISO 8601 with `Z` or an explicit timezone. Outcome is `blocked`, `allowed` or `unknown`. Extra columns are ignored. Files are limited to 5 MB and 100,000 rows.

The report shows daily blocked/allowed/unknown counts and blocked share among known outcomes. Device counts apply to one date bucket within one import; do not add them across dates or files. Imports remain separate. Exact file fingerprints prevent accidentally importing the same bytes twice. Overlapping exports with different bytes are not automatically deduplicated.

Choose 1, 7 or 30 UTC dates of retention. Old aggregate buckets are removed on load, import and settings changes. Export aggregate JSON or remove reports at any time. Original source files remain untouched. Clearing browser site data removes the saved aggregates. Blocked or full storage is reported; export before leaving a temporary session.

## Python CLI

Python 3.12+ is enough; the CLI uses only the standard library.

```powershell
python audit.py queries.csv --days 7
python audit.py backup.db --pihole --days 7
```

The program prints aggregate JSON to stdout. Save that output and import the JSON into the browser app. The source is never changed. Errors identify row numbers without echoing raw input values. Use a database backup you are authorized to read; this tool does not discover devices or retrieve a database from the network.

The Pi-hole adapter opens a compatible `queries` view in read-only mode and selects only `timestamp,status,client`. It does not select domain or additional-info fields. Documented status codes are grouped into blocked and allowed; other codes remain unknown. The adapter follows [Pi-hole's query database documentation](https://docs.pi-hole.net/database/query-database/). A different schema should use the CSV adapter rather than guessing at fields.

Raw device values exist temporarily in memory to compute a per-day distinct count. They are not emitted or persisted. This is data minimization, not a claim that memory or the source file is securely erased. Aggregates can still reveal activity patterns, so keep exports private unless you intend to share them. Blocked share does not measure all tracking prevented or all ads removed.

## Development

```powershell
npm ci
npm run check
python -m unittest discover -s tests -p "test_*.py" -v
python -m http.server 8145 --bind 127.0.0.1 --directory web
```

Open `http://127.0.0.1:8145`. Node.js 22+ is required only for development checks. Tests cover read-only database input, omitted private fields, retention, invalid-row errors, quoted CSV and the actual browser sample flow. Visual browser QA was unavailable during this release.

The GitHub Actions workflow checks the code and publishes only `web` to free GitHub Pages. Built by [hirsu](https://hrushikbarani-hub.github.io/) from the Raspberry Pi homelab idea.
