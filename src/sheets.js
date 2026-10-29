/**
 * sheets.js — the Google Apps Script glue. Everything that touches
 * SpreadsheetApp lives here; the logic is in engine.js and stats.js.
 *
 * Tabs:
 *   Config      key / value / note                  (you edit)
 *   Events      one row per subject offered         (you fill, or load the example)
 *   Plan        sample size, dates, what is readable (generated)
 *   Readout     per-arm funnel with CI and p         (generated)
 *   Maturation  conversion by age, young cohorts     (generated)
 *   Checks      the traps, each with a status        (generated)
 */

var TAB_CONFIG = 'Config', TAB_EVENTS = 'Events', TAB_PLAN = 'Plan',
  TAB_READOUT = 'Readout', TAB_MATURATION = 'Maturation', TAB_CHECKS = 'Checks';

var CONFIG_NOTES = {
  test_name: 'Shown in every generated tab',
  next_stage_label: 'The step both arms can reach once the call is skipped: questionnaire, intake form, trial, audit, proposal',
  primary_endpoint: 'stage = reached the next stage; qualified = reached it OR qualified via the call route',
  baseline_rate: 'Historical rate from offer to the primary endpoint in the call flow, e.g. 3%',
  mde: 'Smallest absolute difference worth detecting, e.g. 2% means 3% vs 5%',
  alpha: 'Significance level, default 0.05',
  power: 'Default 0.8',
  ni_margin: 'How much the skip arm may lose and still count as "no worse". Blank = same as mde',
  planned_split_skip: 'Share the randomizer sends to the skip arm, e.g. 50%',
  offers_per_week: 'How many subjects enter the test per week, both arms together',
  start_date: 'First offer date (YYYY-MM-DD)',
  freeze_date: 'Entry closes; blank = computed from the sample size and offers_per_week',
  snapshot_date: 'Read as of this date; blank = today. Set it to reproduce a past read',
  maturity_stage_days: 'Days after the offer by which a next-stage conversion is counted (30)',
  maturity_qualified_days: 'Same for qualified by any route (30)',
  maturity_proposal_days: 'Same for proposal (45)',
  maturity_won_days: 'Same for won (90)',
  age_checkpoints: 'Ages for the maturation curve, comma separated',
  exclude_prior: 'true = drop subjects who had engaged before the offer; false = keep them with pre-offer outcomes blanked',
  baseline_proposal_rate: 'Optional: historical offer to proposal rate, to see whether proposal is readable at your volume',
  baseline_won_rate: 'Optional: historical offer to won rate'
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Skip-the-Call')
    .addItem('1. Create Config and Events tabs', 'createTemplateTabs')
    .addItem('2. Build plan', 'buildPlanTab')
    .addItem('3. Run readout (Readout, Maturation, Checks)', 'runReadout')
    .addSeparator()
    .addItem('Load synthetic example (replaces Config and Events)', 'loadExample')
    .addToUi();
}

// ───────────────────────── tab helpers ─────────────────────────────────────

function sheet_(name, create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh && create) sh = ss.insertSheet(name);
  return sh;
}

function writeTab_(name, rows, headerRow) {
  var sh = sheet_(name, true);
  sh.clear();
  if (!rows.length) return sh;
  var ncol = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  var grid = rows.map(function (r) { var x = r.slice(); while (x.length < ncol) x.push(''); return x; });
  sh.getRange(1, 1, grid.length, ncol).setValues(grid);
  sh.getRange(1, 1, 1, ncol).setFontWeight('bold');
  if (headerRow) {
    sh.getRange(headerRow, 1, 1, ncol).setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(headerRow);
  }
  for (var c = 1; c <= Math.min(ncol, 12); c++) sh.autoResizeColumn(c);
  return sh;
}

function readConfig_() {
  var sh = sheet_(TAB_CONFIG, false);
  if (!sh) throw new Error('No "' + TAB_CONFIG + '" tab. Run menu item 1 first.');
  var vals = sh.getDataRange().getValues();
  return vals.map(function (r) { return [r[0], r[1]]; });
}

function readEvents_() {
  var sh = sheet_(TAB_EVENTS, false);
  if (!sh) throw new Error('No "' + TAB_EVENTS + '" tab. Run menu item 1 first.');
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) throw new Error('"' + TAB_EVENTS + '" has a header and no rows. Fill it or load the example.');
  return { header: vals[0], rows: vals.slice(1) };
}

// ───────────────────────── menu actions ────────────────────────────────────

