const SOURCE = "https://api.energidataservice.dk/dataset/DayAheadPrices";
const AREAS = ["DK1", "DK2", "SE4"];
const HEADERS = {
  "Access-Control-Allow-Origin": "https://jakoblem.github.io",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60",
  "Content-Type": "application/json; charset=utf-8"
};

function localDate(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return p.year + "-" + p.month + "-" + p.day;
}

function nextDay(iso, days = 1) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function expectedIntervals(day) {
  // Denmark local midnights in UTC: DST-aware via searching hour offset.
  function utcMidnight(iso) {
    const guess = Date.parse(iso + "T00:00:00Z");
    for (let h = -3; h <= 3; h++) {
      const t = guess + h * 3600000;
      if (localDate(new Date(t)) === iso) {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
        }).formatToParts(new Date(t));
        const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
        if (p.hour === "00" && p.minute === "00") return t;
      }
    }
    throw new Error("Could not resolve local midnight " + iso);
  }
  return (utcMidnight(nextDay(day)) - utcMidnight(day)) / 900000;
}

async function fetchPrices() {
  const today = localDate(new Date());
  const tomorrow = nextDay(today);
  const params = new URLSearchParams({
    start: nextDay(today, -1),
    end: nextDay(today, 2),
    filter: JSON.stringify({ PriceArea: AREAS }),
    limit: "10000"
  });
  const response = await fetch(SOURCE + "?" + params, {
    headers: { Accept: "application/json", "User-Agent": "elpris-cloudflare-worker/1.0" }
  });
  if (!response.ok) throw new Error("Energinet HTTP " + response.status);
  const payload = await response.json();
  if (!Array.isArray(payload.records)) throw new Error("No records array");

  const areas = Object.fromEntries(AREAS.map(a => [a, []]));
  for (const row of payload.records) {
    const area = row.PriceArea;
    if (!AREAS.includes(area)) continue;
    const time = row.TimeUTC || row.HourUTC || row.Minutes15UTC;
    const price = row.DayAheadPriceDKK ?? row.SpotPriceDKK ?? row.PriceDKK;
    if (time == null || price == null) continue;
    const timestamp = Date.parse(String(time).endsWith("Z") ? time : time + "Z");
    const amount = Number(price);
    if (!Number.isFinite(timestamp) || !Number.isFinite(amount)) continue;
    areas[area].push({ time_utc: new Date(timestamp).toISOString().replace(".000Z", "Z"), price_ore_kwh: Math.round(amount / 10 * 10000) / 10000 });
  }
  for (const a of AREAS) areas[a].sort((x, y) => x.time_utc.localeCompare(y.time_utc));

  const expected = expectedIntervals(tomorrow);
  const counts = Object.fromEntries(AREAS.map(a => [a, areas[a].filter(r => localDate(new Date(r.time_utc)) === tomorrow).length]));
  return {
    generated_at: new Date().toISOString(),
    source: "Energinet Energi Data Service / DayAheadPrices",
    unit: "ore_per_kwh",
    areas,
    coverage: {
      tomorrow_date: tomorrow,
      tomorrow_expected_intervals: expected,
      tomorrow_counts: counts,
      tomorrow_complete: AREAS.every(a => counts[a] === expected)
    }
  };
}

async function refresh(env) {
  const result = await fetchPrices();
  const previous = await env.ELPRIS_KV.get("prices", "json");
  const changed = !previous || JSON.stringify(previous.areas) !== JSON.stringify(result.areas)
    || JSON.stringify(previous.coverage) !== JSON.stringify(result.coverage);
  if (changed) await env.ELPRIS_KV.put("prices", JSON.stringify(result));
  return { changed, complete: result.coverage.tomorrow_complete, counts: result.coverage.tomorrow_counts };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: HEADERS });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/health") {
      const current = await env.ELPRIS_KV.get("prices", "json");
      return new Response(JSON.stringify({ ok: Boolean(current), updated: current?.generated_at ?? null, coverage: current?.coverage ?? null }), { headers: HEADERS });
    }
    if (url.pathname !== "/prices.json") return new Response("Not found", { status: 404 });
    const value = await env.ELPRIS_KV.get("prices");
    if (!value) return new Response(JSON.stringify({ error: "Prices not fetched yet" }), { status: 503, headers: HEADERS });
    return new Response(value, { headers: HEADERS });
  }
};
