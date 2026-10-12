#!/usr/bin/env python3
"""Fetch validated local calendar days without losing previously complete days."""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from data_utils import diagnostic, read_json, request_bytes, run, summary, write_json

API = "https://api.energidataservice.dk/dataset/DayAheadPrices"
AREAS = ("DK1", "DK2", "SE4")
COPENHAGEN = ZoneInfo("Europe/Copenhagen")
OUT = Path(__file__).resolve().parents[1] / "data" / "prices.json"
TIME_KEYS = ("TimeUTC", "HourUTC", "Minutes5UTC", "Minutes15UTC")
PRICE_KEYS = ("DayAheadPriceDKK", "SpotPriceDKK", "PriceDKK")


def first(record, keys):
    for key in keys:
        if record.get(key) not in (None, ""):
            return record[key]
    raise ValueError(f"Missing {keys} in price record")


def parse_utc(value):
    dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def day_slots(day):
    start = datetime.combine(day, datetime.min.time(), COPENHAGEN).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), COPENHAGEN).astimezone(timezone.utc)
    return {start + timedelta(minutes=15 * index) for index in range(int((end - start).total_seconds() // 900))}


def expected_quarters(day):
    return len(day_slots(day))


def fetch_records(now=None):
    now = now or datetime.now(COPENHAGEN)
    # EDS start/end are Danish local dates; end is exclusive, including on DST days.
    params = {
        "start": (now.date() - timedelta(days=1)).isoformat(),
        "end": (now.date() + timedelta(days=2)).isoformat(),
        "filter": json.dumps({"PriceArea": list(AREAS)}, separators=(",", ":")),
        "limit": "10000",
    }
    payload = json.loads(request_bytes(API + "?" + urllib.parse.urlencode(params)))
    records = payload.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("Energinet returned missing/empty records")
    if int(payload.get("total", len(records))) > len(records):
        raise ValueError("Energinet response is truncated; refusing incomplete data")
    return records


def group_rows(areas):
    groups = defaultdict(list)
    for area in AREAS:
        rows = areas.get(area, [])
        if not isinstance(rows, list):
            raise ValueError(f"{area}: expected an interval array")
        for row in rows:
            stamp = parse_utc(row["time_utc"])
            value = row["price_ore_kwh"]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{area}: invalid price at {stamp}")
            if stamp.minute % 15 or stamp.second or stamp.microsecond:
                raise ValueError(f"{area}: timestamp is not on the quarter-hour grid: {stamp}")
            groups[area, stamp.astimezone(COPENHAGEN).date()].append(row)
    return groups


def complete(rows, day):
    stamps = [parse_utc(row["time_utc"]) for row in rows]
    return len(stamps) == len(set(stamps)) and set(stamps) == day_slots(day)


def build_payload(records, existing=None, now=None):
    now = now or datetime.now(COPENHAGEN)
    areas = {area: [] for area in AREAS}
    seen = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Non-object price record")
        area = str(first(record, ("PriceArea",)))
        if area not in areas:
            raise ValueError(f"Unexpected price area {area}")
        stamp = parse_utc(first(record, TIME_KEYS))
        raw = first(record, PRICE_KEYS)
        price = float(raw)
        if isinstance(raw, bool) or not math.isfinite(price):
            raise ValueError(f"{area}: non-finite/invalid price at {stamp}")
        if (area, stamp) in seen:
            raise ValueError(f"{area}: duplicate interval at {stamp}")
        seen.add((area, stamp))
        areas[area].append({"time_utc": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "price_ore_kwh": round(price / 10, 4)})
        # Validate original timestamp before formatting can drop sub-seconds.
        if stamp.minute % 15 or stamp.second or stamp.microsecond:
            raise ValueError(f"{area}: off-grid interval at {stamp}")
    incoming = group_rows(areas)
    try:
        cached = group_rows(existing.get("areas", {})) if isinstance(existing, dict) else {}
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        diagnostic("warning", f"Cached price data failed validation: {exc}")
        cached = {}
    today = now.date()
    tomorrow = today + timedelta(days=1)
    merged = {area: [] for area in AREAS}
    for area in AREAS:
        for day in (today - timedelta(days=1), today, tomorrow):
            fresh = incoming.get((area, day), [])
            previous = cached.get((area, day), [])
            if complete(fresh, day):
                merged[area].extend(fresh)
            elif complete(previous, day):
                diagnostic("warning", f"{area} {day}: source has {len(fresh)}/{expected_quarters(day)}; retaining complete cached day")
                merged[area].extend(previous)
            elif fresh:
                diagnostic("warning", f"{area} {day}: rejecting incomplete day ({len(fresh)}/{expected_quarters(day)})")
        merged[area].sort(key=lambda row: row["time_utc"])
    counts = {}
    for day in (today, tomorrow):
        counts[day] = {area: sum(parse_utc(row["time_utc"]).astimezone(COPENHAGEN).date() == day
                                 for row in rows) for area, rows in merged.items()}
    return {
        "generated_at": now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Energinet Energi Data Service / DayAheadPrices", "unit": "ore_per_kwh", "areas": merged,
        "coverage": {
            "today_date": today.isoformat(), "today_expected_intervals": expected_quarters(today),
            "today_counts": counts[today],
            "today_complete": all(count == expected_quarters(today) for count in counts[today].values()),
            "tomorrow_date": tomorrow.isoformat(), "tomorrow_expected_intervals": expected_quarters(tomorrow),
            "tomorrow_counts": counts[tomorrow],
            "tomorrow_complete": all(count == expected_quarters(tomorrow) for count in counts[tomorrow].values()),
        },
    }


def update(attempts=1, poll_seconds=60, now=None):
    now = now or datetime.now(COPENHAGEN)
    payload = None
    cached = read_json(OUT)
    # Poll only during/after publication, avoiding retries every night for unpublished data.
    attempts = attempts if now.hour >= 13 else 1
    for attempt in range(attempts):
        try:
            payload = build_payload(fetch_records(now), payload or cached, now)
            if payload["coverage"]["today_complete"] and payload["coverage"]["tomorrow_complete"]:
                break
        except Exception as exc:
            diagnostic("warning", f"Price attempt {attempt + 1}/{attempts} failed: {exc}")
        if attempt < attempts - 1:
            time.sleep(poll_seconds)
    if payload is None:
        raise RuntimeError("All price requests failed validation or transport")
    coverage = payload["coverage"]
    summary(f"Spot prices: {coverage['tomorrow_date']} — {coverage['tomorrow_counts']} / {coverage['tomorrow_expected_intervals']} per area; today_complete={coverage['today_complete']}; tomorrow_complete={coverage['tomorrow_complete']}")
    if not coverage["today_complete"]:
        raise RuntimeError(f"Today's prices missing: {coverage['today_counts']}; refusing to replace prices.json")
    write_json(OUT, payload)
    if not coverage["tomorrow_complete"]:
        message = f"Tomorrow {coverage['tomorrow_date']} incomplete: {coverage['tomorrow_counts']}; expected {coverage['tomorrow_expected_intervals']} per area"
        if now.hour >= 15:
            diagnostic("error", message + "; publication deadline 15:00 Europe/Copenhagen exceeded")
            return 1
        diagnostic("warning", message + "; awaiting publication (deadline 15:00 Europe/Copenhagen)")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempts", type=int, choices=range(1, 6), default=1)
    parser.add_argument("--poll-seconds", type=int, choices=range(1, 301), default=60)
    args = parser.parse_args()
    return update(args.attempts, args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(run(main))