function createTemplateTabs() {
  var ui = SpreadsheetApp.getUi();
  var existing = [TAB_CONFIG, TAB_EVENTS].filter(function (n) { return sheet_(n, false); });
  if (existing.length) {
    var ans = ui.alert('Tabs already exist', existing.join(', ') + ' already exist. Overwrite them with the blank template?', ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }
  var cfgRows = [['key', 'value', 'note']];
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) {
    var v = CONFIG_DEFAULTS[k];
    if (typeof v === 'number' && v < 1 && ['alpha', 'power', 'baseline_rate', 'mde', 'planned_split_skip'].indexOf(k) >= 0) v = (v * 100) + '%';
    if (k === 'alpha' || k === 'power') v = CONFIG_DEFAULTS[k];
    cfgRows.push([k, v, CONFIG_NOTES[k] || '']);
  });
  writeTab_(TAB_CONFIG, cfgRows, 1);
  var ev = writeTab_(TAB_EVENTS, [EVENT_COLUMNS], 1);
  ev.getRange(2, 1).setNote('One row per subject who received the offer. Dates as YYYY-MM-DD or real date cells. See docs/data-contract.md.');
  ui.alert('Created', 'Config and Events are ready. Fill Config, paste your subjects into Events, then run menu items 2 and 3.', ui.ButtonSet.OK);
}

function loadExample() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert('Load example', 'This replaces the Config and Events tabs with the synthetic example (2,400 subjects with a planted selection bias). Continue?', ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;
  var cfg = {
    test_name: 'Skip-the-Call test (example)', next_stage_label: 'questionnaire', primary_endpoint: 'stage',
    baseline_rate: '3%', mde: '2%', alpha: 0.05, power: 0.8, ni_margin: '1.5%', planned_split_skip: '50%',
    offers_per_week: 200, start_date: '2026-03-02', freeze_date: '2026-05-24', snapshot_date: '2026-07-15',
    maturity_stage_days: 30, maturity_qualified_days: 30, maturity_proposal_days: 45, maturity_won_days: 90,
    age_checkpoints: '7,14,21,30,45,60,90', exclude_prior: true, baseline_proposal_rate: '1.2%', baseline_won_rate: '0.3%'
  };
  var cfgRows = [['key', 'value', 'note']];
  Object.keys(cfg).forEach(function (k) { cfgRows.push([k, cfg[k], CONFIG_NOTES[k] || '']); });
  writeTab_(TAB_CONFIG, cfgRows, 1);
  var subjects = generateSynthetic({});
  var rows = [EVENT_COLUMNS].concat(subjects.map(function (s) { return EVENT_COLUMNS.map(function (c) { return s[c]; }); }));
  writeTab_(TAB_EVENTS, rows, 1);
  buildPlanTab();
  runReadout();
  ui.alert('Example loaded', 'Read the Checks tab first: it should show one FAIL (the auto-reply that routes only into the skip arm). Then compare the Readout\'s pooled line with the randomizer-only line in Checks.', ui.ButtonSet.OK);
}

function buildPlanTab() {
  var cfg = parseConfig(readConfig_());
  var plan = buildPlan(cfg);
  writeTab_(TAB_PLAN, plan.rows, 3);
  SpreadsheetApp.getActiveSpreadsheet().toast('Plan written: ' + plan.nSup + ' subjects per arm to detect the MDE', 'Skip-the-Call', 6);
}

function runReadout() {
  var cfgRows = readConfig_();
  var ev = readEvents_();
  var out = runAll(cfgRows, ev.header, ev.rows);
  writeTab_(TAB_CHECKS, out.checks.rows, 3);
  writeTab_(TAB_READOUT, out.readout.rows, 3);
  writeTab_(TAB_MATURATION, out.maturation.rows, 1);
  colorChecks_();
  var nFail = out.checks.checks.filter(function (c) { return c.status === 'FAIL'; }).length;
  var nWarn = out.checks.checks.filter(function (c) { return c.status === 'WARN'; }).length;
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Readout written for ' + out.readout.population.length + ' subjects. Checks: ' + nFail + ' FAIL, ' + nWarn + ' WARN.',
    'Skip-the-Call', 8);
}

function colorChecks_() {
  var sh = sheet_(TAB_CHECKS, false);
  if (!sh) return;
  var last = sh.getLastRow();
  if (last < 4) return;
  var rng = sh.getRange(4, 2, last - 3, 1);
  var vals = rng.getValues();
  var colors = vals.map(function (r) {
    var s = String(r[0]);
    return [s === 'FAIL' ? '#f4c7c3' : s === 'WARN' ? '#fce8b2' : s === 'OK' ? '#b7e1cd' : '#ffffff'];
  });
  rng.setBackgrounds(colors);
}
