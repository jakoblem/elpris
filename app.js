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
  areaControl: document.getElementById("areaControl"),
  resolutionControl: document.getElementById("resolutionControl"),
  viewControl: document.getElementById("viewControl"),
  totalToggle: document.getElementById("totalToggle"),
  settingsButton: document.getElementById("settingsButton"),
  totalHelp: document.getElementById("totalHelp"),
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

function setActiveButtons(container, key, value) {
  container.querySelectorAll("button").forEach(function (button) {
    button.classList.toggle("active", button.dataset[key] === value);
  });
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("da-DK", {
    minimumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
    maximumFractionDigits: 1
  }).format(value) + " øre";
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

  if (Array.isArray(state.tariff.hourly) && state.tariff.hourly.length === 24) {
    return Number(state.tariff.hourly[hour] || 0);
  }

  if (hour < 6) return state.tariff.offpeak;
  if (hour < 17) return state.tariff.standard;
  if (hour < 21) return state.tariff.peak;
  return state.tariff.standard;
}

function displayedPrice(item) {
  if (!state.includeTotal || state.area === "SE4") return item.price;
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

  allGridProfiles().forEach(function (profile) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    els.gridProfile.appendChild(option);
  });

  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Tilpasset";
  els.gridProfile.appendChild(custom);

  els.gridProfile.value = allGridProfiles().some(function (p) { return p.id === current; }) ? current : "custom";
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
  els.totalToggle.disabled = isSe4;
  els.settingsButton.disabled = isSe4;

  if (isSe4) {
    els.totalToggle.checked = false;
    els.totalHelp.textContent = "SE4 vises foreløbig som spotpris. Svenske nettariffer og afgifter kommer i en senere version.";
    return;
  }

  els.totalToggle.checked = state.includeTotal;
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

function renderTable(items) {
  els.tableBody.innerHTML = "";
  if (!items.length) return;

  const prices = items.map(displayedPrice);
  const min = Math.min.apply(null, prices);
  const max = Math.max.apply(null, prices);
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
    if (Math.abs(price - min) < 0.0001) row.classList.add("low-row");
    if (Math.abs(price - max) < 0.0001) row.classList.add("high-row");

    const timeCell = document.createElement("td");
    timeCell.textContent = formatClock(item.start) + "–" + formatClock(item.end);

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

  const tickIndexes = Array.from(new Set([0, Math.floor((items.length - 1) / 4), Math.floor((items.length - 1) / 2), Math.floor((items.length - 1) * 3 / 4), items.length - 1]));
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

  els.graphWrap.appendChild(svg);
}

function render() {
  setActiveButtons(els.areaControl, "area", state.area);
  setActiveButtons(els.resolutionControl, "resolution", state.resolution);
  setActiveButtons(els.viewControl, "view", state.view);
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
  if (state.area === "SE4") return;

  state.includeTotal = els.totalToggle.checked;
  localStorage.setItem("elpris-total", String(state.includeTotal));
  render();
});

els.settingsButton.addEventListener("click", openSettings);
els.closeSettings.addEventListener("click", function () { els.settingsDialog.close(); });

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
    await Promise.all([loadPrices(), loadTariffData()]);
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
