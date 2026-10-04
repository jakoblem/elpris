const DEFAULT_TARIFF = {
  configured: true,
  profileId: "median",
  hourly: null,
  national: 12.3,
  offpeak: 0,
  standard: 0,
  peak: 0,
  supplier: 0,
  vat: 25
};

const SE4_DEFAULT = {
  energyTaxSekOre: 36.0,
  gridSekOre: 30.0,
  supplierSekOre: 5.0,
  vat: 25,
  dkkPerSek: 0.6636
};

const storedTotal = localStorage.getItem("elpris-total");

const state = {
  area: localStorage.getItem("elpris-area") || "DK2",
  resolution: localStorage.getItem("elpris-resolution") || "1h",
  view: localStorage.getItem("elpris-view") || "table",
  includeTotal: storedTotal === null ? true : storedTotal === "true",
  data: null,
  tariffData: null,
  tariff: loadTariff()
};

const els = {
  status: document.getElementById("status"),
  browserHint: document.getElementById("browserHint"),
  browserHintText: document.getElementById("browserHintText"),
  dismissBrowserHint: document.getElementById("dismissBrowserHint"),
  installHelpText: document.getElementById("installHelpText"),
  installButton: document.getElementById("installButton"),
  areaControl: document.getElementById("areaControl"),
  resolutionControl: document.getElementById("resolutionControl"),
  viewControl: document.getElementById("viewControl"),
  totalToggle: document.getElementById("totalToggle"),
  settingsButton: document.getElementById("settingsButton"),
  totalHelp: document.getElementById("totalHelp"),
  quickGridProfile: document.getElementById("quickGridProfile"),
  quickGridSelect: document.getElementById("quickGridSelect"),
  postcodeWrap: document.getElementById("postcodeWrap"),
  postcodeInput: document.getElementById("postcodeInput"),
  postcodeLabel: document.getElementById("postcodeLabel"),
  postcodeHint: document.getElementById("postcodeHint"),
  minPrice: document.getElementById("minPrice"),
  minTime: document.getElementById("minTime"),
  avgPrice: document.getElementById("avgPrice"),
  periodCount: document.getElementById("periodCount"),
  maxPrice: document.getElementById("maxPrice"),
  maxTime: document.getElementById("maxTime"),
  contentSubtitle: document.getElementById("contentSubtitle"),
  coverageBadge: document.getElementById("coverageBadge"),
  graphView: document.getElementById("graphView"),
  graphWrap: document.getElementById("graphWrap"),
  tableView: document.getElementById("tableView"),
  tableBody: document.getElementById("priceTableBody"),
  emptyState: document.getElementById("emptyState"),
  settingsDialog: document.getElementById("settingsDialog"),
  closeSettings: document.getElementById("closeSettings"),
  tariffForm: document.getElementById("tariffForm"),
  resetTariffs: document.getElementById("resetTariffs"),
  gridProfile: document.getElementById("gridProfile"),
  tariffNote: document.getElementById("tariffNote"),
  nationalCharge: document.getElementById("nationalCharge"),
  offpeakCharge: document.getElementById("offpeakCharge"),
  standardCharge: document.getElementById("standardCharge"),
  peakCharge: document.getElementById("peakCharge"),
  supplierCharge: document.getElementById("supplierCharge"),
  vatRate: document.getElementById("vatRate")
};

function loadTariff() {
  try {
    const raw = localStorage.getItem("elpris-tariff");
    if (!raw) return Object.assign({}, DEFAULT_TARIFF);
    const parsed = Object.assign({}, DEFAULT_TARIFF, JSON.parse(raw));
    if (!parsed.profileId) parsed.profileId = "custom";
    return parsed;
  } catch {
    return Object.assign({}, DEFAULT_TARIFF);
  }
}

function saveTariff(tariff) {
  state.tariff = tariff;
  localStorage.setItem("elpris-tariff", JSON.stringify(tariff));
}

function postcodeKey(area) {
  return "elpris-postcode-" + area.toLowerCase();
}

function loadAreaPostcode(area) {
  return localStorage.getItem(postcodeKey(area)) || "";
}

function postcodeLabelForArea(area) {
  return area === "DK1" ? "Postnummer DK1 (vest)" : area === "DK2" ? "Postnummer DK2 (øst)" : "Postnummer SE4 (syd)";
}

