// Exercise the browser script and renderers without network or third-party packages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');

class Element {
  constructor() {
    this.children = []; this.attributes = {}; this.listeners = {}; this.style = {};
    this.classList = { add() {}, toggle() {} };
  }
  set innerHTML(value) { this.children = []; }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, width: 920 }; }
}

function app(now) {
  let clock = Date.parse(now);
  const nodes = new Map();
  const context = vm.createContext({
    Date: class extends Date { static now() { return clock; } }, Intl, console,
    AbortController, setTimeout() { return 0; }, clearTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {} },
    sessionStorage: { getItem() { return null; } },
    document: {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
      createElement() { return new Element(); }, createElementNS() { return new Element(); }
    },
    window: { addEventListener() {}, matchMedia() { return { matches: false }; }, navigator: {} },
    navigator: { userAgent: '' }, setInterval() {}, fetch: () => new Promise(() => {})
  });
  vm.runInContext(source, context);
  return {
    run: code => vm.runInContext(code, context), nodes,
    time: value => { clock = Date.parse(value); },
    data(rows, coverage) {
      context.fixture = { generated_at: '2026-10-24T20:00:00Z', areas: { DK1: rows, DK2: rows, SE4: rows }, coverage };
      vm.runInContext('state.data = fixture', context);
    },
    async refresh(responder) {
      context.fetch = responder || (async () => ({ ok: true, json: async () => context.fixture }));
      await vm.runInContext('refreshPrices()', context);
    }
  };
}

function rows(start, count) {
  return Array.from({ length: count }, (_, i) => ({
    time_utc: new Date(Date.parse(start) + i * 900000).toISOString(), price_ore_kwh: i - 10
  }));
}

for (const zone of ['UTC', 'Europe/Copenhagen', 'America/Los_Angeles']) {
  test(`calendar boundaries and coverage independent of browser timezone (${zone})`, () => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      for (const [now, expected] of [
        ['2026-10-24T23:59:00+02:00', '2026-10-25'],
        ['2026-10-25T00:00:00+02:00', '2026-10-26'],
        ['2026-10-25T00:30:00+02:00', '2026-10-26'],
        ['2026-10-25T02:30:00+02:00', '2026-10-26'],
        ['2026-10-25T02:30:00+01:00', '2026-10-26'],
        ['2026-03-28T23:30:00+01:00', '2026-03-29'],
        ['2026-03-29T00:30:00+01:00', '2026-03-30'],
        ['2026-03-29T23:30:00+02:00', '2026-03-30'],
        ['2026-12-31T23:30:00+01:00', '2027-01-01'],
        ['2028-02-28T12:00:00+01:00', '2028-02-29']
      ]) {
        const a = app(now);
        assert.equal(a.run('tomorrowDateKey(Date.now())'), expected, now);
        for (const [date, complete, label] of [
          [expected, true, 'I morgen klar'], [expected, false, 'Afventer i morgen'],
          [a.run('localDateKey(Date.now())'), true, 'Afventer i morgen']
        ]) {
          a.data([], { tomorrow_date: date, tomorrow_complete: complete });
          a.run('render()');
          assert.equal(a.nodes.get('coverageBadge').textContent, label, now);
        }
      }
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });
}

for (const [start, count] of [
  ['2026-03-28T23:00:00Z', 92], ['2026-10-24T22:00:00Z', 100], ['2026-10-12T22:00:00Z', 96]
]) {
  test(`${count} quarters survive filtering, hourly aggregation, table and graph`, () => {
    const a = app(start);
    // Include the first quarter of the day after tomorrow: it must be excluded.
    a.data(rows(start, count + 97));
    for (const area of ['DK1', 'DK2', 'SE4']) {
      a.run(`state.area = '${area}'`);
      const raw = a.run('rawItems()');
      assert.equal(raw.length, count + 96);
      assert.equal(new Set(raw.map(item => item.start)).size, count + 96);
      a.run(`state.data.areas['${area}'] = state.data.areas['${area}'].slice(0, ${count})`);
      const hourly = a.run('hourlyItems(rawItems())');
      assert.equal(hourly.length, count / 4);
      hourly.forEach((item, i) => {
        assert.equal(item.price, 4 * i - 8.5);
        assert.equal(item.rows, 4);
      });
    }
    for (const resolution of ['15m', '1h']) {
      a.run(`state.area = 'DK2'; state.resolution = '${resolution}'; render()`);
      const n = resolution === '1h' ? count / 4 : count;
      const table = a.nodes.get('priceTableBody').children.filter(row => row.children.length === 2);
      assert.equal(table.length, n);
      const svg = a.nodes.get('graphWrap').children.find(node => node.attributes.role === 'img');
      const points = svg.children.find(node => node.attributes.class === 'graph-line').attributes.points.split(' ');
      assert.equal(points.length, n);
      assert.equal(new Set(points.map(point => point.split(',')[0])).size, n);
      if (count === 100) {
        const first = resolution === '1h' ? 2 : 8;
        const second = resolution === '1h' ? 3 : 12;
        assert.match(table[first].children[0].textContent, /02.00 \(UTC\+2\)/);
        assert.match(table[second].children[0].textContent, /02.00 \(UTC\+1\)/);
        assert.notEqual(table[first].children[1].textContent, table[second].children[1].textContent);
        for (const index of [8, 12]) {
          // Hover at the actual UTC position of each repeated 02:00 quarter.
          const target = Date.parse(start) + index * 900000;
          const items = a.run('currentItems()');
          const x = 60 + (target - items[0].start) / (items.at(-1).start - items[0].start) * 838;
          svg.listeners.pointermove({ pointerType: 'mouse', buttons: 0, clientX: x });
          const tooltip = a.nodes.get('graphWrap').children[0];
          assert.match(tooltip.textContent, index === 8 ? /UTC\+2/ : /UTC\+1/);
          assert.ok(tooltip.textContent.endsWith(a.run(`formatPrice(displayedPrice(rawItems()[${index}]))`)));
        }
      }
    }
    if (count === 92) {
      assert.equal(a.run('rawItems().some(item => localHour(item.start) === 2)'), false);
      assert.match(a.run('formatPeriod(rawItems()[7])'), /01.45–03.00/);
    }
  });
}

