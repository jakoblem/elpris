#!/usr/bin/env python3
"""Build household grid-tariff profiles from Energinet DatahubPricelist.

The output is intentionally compact and browser-friendly. Prices are stored
excluding VAT in øre/kWh; the web app applies VAT together with the other
variable charges.
"""

from __future__ import annotations

import json
import re
import statistics
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://api.energidataservice.dk/dataset/DatahubPricelist"
OUT = Path(__file__).resolve().parents[1] / "data" / "tariffs.json"
COPENHAGEN = ZoneInfo("Europe/Copenhagen")

# A deliberately broad set of common Danish distribution companies.
# Several companies have multiple ChargeOwner suffixes/legacy grid areas;
# those are combined into one profile by taking the hourly median.
COMPANIES = [
    {"id": "n1", "name": "N1", "prefixes": ["N1 A/S"]},
    {"id": "radius", "name": "Radius", "prefixes": ["Radius Elnet A/S"]},
    {"id": "cerius", "name": "Cerius", "prefixes": ["Cerius A/S"]},
    {"id": "konstant", "name": "Konstant", "prefixes": ["Konstant Net A/S"]},
    {"id": "vores-elnet", "name": "Vores Elnet", "prefixes": ["Vores Elnet A/S"]},
    {"id": "trefor", "name": "TREFOR El-net", "prefixes": ["TREFOR El-net A/S", "Trefor El-Net A/S"]},
    {"id": "dinel", "name": "Dinel", "prefixes": ["Dinel A/S"]},
    {"id": "nord-energi", "name": "Nord Energi Net", "prefixes": ["Nord Energi Net A/S"]},
    {"id": "rah", "name": "RAH Net", "prefixes": ["RAH Net A/S"]},
    {"id": "noe", "name": "NOE Net", "prefixes": ["NOE Net A/S"]},
    {"id": "flow", "name": "FLOW Elnet", "prefixes": ["FLOW Elnet A/S", "Flow Elnet A/S"]},
    {"id": "elnet-midt", "name": "Elnet Midt", "prefixes": ["Elnet Midt A/S"]},
    {"id": "elvaerk", "name": "Netselskabet Elværk", "prefixes": ["Netselskabet Elværk A/S"]},
    {"id": "zeanet", "name": "Zeanet", "prefixes": ["Zeanet A/S"]},
    {"id": "ravdex", "name": "Ravdex", "prefixes": ["Ravdex A/S"]},
    {"id": "elinord", "name": "Elinord", "prefixes": ["Elinord A/S"]},
    {"id": "elektrus", "name": "Elektrus", "prefixes": ["Elektrus A/S"]},
    {"id": "forsyning-elnet", "name": "Forsyning Elnet", "prefixes": ["Forsyning Elnet A/S"]},
]

EXCLUDE_WORDS = (
    "rabat",
    "produktion",
    "egenproducent",
    "indfødning",
    "indfoedning",
    "levering",
    "reaktiv",
)


def parse_local(value: str | None):
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        dt = datetime.fromisoformat(text[:-1] + "+00:00")
        return dt.astimezone(COPENHAGEN)
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=COPENHAGEN)
    return dt.astimezone(COPENHAGEN)


def is_current(record: dict, now: datetime) -> bool:
    start = parse_local(record.get("ValidFrom"))
    end = parse_local(record.get("ValidTo"))
    return bool(start and start <= now and (end is None or now < end))


def owner_matches(owner: str, prefixes: list[str]) -> bool:
    low = owner.casefold().strip()
    return any(low.startswith(prefix.casefold()) for prefix in prefixes)


def candidate_score(record: dict) -> int:
    note = str(record.get("Note") or "").strip().casefold()
    description = str(record.get("Description") or "").strip().casefold()
    text = note + " " + description

    if "nettarif" not in text:
        return -10_000
    if any(word in text for word in EXCLUDE_WORDS):
        return -10_000

    # Household consumers are normally C-customers.
    if not re.search(r"\bc(?:-|\s|$)", note) and " c " not in f" {note} ":
        return -5_000

    score = 0
    if note == "nettarif c":
        score += 1000
    if "nettarif c" in note:
        score += 500
    if "time" in note or "flex" in note:
        score += 30
    if str(record.get("ResolutionDuration") or "") in {"PT1H", "P1D"}:
        score += 10

    start = parse_local(record.get("ValidFrom"))
    if start:
        score += min(50, max(0, (start.year - 2020) * 5))

    return score