function updatePostcodeUi() {
  els.postcodeLabel.textContent = postcodeLabelForArea(state.area);
  els.postcodeInput.value = loadAreaPostcode(state.area);
  els.postcodeInput.placeholder = state.area === "SE4" ? "fx 211 20" : "fx 2100";
  els.postcodeHint.textContent = state.area === "SE4"
    ? "Gemmes kun i denne browser for SE4."
    : "Gemmes kun i denne browser for " + state.area + ". Netselskabet kan altid vælges manuelt.";
}

function suggestGridFromPostcode() {
  if (state.area === "SE4" || !state.tariffData) return;
  const digits = (els.postcodeInput.value || "").replace(/\D/g, "");
  if (digits.length !== 4) return;

  // Conservative suggestions only for broad, well-known areas. The selector
  // remains user-overridable because grid boundaries do not perfectly follow postcodes.
  const n = Number(digits);
  let profileId = null;
  if (state.area === "DK2" && n >= 1000 && n <= 2999) profileId = "radius";

  if (profileId && allGridProfiles().some(function (p) { return p.id === profileId; })) {
    applyGridProfile(profileId);
    saveTariff(state.tariff);
    populateGridProfiles();
    fillTariffForm();
    render();
  }
}

function setActiveButtons(container, key, value) {
  container.querySelectorAll("button").forEach(function (button) {
    button.classList.toggle("active", button.dataset[key] === value);
  });
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "–";
  return Math.round(value).toLocaleString("da-DK") + " øre";
}

function formatClock(epochMs) {
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(epochMs));
}

function formatDay(epochMs) {
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date(epochMs));
}

function formatUpdated(iso) {
  if (!iso) return "Ukendt opdateringstid";
  return "Opdateret " + new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function localHour(epochMs) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(new Date(epochMs)));
}

function tariffForEpoch(epochMs) {
  const hour = localHour(epochMs);

  if (state.tariff.profileId && state.tariff.profileId !== "custom") {
    const profile = allGridProfiles().find(function (item) { return item.id === state.tariff.profileId; });
    if (profile && Array.isArray(profile.periods)) {
      const match = profile.periods.find(function (period) {
        const from = Date.parse(period.valid_from);
        const to = period.valid_to ? Date.parse(period.valid_to) : Infinity;
        return epochMs >= from && epochMs < to;
      });
      if (match && Array.isArray(match.hourly_ex_vat_ore)) {
        return Number(match.hourly_ex_vat_ore[hour] || 0);
      }
    }
  }

  if (Array.isArray(state.tariff.hourly) && state.tariff.hourly.length === 24) {
    return Number(state.tariff.hourly[hour] || 0);
  }

  if (hour < 6) return state.tariff.offpeak;
  if (hour < 17) return state.tariff.standard;
  if (hour < 21) return state.tariff.peak;
  return state.tariff.standard;
}

function displayedPrice(item) {
  if (!state.includeTotal) return item.price;
  if (state.area === "SE4") {
    const swedishChargesDkkOre = (
      SE4_DEFAULT.energyTaxSekOre
      + SE4_DEFAULT.gridSekOre
      + SE4_DEFAULT.supplierSekOre
    ) * Number((state.fx && state.fx.sek_dkk) || SE4_DEFAULT.dkkPerSek);
    const beforeVatSe4 = item.price + swedishChargesDkkOre;
    return beforeVatSe4 * (1 + SE4_DEFAULT.vat / 100);
  }
  const beforeVat = item.price
    + Number(state.tariff.national || 0)
    + Number(tariffForEpoch(item.start) || 0)
    + Number(state.tariff.supplier || 0);
  return beforeVat * (1 + Number(state.tariff.vat || 0) / 100);
}

function rawItems() {
  if (!state.data || !state.data.areas || !state.data.areas[state.area]) return [];

  const now = Date.now();
  const horizon = now + 24 * 60 * 60 * 1000;

  return state.data.areas[state.area]
    .map(function (row) {
      const start = Date.parse(row.time_utc.endsWith("Z") ? row.time_utc : row.time_utc + "Z");
      return {
        start: start,
        end: start + 15 * 60 * 1000,
        price: Number(row.price_ore_kwh),
        rows: 1
      };
    })
    .filter(function (item) {
      return item.end > now && item.start < horizon && Number.isFinite(item.price);
    })
    .sort(function (a, b) { return a.start - b.start; });
}

