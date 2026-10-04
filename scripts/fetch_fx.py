#!/usr/bin/env python3
"""Fetch latest published SEK/DKK indicative reference rate from Danmarks Nationalbank."""
import json, re, urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL="https://www.nationalbanken.dk/da/vores-arbejde/stabile-priser-pengepolitik-og-dansk-oekonomi/valutakurser"
OUT=Path(__file__).resolve().parents[1]/"data"/"fx.json"

def main():
    req=urllib.request.Request(URL,headers={"User-Agent":"elpris-github-pages/1.0","Accept-Language":"da"})
    with urllib.request.urlopen(req,timeout=30) as response:
        html=response.read().decode("utf-8","replace")
    # Page renders a table row containing Svenske kroner, SEK and a DKK price per 100 SEK.
    patterns=[
        r"Svenske kroner.{0,1000}?SEK.{0,1000}?([0-9]{2}[,.][0-9]{2,4})",
        r"Swedish kronor.{0,1000}?SEK.{0,1000}?([0-9]{2}[,.][0-9]{2,4})",
    ]
    rate100=None
    for pattern in patterns:
        m=re.search(pattern,html,re.I|re.S)
        if m:
            rate100=float(m.group(1).replace(",","."))
            break
    if rate100 is None or not (40 < rate100 < 100):
        raise RuntimeError("Could not extract SEK reference rate from Nationalbanken")
    payload={
      "generated_at":datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
      "source":"Danmarks Nationalbank",
      "sek_dkk":round(rate100/100,6),
      "quoted_as":"DKK per SEK",
      "indicative":True
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    if OUT.exists():
        try:
            old=json.loads(OUT.read_text(encoding="utf-8"))
            if old.get("sek_dkk")==payload["sek_dkk"]:
                print("FX unchanged")
                return
        except Exception:
            pass
    OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("SEK/DKK",payload["sek_dkk"])
if __name__=="__main__": main()
