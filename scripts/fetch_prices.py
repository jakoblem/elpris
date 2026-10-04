#!/usr/bin/env python3
"""Fetch day-ahead prices from Energinet and write a compact JSON file for the site."""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://api.energidataservice.dk/dataset/DayAheadPrices"
AREAS = ("DK1", "DK2", "SE4")
COPENHAGEN = ZoneInfo("Europe/Copenhagen")
OUT = Path(__file__).resolve().parents[1] / "data" / "prices.json"

TIME_KEYS = ("TimeUTC", "HourUTC", "Minutes5UTC", "Minutes15UTC")
PRICE_KEYS = ("DayAheadPriceDKK", "SpotPriceDKK", "PriceDKK")
AREA_KEYS = ("PriceArea",)


def first(record, keys):
    for key in keys:
        if key in record and record[key] not in (None, ""):
            return record[key]
    raise KeyError(f"None of {keys} found in record keys: {sorted(record)}")


def parse_utc(value: str) -> datetime:
    value = str(value).strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def expected_quarters(local_date) -> int:
    start = datetime.combine(local_date, datetime.min.time(), tzinfo=COPENHAGEN)
    end = datetime.combine(local_date + timedelta(days=1), datetime.min.time(), tzinfo=COPENHAGEN)
    return int((end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() // 900)


def fetch_records() -> list[dict]:
    now_local = datetime.now(COPENHAGEN)
    start = (now_local.date() - timedelta(days=1)).isoformat()
    end = (now_local.date() + timedelta(days=2)).isoformat()

    params = {
        "start": start,
        "end": end,
        "filter": json.dumps({"PriceArea": list(AREAS)}, separators=(",", ":")),
        "limit": "10000",
    }
    url = API + "?" + urllib.parse.urlencode(params)

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "elpris-github-pages/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.load(response)

    records = payload.get("records")
    if not isinstance(records, list):
        raise RuntimeError("Energinet API response did not contain a records array")
    return records


def build_payload(records: list[dict]) -> dict:
    areas: dict[str, list[dict]] = {area: [] for area in AREAS}

    for record in records:
        try:
            area = str(first(record, AREA_KEYS))
            if area not in areas:
                continue
            dt_utc = parse_utc(first(record, TIME_KEYS))
            dkk_mwh = float(first(record, PRICE_KEYS))
        except (KeyError, TypeError, ValueError) as exc:
            print(f"Skipping unexpected record: {exc}", file=sys.stderr)
            continue

        areas[area].append(
            {
                "time_utc": dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "price_ore_kwh": round(dkk_mwh / 10.0, 4),
            }
        )

    for rows in areas.values():
        rows.sort(key=lambda row: row["time_utc"])

    now_local = datetime.now(COPENHAGEN)
    tomorrow = now_local.date() + timedelta(days=1)
    expected = expected_quarters(tomorrow)

    tomorrow_counts = {}
    for area, rows in areas.items():
        count = 0
        for row in rows:
            local = parse_utc(row["time_utc"]).astimezone(COPENHAGEN)
            if local.date() == tomorrow:
                count += 1
        tomorrow_counts[area] = count

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Energinet Energi Data Service / DayAheadPrices",
        "unit": "ore_per_kwh",
        "areas": areas,
        "coverage": {
            "tomorrow_date": tomorrow.isoformat(),
            "tomorrow_expected_intervals": expected,
            "tomorrow_counts": tomorrow_counts,
            "tomorrow_complete": all(tomorrow_counts.get(area, 0) >= expected for area in AREAS),
        },
    }


def normalized_without_timestamp(payload: dict) -> dict:
    clone = dict(payload)
    clone.pop("generated_at", None)
    return clone


def main() -> int:
    records = fetch_records()
    payload = build_payload(records)

    OUT.parent.mkdir(parents=True, exist_ok=True)

    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text(encoding="utf-8"))
            if normalized_without_timestamp(existing) == normalized_without_timestamp(payload):
                print("No new price data; leaving prices.json unchanged.")
                return 0
        except (json.JSONDecodeError, OSError):
            pass

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = {area: len(rows) for area, rows in payload["areas"].items()}
    print(f"Wrote {OUT}: {counts}; tomorrow_complete={payload['coverage']['tomorrow_complete']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