function hourlyItems(items) {
  const buckets = new Map();

  items.forEach(function (item) {
    const key = Math.floor(item.start / 3600000) * 3600000;
    if (!buckets.has(key)) {
      buckets.set(key, { start: key, end: key + 3600000, values: [], rows: 0 });
    }
    const bucket = buckets.get(key);
    bucket.values.push(item.price);
    bucket.rows += 1;
  });

  return Array.from(buckets.values())
    .map(function (bucket) {
      return {
        start: bucket.start,
        end: bucket.end,
        price: bucket.values.reduce(function (sum, value) { return sum + value; }, 0) / bucket.values.length,
        rows: bucket.rows
      };
    })
    .filter(function (bucket) { return bucket.rows > 0; })
    .sort(function (a, b) { return a.start - b.start; });
}

function currentItems() {
  const items = rawItems();
  return state.resolution === "1h" ? hourlyItems(items) : items;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort(function (a, b) { return a - b; });
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function allGridProfiles() {
  if (!state.tariffData) return [];
  const profiles = [];
  if (state.tariffData.default_profile) profiles.push(state.tariffData.default_profile);
  return profiles.concat(state.tariffData.profiles || []);
}

function populateGridProfiles() {
  if (!state.tariffData) return;
  const current = state.tariff.profileId || "median";
  els.gridProfile.innerHTML = "";
  els.quickGridSelect.innerHTML = "";

  allGridProfiles().forEach(function (profile) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    els.gridProfile.appendChild(option);

    const quickOption = document.createElement("option");
    quickOption.value = profile.id;
    quickOption.textContent = profile.id === "median" ? "Standard (median)" : profile.name;
    els.quickGridSelect.appendChild(quickOption);
  });

  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Tilpasset";
  els.gridProfile.appendChild(custom);

  els.gridProfile.value = allGridProfiles().some(function (p) { return p.id === current; }) ? current : "custom";
  els.quickGridSelect.value = allGridProfiles().some(function (p) { return p.id === current; }) ? current : "median";
}

function applyGridProfile(profileId) {
  if (profileId === "custom") {
    state.tariff.profileId = "custom";
    state.tariff.hourly = null;
    return;
  }

  const profile = allGridProfiles().find(function (item) { return item.id === profileId; });
  if (!profile || !Array.isArray(profile.hourly_ex_vat_ore) || profile.hourly_ex_vat_ore.length !== 24) return;

  const hourly = profile.hourly_ex_vat_ore.map(Number);
  state.tariff.profileId = profileId;
  state.tariff.hourly = hourly;
  state.tariff.offpeak = median(hourly.slice(0, 6));
  state.tariff.standard = median(hourly.slice(6, 17).concat(hourly.slice(21, 24)));
  state.tariff.peak = median(hourly.slice(17, 21));
  state.tariff.configured = true;
}

function fillTariffForm() {
  if (els.gridProfile) els.gridProfile.value = state.tariff.profileId || "custom";
  els.nationalCharge.value = Number(state.tariff.national || 0).toFixed(1);
  els.offpeakCharge.value = Number(state.tariff.offpeak || 0).toFixed(1);
  els.standardCharge.value = Number(state.tariff.standard || 0).toFixed(1);
  els.peakCharge.value = Number(state.tariff.peak || 0).toFixed(1);
  els.supplierCharge.value = Number(state.tariff.supplier || 0).toFixed(1);
  els.vatRate.value = Number(state.tariff.vat || 0).toFixed(1);
}

function openSettings() {
  fillTariffForm();
  if (typeof els.settingsDialog.showModal === "function") {
    els.settingsDialog.showModal();
  } else {
    els.settingsDialog.setAttribute("open", "");
  }
}