def hourly_prices(record: dict) -> list[float] | None:
    values = []
    for hour in range(1, 25):
        raw = record.get(f"Price{hour}")
        values.append(None if raw in (None, "") else float(raw) * 100.0)

    populated = [v for v in values if v is not None]
    if not populated:
        return None

    if len(populated) == 1:
        return [round(populated[0], 4)] * 24

    if len(populated) == 24:
        return [round(v, 4) for v in values]

    # Some price lists store a value until the next changed hour. Carry forward
    # only when Price1 exists; otherwise the row is too ambiguous to use.
    if values[0] is None:
        return None

    out = []
    last = values[0]
    for value in values:
        if value is not None:
            last = value
        out.append(round(last, 4))
    return out


def fetch_records() -> list[dict]:
    params = {
        "start": "StartOfYear-P1Y",
        "end": "StartOfYear+P2Y",
        "filter": json.dumps({"ChargeType": ["D03"]}, separators=(",", ":")),
        "sort": "ValidFrom DESC",
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
    with urllib.request.urlopen(req, timeout=45) as response:
        payload = json.load(response)

    records = payload.get("records")
    if not isinstance(records, list):
        raise RuntimeError("Energinet API response did not contain a records array")
    return records


def profile_for_company(records: list[dict], company: dict, now: datetime):
    by_period = {}
    for record in records:
        owner = str(record.get("ChargeOwner") or "").strip()
        if not owner or not owner_matches(owner, company["prefixes"]):
            continue
        score = candidate_score(record)
        if score < 0 or hourly_prices(record) is None:
            continue
        vf = parse_local(record.get("ValidFrom"))
        if not vf:
            continue
        key = (owner, vf.isoformat())
        current = by_period.get(key)
        if current is None or score > current[0]:
            by_period[key] = (score, record)

    rows = [entry[1] for entry in by_period.values()]
    if not rows:
        return None

    windows = {}
    for record in rows:
        owner = str(record.get("ChargeOwner") or "").strip()
        vf = parse_local(record.get("ValidFrom"))
        vt = parse_local(record.get("ValidTo"))
        key = (vf.isoformat(), vt.isoformat() if vt else None)
        windows.setdefault(key, []).append((owner, hourly_prices(record)))

    periods = []
    for (valid_from, valid_to), group in windows.items():
        hourly = [round(statistics.median(item[1][hour] for item in group), 4) for hour in range(24)]
        periods.append({
            "valid_from": valid_from,
            "valid_to": valid_to,
            "hourly_ex_vat_ore": hourly,
            "charge_owners": sorted({item[0] for item in group}),
        })
    periods.sort(key=lambda p: p["valid_from"])

    current_period = None
    for period in periods:
        vf = parse_local(period["valid_from"])
        vt = parse_local(period["valid_to"])
        if vf <= now and (vt is None or now < vt):
            current_period = period
    if current_period is None:
        current_period = periods[-1]

    return {
        "id": company["id"],
        "name": company["name"],
        "hourly_ex_vat_ore": current_period["hourly_ex_vat_ore"],
        "charge_owners": current_period["charge_owners"],
        "valid_from": current_period["valid_from"],
        "valid_to": current_period["valid_to"],
        "periods": periods,
    }


def main() -> int:
    now = datetime.now(COPENHAGEN)
    records = fetch_records()
    profiles = []

    for company in COMPANIES:
        profile = profile_for_company(records, company, now)
        if profile:
            profiles.append(profile)
        else:
            print(f"No current household tariff found for {company['name']}", file=sys.stderr)

    if not profiles:
        raise RuntimeError("No household grid tariff profiles could be extracted")

    median_hourly = [
        round(statistics.median(profile["hourly_ex_vat_ore"][hour] for profile in profiles), 4)
        for hour in range(24)
    ]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Energinet Energi Data Service / DatahubPricelist",
        "unit": "ore_per_kwh_ex_vat",
        "method": "Unweighted hourly median across available selected grid companies",
        "selected_company_count": len(COMPANIES),
        "available_company_count": len(profiles),
        "default_profile": {
            "id": "median",
            "name": f"Standard – median af {len(profiles)} netselskaber",
            "hourly_ex_vat_ore": median_hourly,
        },
        "profiles": profiles,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)

    # Avoid needless commits when only the fetch timestamp changed.
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
            old_cmp = dict(old)
            new_cmp = dict(payload)
            old_cmp.pop("generated_at", None)
            new_cmp.pop("generated_at", None)
            if old_cmp == new_cmp:
                print("No tariff changes; leaving tariffs.json unchanged.")
                return 0
        except (json.JSONDecodeError, OSError):
            pass

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} with {len(profiles)} company profiles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