test('unchanged source is rendered again across midnight, without accumulating tooltips', async () => {
  const a = app('2026-10-24T23:59:00+02:00');
  a.data(rows('2026-10-24T21:45:00Z', 102), { tomorrow_date: '2026-10-25', tomorrow_complete: true });
  a.run('render()');
  assert.equal(a.nodes.get('coverageBadge').textContent, 'I morgen klar');
  a.time('2026-10-25T00:30:00+02:00');
  await a.refresh();
  assert.equal(a.nodes.get('coverageBadge').textContent, 'Afventer i morgen');
  assert.equal(a.run('rawItems()[0].start'), Date.parse('2026-10-24T22:30:00Z'));
  await a.refresh();
  assert.equal(a.nodes.get('graphWrap').children.length, 2);
});

test('VAT, tariff validity, SE4 conversion and charging windows retain their calculations', () => {
  const a = app('2026-10-25T00:00:00+02:00');
  a.data(rows('2026-10-24T22:00:00Z', 100));
  a.run(`state.tariff = { profileId: 'custom', national: 12, offpeak: 8, standard: 20, peak: 40, vat: 25 }`);
  assert.equal(a.run('displayedPrice({start: Date.now(), price: -10})'), 12.5);
  a.run('state.includeTotal = false');
  assert.equal(a.run('displayedPrice({start: Date.now(), price: -10})'), -12.5);
  a.run('state.includeTotal = true; state.area = "SE4"; state.fx = {sek_dkk: 0.7}');
  assert.ok(Math.abs(a.run('displayedPrice({start: Date.now(), price: 100})') - 187.125) < 1e-10);
  a.run(`state.area = 'DK2'; state.tariff.profileId = 'test';
    state.tariffData = { profiles: [{ id: 'test', periods: [
      { valid_from: '2026-10-24T00:00:00Z', valid_to: '2026-10-25T01:00:00Z', hourly_ex_vat_ore: Array(24).fill(10) },
      { valid_from: '2026-10-25T01:00:00Z', hourly_ex_vat_ore: Array(24).fill(20) }
    ] }] }`);
  assert.equal(a.run(`tariffForEpoch(Date.parse('2026-10-25T00:00:00Z'))`), 10);
  assert.equal(a.run(`tariffForEpoch(Date.parse('2026-10-25T01:00:00Z'))`), 20);
  a.run('state.includeTotal = false; state.resolution = "1h"');
  const best = a.run('Array.from(bestChargingWindow(currentItems(), 5))');
  assert.equal(best.length, 5);
  best.forEach((time, i) => assert.equal(time, Date.parse('2026-10-24T22:00:00Z') + i * 3600000));
});


test('current loader retains complete GitHub data over incomplete Cloudflare and falls back on errors', async () => {
  const a = app('2026-10-25T00:30:00+02:00');
  a.data(rows('2026-10-24T22:00:00Z', 196), {
    tomorrow_date: '2026-10-26', tomorrow_complete: true,
    tomorrow_counts: { DK1: 96, DK2: 96, SE4: 96 }
  });
  const complete = a.run('fixture');
  const partial = { ...complete, coverage: { tomorrow_date: '2026-10-26', tomorrow_complete: false } };
  await a.refresh(async url => ({ ok: true, json: async () => url.startsWith('https:') ? partial : complete }));
  assert.equal(a.run('state.priceSource'), 'GitHub');
  assert.equal(a.nodes.get('coverageBadge').textContent, 'I morgen klar');
  await a.refresh(async url => {
    if (url.startsWith('https:')) throw new Error('offline');
    return { ok: true, json: async () => complete };
  });
  assert.equal(a.run('state.data'), complete);
  assert.equal(a.run('state.priceSource'), 'GitHub');
});