function updateTotalUi() {
  const isSe4 = state.area === "SE4";
  els.quickGridProfile.hidden = isSe4 || !state.includeTotal;
  els.totalToggle.disabled = false;
  els.settingsButton.disabled = isSe4;
  els.totalToggle.checked = state.includeTotal;

  if (isSe4) {
    els.totalHelp.textContent = state.includeTotal
      ? "Ca. SE4-forbrugerpris inkl. svenske afgifter, net og moms."
      : "SE4 spotpris uden svensk energiskat, net, leverandørtillæg og moms.";
    return;
  }
  if (state.includeTotal) {
    const profileName = (allGridProfiles().find(function (p) { return p.id === state.tariff.profileId; }) || {}).name;
    els.totalHelp.textContent = "Ca. totalpris: spot + " + (profileName || "transport") + " + nationale tariffer/elafgift + moms. Faste abonnementer er ikke medregnet.";
  } else {
    els.totalHelp.textContent = "Spotpris vises uden nettarif, elafgift, leverandørtillæg og moms.";
  }
}

function renderSummary(items) {
  if (!items.length) {
    els.minPrice.textContent = "–";
    els.minTime.textContent = "–";
    els.avgPrice.textContent = "–";
    els.periodCount.textContent = "–";
    els.maxPrice.textContent = "–";
    els.maxTime.textContent = "–";
    return;
  }

  const priced = items.map(function (item) {
    return Object.assign({}, item, { displayPrice: displayedPrice(item) });
  });

  const low = priced.reduce(function (a, b) { return a.displayPrice <= b.displayPrice ? a : b; });
  const high = priced.reduce(function (a, b) { return a.displayPrice >= b.displayPrice ? a : b; });
  const avg = priced.reduce(function (sum, item) { return sum + item.displayPrice; }, 0) / priced.length;

  els.minPrice.textContent = formatPrice(low.displayPrice);
  els.minTime.textContent = formatClock(low.start) + "–" + formatClock(low.end);
  els.avgPrice.textContent = formatPrice(avg);
  els.periodCount.textContent = priced.length + (state.resolution === "1h" ? " timer" : " perioder");
  els.maxPrice.textContent = formatPrice(high.displayPrice);
  els.maxTime.textContent = formatClock(high.start) + "–" + formatClock(high.end);
}

function priceBand(value, sortedPrices) {
  if (!sortedPrices.length) return 2;
  const rank = sortedPrices.findIndex(function (price) { return price >= value; });
  const percentile = (rank < 0 ? sortedPrices.length - 1 : rank) / Math.max(1, sortedPrices.length - 1);
  if (percentile <= 0.20) return 0;
  if (percentile <= 0.40) return 1;
  if (percentile <= 0.60) return 2;
  if (percentile <= 0.80) return 3;
  return 4;
}

function bestChargingWindow(items, hours) {
  if (state.resolution !== "1h" || items.length < hours) return new Set();
  let bestStart = -1;
  let bestAverage = Infinity;

  for (let i = 0; i <= items.length - hours; i += 1) {
    const slice = items.slice(i, i + hours);
    const contiguous = slice.every(function (item, j) {
      return j === 0 || item.start - slice[j - 1].start === 3600000;
    });
    if (!contiguous) continue;
    const average = slice.reduce(function (sum, item) { return sum + displayedPrice(item); }, 0) / hours;
    if (average < bestAverage) {
      bestAverage = average;
      bestStart = i;
    }
  }

  if (bestStart < 0) return new Set();
  return new Set(items.slice(bestStart, bestStart + hours).map(function (item) { return item.start; }));
}

function renderTable(items) {
  els.tableBody.innerHTML = "";
  if (!items.length) return;

  const prices = items.map(displayedPrice);
  const sortedPrices = prices.slice().sort(function (a, b) { return a - b; });
  const min = Math.min.apply(null, prices);
  const max = Math.max.apply(null, prices);
  const chargingWindow = bestChargingWindow(items, 5);
  let lastDay = "";

  items.forEach(function (item) {
    const day = formatDay(item.start);
    if (day !== lastDay) {
      const dayRow = document.createElement("tr");
      dayRow.className = "day-row";
      const dayCell = document.createElement("td");
      dayCell.colSpan = 2;
      dayCell.textContent = day;
      dayRow.appendChild(dayCell);
      els.tableBody.appendChild(dayRow);
      lastDay = day;
    }

    const price = displayedPrice(item);
    const row = document.createElement("tr");
    row.classList.add("price-band-" + priceBand(price, sortedPrices));
    if (Math.abs(price - min) < 0.0001) row.classList.add("low-row");
    if (Math.abs(price - max) < 0.0001) row.classList.add("high-row");
    if (chargingWindow.has(item.start)) row.classList.add("charge-window");

    const timeCell = document.createElement("td");
    timeCell.textContent = formatClock(item.start) + "–" + formatClock(item.end);
    if (chargingWindow.has(item.start)) {
      const badge = document.createElement("span");
      badge.className = "charge-badge";
      badge.textContent = " oplad";
      timeCell.appendChild(badge);
    }

    const priceCell = document.createElement("td");
    priceCell.className = "price-cell";
    priceCell.textContent = formatPrice(price);

    row.appendChild(timeCell);
    row.appendChild(priceCell);
    els.tableBody.appendChild(row);
  });
}

