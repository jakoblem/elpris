#!/usr/bin/env python3
"""Fetch Nationalbank's documented XML reference rate (DKK per 100 SEK)."""
import math
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from data_utils import read_json, request_bytes, run, summary, write_json

URL = "https://www.nationalbanken.dk/api/currencyratesxml?lang=da"
OUT = Path(__file__).resolve().parents[1] / "data" / "fx.json"
COPENHAGEN = ZoneInfo("Europe/Copenhagen")


def build_payload(content, now=None):
    now = now or datetime.now(COPENHAGEN)
    root = ET.fromstring(content)
    if root.tag != "exchangerates" or root.get("refcur") != "DKK" or root.get("refamt") != "1":
        raise ValueError("Unexpected Nationalbank XML schema/reference currency")
    candidates = []
    for daily in root.findall("dailyrates"):
        rate_date = date.fromisoformat(daily.attrib["id"])
        currencies = daily.findall("currency[@code='SEK']")
        if len(currencies) != 1:
            raise ValueError(f"{rate_date}: expected exactly one SEK rate")
        rate100 = float(currencies[0].attrib["rate"].replace(",", "."))
        if not math.isfinite(rate100) or not 40 < rate100 < 100:
            raise ValueError(f"Implausible SEK rate per 100 units: {rate100}")
        candidates.append((rate_date, rate100))
    if not candidates:
        raise ValueError("No dated SEK rate in Nationalbank XML")
    rate_date, rate100 = max(candidates)
    age = (now.date() - rate_date).days
    if not 0 <= age <= 7:
        raise ValueError(f"SEK reference date {rate_date} is future-dated or more than 7 days old")
    return {
        "generated_at": now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Danmarks Nationalbank", "source_url": URL, "rate_date": rate_date.isoformat(),
        "sek_dkk": round(rate100 / 100, 6), "quoted_as": "DKK per SEK", "indicative": True,
    }


def main():
    payload = build_payload(request_bytes(URL))
    old = read_json(OUT)
    if isinstance(old, dict) and old.get("rate_date") and old["rate_date"] > payload["rate_date"]:
        raise ValueError(f"Source rate date regressed from {old['rate_date']} to {payload['rate_date']}")
    changed = write_json(OUT, payload)
    summary(f"SEK/DKK: {payload['sek_dkk']} (reference date {payload['rate_date']}; {'updated' if changed else 'unchanged'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(run(main))
