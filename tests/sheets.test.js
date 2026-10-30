// Smoke test for the Apps Script glue. Loads the four src files into one global scope, as Apps
// Script does, with a minimal in-memory SpreadsheetApp, then drives the menu like a user would.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeSpreadsheetApp(answer) {
  const sheets = [];
  const toasts = [];
  const alerts = [];
  function makeSheet(name) {
    const cells = new Map();          // "r,c" -> value
    const sh = {
      name, frozen: 0, validations: [],
      getName: () => name,
      clear() { cells.clear(); },
      setFrozenRows(n) { sh.frozen = n; },
      autoResizeColumn() {}, setColumnWidth() {}, getColumnWidth: () => 100,
      getMaxRows: () => 1000,
      getLastRow() { let m = 0; for (const k of cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; },
      getLastColumn() { let m = 0; for (const k of cells.keys()) m = Math.max(m, +k.split(',')[1]); return m; },
      getDataRange() { return sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 1)); },
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        const range = {
          setValues(grid) {
            assert.equal(grid.length, nr, `${name}: row count`);
            grid.forEach((row, i) => { assert.equal(row.length, nc, `${name}: column count`); row.forEach((v, j) => cells.set(`${r + i},${c + j}`, v)); });
            return range;
          },
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = cells.get(`${r + i},${c + j}`); row.push(v === undefined ? '' : v); } out.push(row); }
            return out;
          },
          setDataValidation(rule) { sh.validations.push({ col: c, rule }); return range; },
          setFontWeight: () => range, setBackground: () => range, setBackgrounds: () => range,
          setNote: () => range, setWrap: () => range
        };
        return range;
      }
    };
    return sh;
  }
  const ss = {
    getSheetByName: (n) => sheets.find(s => s.name === n) || null,
    insertSheet(n) { const s = makeSheet(n); sheets.push(s); return s; },
    setActiveSheet() {}, moveActiveSheet() {},
    toast: (msg) => toasts.push(msg)
  };
  const ui = {
    Button: { YES: 'YES', NO: 'NO', OK: 'OK' },
    ButtonSet: { YES_NO: 'YES_NO', OK: 'OK' },
    alert(title, msg) { alerts.push(title); return answer; },
    createMenu() { const m = { items: [], addItem(label, fn) { m.items.push([label, fn]); return m; }, addSeparator: () => m, addToUi() { ui.menu = m; } }; return m; }
  };
  const app = {
    getActiveSpreadsheet: () => ss,
    getUi: () => ui,
    newDataValidation() { const b = { list: null, requireValueInList(l) { b.list = l; return b; }, setAllowInvalid: () => b, build: () => ({ list: b.list }) }; return b; }
  };
  return { app, ss, ui, sheets, toasts, alerts };
}

function loadScript(fake) {
  const ctx = vm.createContext({ SpreadsheetApp: fake.app, Math, Date, JSON, console });
  for (const f of ['stats.js', 'engine.js', 'synthetic.js', 'sheets.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

test('first open of a sheet with only the script creates Start here, Config and Events', () => {
  const fake = fakeSpreadsheetApp('YES');
  const g = loadScript(fake);
  g.onOpen();
  assert.deepEqual(fake.sheets.map(s => s.name).sort(), ['Config', 'Events', 'Start here']);
  assert.ok(fake.ui.menu.items.every(([, fn]) => typeof g[fn] === 'function'), 'every menu item points to a function');
  const header = fake.ss.getSheetByName('Events').getRange(1, 1, 1, 13).getValues()[0];
  assert.equal(header[1], 'arm');
  const lists = fake.ss.getSheetByName('Events').validations.map(v => v.rule.list.join('/'));
  assert.deepEqual(lists, ['call/skip', 'randomizer/auto/manual']);
  g.onOpen();                                         // a second open must not rewrite anything
  assert.equal(fake.sheets.length, 3);
});

test('Plan runs on the blank Config alone and starts with a verdict', () => {
  const fake = fakeSpreadsheetApp('YES');
  const g = loadScript(fake);
  g.onOpen();
  g.buildPlanTab();
  const plan = fake.ss.getSheetByName('Plan').getDataRange().getValues();
  assert.equal(plan[1][0], 'Verdict');
  assert.match(String(plan[1][1]), /weeks of enrolment at 100 offers\/week/);
});

test('Load the example fills every tab and Checks shows the planted FAIL', () => {
  const fake = fakeSpreadsheetApp('YES');
  const g = loadScript(fake);
  g.loadExample();
  for (const t of ['Start here', 'Config', 'Events', 'Plan', 'Readout', 'Maturation', 'Checks']) {
    assert.ok(fake.ss.getSheetByName(t), `${t} exists`);
  }
  assert.equal(fake.ss.getSheetByName('Events').getLastRow(), 2401);
  const statuses = fake.ss.getSheetByName('Checks').getDataRange().getValues().map(r => r[1]);
  assert.ok(statuses.includes('FAIL'));
  assert.ok(fake.toasts.some(t => /Checks: \d+ FAIL/.test(t)));
});

test('Readout on an empty Events tab fails with an instruction, not a stack trace', () => {
  const fake = fakeSpreadsheetApp('YES');
  const g = loadScript(fake);
  g.onOpen();
  assert.throws(() => g.runReadout(), /has a header and no rows/);
});

test('answering No leaves existing tabs untouched', () => {
  const fake = fakeSpreadsheetApp('NO');
  const g = loadScript(fake);
  g.onOpen();
  fake.ss.getSheetByName('Config').getRange(2, 2, 1, 1).setValues([['mine']]);
  g.createTemplateTabs();
  g.loadExample();
  assert.equal(fake.ss.getSheetByName('Config').getRange(2, 2, 1, 1).getValues()[0][0], 'mine');
});

test('generated text that looks like a formula is written as text', () => {
  const fake = fakeSpreadsheetApp('YES');
  const g = loadScript(fake);
  g.loadExample();
  const cells = fake.ss.getSheetByName('Readout').getDataRange().getValues().flat().filter(v => typeof v === 'string');
  assert.ok(cells.some(v => /^'[+-]\d/.test(v)), 'a signed difference is escaped');
  assert.ok(!cells.some(v => /^[=+-]/.test(v)), 'nothing starts with a formula character');
});