function renderGraph(items) {
  els.graphWrap.innerHTML = "";
  if (!items.length) return;

  const width = 920;
  const height = 330;
  const pad = { top: 28, right: 22, bottom: 40, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = items.map(displayedPrice);
  const minData = Math.min.apply(null, values);
  const maxData = Math.max.apply(null, values);
  const spread = Math.max(10, maxData - minData);
  const yMin = minData - spread * 0.12;
  const yMax = maxData + spread * 0.12;

  function x(i) {
    if (items.length === 1) return pad.left + plotW / 2;
    return pad.left + (i / (items.length - 1)) * plotW;
  }

  function y(value) {
    return pad.top + ((yMax - value) / (yMax - yMin)) * plotH;
  }

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Elpris de kommende 24 timer");
  svg.style.touchAction = "pan-y";

  const tooltip = document.createElement("div");
  tooltip.className = "graph-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  tooltip.setAttribute("aria-live", "polite");
  els.graphWrap.insertAdjacentElement("afterend", tooltip);

  for (let i = 0; i < 5; i += 1) {
    const value = yMin + ((yMax - yMin) * i / 4);
    const yy = y(value);

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", pad.left);
    line.setAttribute("x2", width - pad.right);
    line.setAttribute("y1", yy);
    line.setAttribute("y2", yy);
    line.setAttribute("class", "graph-grid");
    svg.appendChild(line);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", pad.left - 8);
    label.setAttribute("y", yy + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "graph-axis-label");
    label.textContent = Math.round(value);
    svg.appendChild(label);
  }

  if (yMin < 0 && yMax > 0) {
    const zero = document.createElementNS(ns, "line");
    zero.setAttribute("x1", pad.left);
    zero.setAttribute("x2", width - pad.right);
    zero.setAttribute("y1", y(0));
    zero.setAttribute("y2", y(0));
    zero.setAttribute("class", "graph-zero");
    svg.appendChild(zero);
  }

  const points = values.map(function (value, i) {
    return x(i).toFixed(1) + "," + y(value).toFixed(1);
  }).join(" ");

  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("class", "graph-line");
  svg.appendChild(polyline);

  const lowIndex = values.indexOf(minData);
  const highIndex = values.indexOf(maxData);

  [
    { index: lowIndex, cls: "graph-point-low" },
    { index: highIndex, cls: "graph-point-high" }
  ].forEach(function (marker) {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", x(marker.index));
    circle.setAttribute("cy", y(values[marker.index]));
    circle.setAttribute("r", 6);
    circle.setAttribute("class", marker.cls);
    svg.appendChild(circle);
  });

  const targetTicks = state.resolution === "1h" ? 9 : 9;
  const tickIndexes = Array.from(new Set(
    Array.from({ length: targetTicks }, function (_, i) {
      return Math.round(i * (items.length - 1) / (targetTicks - 1));
    })
  ));
  tickIndexes.forEach(function (idx) {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", x(idx));
    label.setAttribute("y", height - pad.bottom + 18);
    label.setAttribute("text-anchor", "start");
    label.setAttribute("class", "graph-label");
    label.setAttribute("transform", "rotate(90 " + x(idx) + " " + (height - pad.bottom + 18) + ")");
    label.textContent = formatClock(items[idx].start);
    svg.appendChild(label);
  });

  const raw = rawItems();
  function showQuarterAt(clientX) {
    if (!raw.length) return;
    const rect = svg.getBoundingClientRect();
    const svgX = (clientX - rect.left) / rect.width * width;
    const ratio = Math.max(0, Math.min(1, (svgX - pad.left) / plotW));
    const targetTime = items[0].start + ratio * (items[items.length - 1].start - items[0].start);
    const quarter = raw.reduce(function (best, item) {
      return Math.abs(item.start - targetTime) < Math.abs(best.start - targetTime) ? item : best;
    }, raw[0]);
    const price = displayedPrice(quarter);
    tooltip.textContent = formatClock(quarter.start) + "–" + formatClock(quarter.end) + " · " + formatPrice(price);
    tooltip.hidden = false;

  }

  let pointerStart = null;

  svg.addEventListener("pointerdown", function (event) {
    pointerStart = { x: event.clientX, y: event.clientY };
  });

  svg.addEventListener("pointerup", function (event) {
    if (!pointerStart) return;
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    if (moved < 12) showQuarterAt(event.clientX);
    pointerStart = null;
  });

  svg.addEventListener("pointercancel", function () {
    pointerStart = null;
  });

  svg.addEventListener("pointermove", function (event) {
    if (event.pointerType === "mouse" && !event.buttons) showQuarterAt(event.clientX);
  });

  svg.addEventListener("pointerleave", function (event) {
    if (event.pointerType === "mouse") tooltip.hidden = true;
  });

  els.graphWrap.appendChild(svg);
}

function render() {
  setActiveButtons(els.areaControl, "area", state.area);
  setActiveButtons(els.resolutionControl, "resolution", state.resolution);
  setActiveButtons(els.viewControl, "view", state.view);
  updatePostcodeUi();
  updateTotalUi();

  const items = currentItems();
  const hasItems = items.length > 0;

  els.graphView.hidden = state.view !== "graph" || !hasItems;
  els.tableView.hidden = state.view !== "table" || !hasItems;
  els.emptyState.hidden = hasItems;

  els.contentSubtitle.textContent = state.includeTotal
    ? "Ca. pris inkl. valgte tillæg og moms · øre/kWh"
    : "Spotpris · øre/kWh";

  if (state.data && state.data.coverage) {
    const complete = state.data.coverage.tomorrow_complete;
    els.coverageBadge.textContent = complete ? "I morgen klar" : "Afventer i morgen";
  } else {
    els.coverageBadge.textContent = "–";
  }

  renderSummary(items);
  if (hasItems) {
    renderGraph(items);
    renderTable(items);
  }
}

els.areaControl.addEventListener("click", function (event) {
  const button = event.target.closest("button[data-area]");
  if (!button) return;
  state.area = button.dataset.area;
  localStorage.setItem("elpris-area", state.area);
  updatePostcodeUi();
  render();
});

els.resolutionControl.addEventListener("click", function (event) {
  const button = event.target.closest("button[data-resolution]");
  if (!button) return;
  state.resolution = button.dataset.resolution;
  localStorage.setItem("elpris-resolution", state.resolution);
  render();
});

els.viewControl.addEventListener("click", function (event) {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  localStorage.setItem("elpris-view", state.view);
  render();
});

els.totalToggle.addEventListener("change", function () {
  state.includeTotal = els.totalToggle.checked;
  localStorage.setItem("elpris-total", String(state.includeTotal));
  render();
});

els.settingsButton.addEventListener("click", openSettings);
els.closeSettings.addEventListener("click", function () { els.settingsDialog.close(); });

els.postcodeInput.addEventListener("change", function () {
  localStorage.setItem(postcodeKey(state.area), els.postcodeInput.value.trim());
  suggestGridFromPostcode();
  updatePostcodeUi();
});

els.quickGridSelect.addEventListener("change", function () {
  applyGridProfile(els.quickGridSelect.value);
  saveTariff(state.tariff);
  populateGridProfiles();
  fillTariffForm();
  render();
});

els.gridProfile.addEventListener("change", function () {
  applyGridProfile(els.gridProfile.value);
  fillTariffForm();
});

[els.nationalCharge, els.offpeakCharge, els.standardCharge, els.peakCharge, els.supplierCharge, els.vatRate].forEach(function (input) {
  input.addEventListener("input", function () {
    state.tariff.profileId = "custom";
    state.tariff.hourly = null;
    els.gridProfile.value = "custom";
  });
});

els.resetTariffs.addEventListener("click", function () {
  state.tariff = Object.assign({}, DEFAULT_TARIFF);
  applyGridProfile("median");
  fillTariffForm();
});

els.tariffForm.addEventListener("submit", function (event) {
  if (event.submitter && event.submitter.value !== "save") return;

  const tariff = {
    configured: true,
    profileId: state.tariff.profileId || "custom",
    hourly: state.tariff.profileId === "custom" ? null : state.tariff.hourly,
    national: Number(els.nationalCharge.value || 0),
    offpeak: Number(els.offpeakCharge.value || 0),
    standard: Number(els.standardCharge.value || 0),
    peak: Number(els.peakCharge.value || 0),
    supplier: Number(els.supplierCharge.value || 0),
    vat: Number(els.vatRate.value || 0)
  };

  saveTariff(tariff);
  state.includeTotal = true;
  localStorage.setItem("elpris-total", "true");
  render();
});

async function loadPrices() {
  const response = await fetch("./data/prices.json?v=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP " + response.status);
  state.data = await response.json();
  els.status.textContent = formatUpdated(state.data.generated_at);
}

async function loadFx() {
  try {
    const response = await fetch("./data/fx.json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    state.fx = await response.json();
  } catch (error) {
    console.warn("Kunne ikke hente valutakurs", error);
  }
}

async function loadTariffData() {
  try {
    const response = await fetch("./data/tariffs.json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    state.tariffData = await response.json();
    populateGridProfiles();

    if (state.tariff.profileId === "median" && state.tariffData.default_profile && state.tariffData.default_profile.hourly_ex_vat_ore.length === 24) {
      applyGridProfile("median");
    } else if (state.tariff.profileId && state.tariff.profileId !== "custom") {
      applyGridProfile(state.tariff.profileId);
    }
  } catch (error) {
    console.warn("Kunne ikke hente tarifdata", error);
  }
}

async function loadData() {
  try {
    await Promise.all([loadPrices(), loadTariffData(), loadFx()]);
    fillTariffForm();
    render();
  } catch (error) {
    console.error(error);
    els.status.textContent = "Kunne ikke hente prisdata";
    els.emptyState.hidden = false;
    els.emptyState.querySelector("strong").textContent = "Prisdata mangler";
    els.emptyState.querySelector("p").textContent = "Prøv igen senere.";
  }
}

async function refreshPrices() {
  try {
    const before = state.data && state.data.generated_at;
    await loadPrices();
    if (!before || before !== state.data.generated_at) render();
  } catch (error) {
    console.warn("Automatisk prisopdatering fejlede", error);
  }
}

fillTariffForm();
render();
loadData();
setInterval(refreshPrices, 2 * 60 * 1000);

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (els.installButton) els.installButton.hidden = false;
});

function setupInstallExperience() {
  const ua = navigator.userAgent || "";
  const inApp = /(FBAN|FBAV|Instagram|Line\/|GSA\/|GoogleApp|wv\)|; wv|Gmail|Chat)/i.test(ua);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const dismissed = sessionStorage.getItem("elpris-browser-hint") === "hidden";

  const isiOS = /iPhone|iPad|iPod/i.test(ua);
  const isFirefox = /Firefox\//i.test(ua);
  if (els.installHelpText) {
    if (standalone) {
      els.installHelpText.textContent = "Elpris er åbnet som installeret app.";
    } else if (isiOS) {
      els.installHelpText.textContent = "iPhone/iPad: Åbn i Safari → Del → Føj til hjemmeskærm.";
    } else if (isFirefox) {
      els.installHelpText.textContent = "Firefox på Android: Menu → Føj app til startskærm. Chrome kan også tilbyde Installer app.";
    } else {
      els.installHelpText.textContent = "Android: brug Installer app/Føj til startskærm. iPhone/iPad: Safari → Del → Føj til hjemmeskærm.";
    }
  }

  if (els.installButton) {
    els.installButton.addEventListener("click", async function () {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      els.installButton.hidden = true;
    });
  }

  if (inApp && !standalone && !dismissed) {
    els.browserHintText.textContent = isiOS
      ? "Åbn siden i Safari og vælg Del → Føj til hjemmeskærm."
      : "Åbn siden i Chrome og vælg Installer app eller Føj til startskærm.";
    els.browserHint.hidden = false;
  }

  els.dismissBrowserHint.addEventListener("click", function () {
    els.browserHint.hidden = true;
    sessionStorage.setItem("elpris-browser-hint", "hidden");
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(function (error) {
      console.warn("Service worker kunne ikke registreres", error);
    });
  }
}

setupInstallExperience();
