import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from audit import aggregate, pihole_rows, csv_rows

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)


class AuditTests(unittest.TestCase):
    def test_output_has_only_counts_and_no_private_fields(self):
        raw = [
            {
                "time": "2026-10-23T10:00:00Z",
                "device": "secret-laptop",
                "domain": "private.example",
                "outcome": "blocked",
            },
            {
                "time": "2026-10-23T11:00:00Z",
                "device": "secret-laptop",
                "outcome": "allowed",
            },
        ]
        report = aggregate(raw, NOW)
        text = json.dumps(report)
        self.assertNotIn("secret-laptop", text)
        self.assertNotIn("private.example", text)
        self.assertNotIn("domain", text)
        self.assertEqual(report["daily"][0]["unique_devices"], 1)

    def test_retention_ignores_old_and_future_rows(self):
        report = aggregate(
            [
                {"time": t, "device": "x", "outcome": "blocked"}
                for t in [
                    "2026-09-01T00:00:00Z",
                    "2026-10-24T00:00:00Z",
                    "2026-10-23T11:00:00Z",
                ]
            ],
            NOW,
            1,
        )
        self.assertEqual(report["skipped"], 2)
        self.assertEqual(report["daily"][0]["blocked"], 1)

    def test_invalid_row_error_never_echoes_private_value(self):
        with self.assertRaisesRegex(ValueError, "data row 1") as error:
            aggregate([{"time": "secret-private-value", "outcome": "blocked"}], NOW)
        self.assertNotIn("secret-private-value", str(error.exception))

    def test_sqlite_source_is_read_only_and_unknown_status_is_separate(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sample.db"
            db = sqlite3.connect(path)
            db.execute(
                "CREATE TABLE queries(timestamp REAL,status INTEGER,client TEXT,domain TEXT)"
            )
            db.executemany(
                "INSERT INTO queries VALUES(?,?,?,?)",
                [
                    (NOW.timestamp() - 100, 1, "private-ip", "private-domain"),
                    (NOW.timestamp() - 50, 999, "private-ip", "private-domain"),
                ],
            )
            db.commit()
            db.close()
            before = path.read_bytes()
            report = aggregate(pihole_rows(path, NOW, 7), NOW, 7, "pihole")
            self.assertEqual(report["daily"][0]["unknown"], 1)
            self.assertEqual(path.read_bytes(), before)
            self.assertNotIn("private-", json.dumps(report))

    def test_csv_supports_extra_columns_without_outputting_them(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sample.csv"
            path.write_text(
                'time,device,outcome,domain\n2026-10-23T10:00:00Z,"sample, device",allowed,private.example\n',
                encoding="utf-8",
            )
            self.assertEqual(aggregate(csv_rows(path), NOW)["daily"][0]["allowed"], 1)


if __name__ == "__main__":
    unittest.main()
