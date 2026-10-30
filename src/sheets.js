/**
 * @OnlyCurrentDoc
 * sheets.js — the Google Apps Script glue. Everything that touches
 * SpreadsheetApp lives here; the logic is in engine.js and stats.js.
 *
 * Tabs:
 *   Start here  the five steps, in the sheet        (generated)
 *   Config      key / value / note                  (you edit)
 *   Events      one row per subject offered         (you fill, or load the example)
 *   Plan        sample size, dates, what is readable (generated)
 *   Readout     per-arm funnel with CI and p         (generated)
 *   Maturation  conversion by age, young cohorts     (generated)
 *   Checks      the traps, each with a status        (generated)
 */

var TAB_START = 'Start here', TAB_CONFIG = 'Config', TAB_EVENTS = 'Events', TAB_PLAN = 'Plan',
  TAB_READOUT = 'Readout', TAB_MATURATION = 'Maturation', TAB_CHECKS = 'Checks';

var MAX_COL_PX = 420;

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

var START_ROWS = [
  ['Skip-the-Call test: do we still need the qualification call?'],
  [],
  ['Step', 'What to do', 'Menu'],
  ['0', 'See it work: load the synthetic example (2,400 subjects, one planted selection bias) and read the Checks tab first.', 'Skip-the-Call → Load the example'],
  ['1', 'Is your volume enough? Fill three numbers in Config: baseline_rate, mde, offers_per_week. The first line of Plan is the verdict. No data needed.', 'Skip-the-Call → 1. Plan'],
  ['2', 'Name the next stage (next_stage_label) and decide the endpoint before the first read: next stage, or qualified by any route.', ''],
  ['3', 'Fix the randomization: one split, before any automation or person touches the subject. Log who assigned each arm (assignment_source).', ''],
  ['4', 'Paste one row per subject offered into Events. Column meanings: docs/data-contract.md. Any CSV export can be mapped with adapters/map_csv.py.', 'Skip-the-Call → Reset to blank Config and Events'],
  ['5', 'Read on the dates the Plan gives you: Checks first, then the primary endpoint in Readout, then qualified by any route.', 'Skip-the-Call → 2. Readout'],
  [],
  ['The first menu run asks for permission. The script reads and writes this spreadsheet only (@OnlyCurrentDoc): no other files, no network.'],
  ['Code, method and the eight traps: https://github.com/Vadim2090/skip-the-call-test']
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Skip-the-Call')
    .addItem('Load the example (replaces Config and Events)', 'loadExample')
    .addItem('1. Plan: is my volume enough? (reads Config only)', 'buildPlanTab')
    .addItem('2. Readout: Readout, Maturation, Checks', 'runReadout')
    .addSeparator()
    .addItem('Reset to blank Config and Events', 'createTemplateTabs')
    .addToUi();
  // A sheet with the script pasted in and nothing else gets its tabs on first open.
  // Simple triggers may edit the file they are bound to; a failure here must not hide the menu.
  try {
    if (!sheet_(TAB_CONFIG, false)) { writeStartTab_(); writeBlankTabs_(); }
  } catch (e) { /* the menu items create the tabs too */ }
}

function writeStartTab_() {
  var sh = writeTab_(TAB_START, START_ROWS, 3);
  sh.setColumnWidth(2, 640);
  sh.getRange(4, 2, START_ROWS.length - 3, 1).setWrap(true);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  SpreadsheetApp.getActiveSpreadsheet().moveActiveSheet(1);
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
  var grid = rows.map(function (r) {
    var x = r.map(asText_);
    while (x.length < ncol) x.push('');
    return x;
  });
  sh.getRange(1, 1, grid.length, ncol).setValues(grid);
  sh.getRange(1, 1, 1, ncol).setFontWeight('bold');
  if (headerRow) {
    sh.getRange(headerRow, 1, 1, ncol).setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(headerRow);
  }
  for (var c = 1; c <= Math.min(ncol, 12); c++) {
    sh.autoResizeColumn(c);
    // A long note line would otherwise stretch its column off the screen.
    if (sh.getColumnWidth(c) > MAX_COL_PX) sh.setColumnWidth(c, MAX_COL_PX);
  }
  return sh;
}

/** A string that starts with = + or - is read by Sheets as a formula ("+2.00 pp" shows #ERROR!). */
function asText_(v) {
  return typeof v === 'string' && /^[=+\-]/.test(v) ? "'" + v : v;
}

function readConfig_() {
  var sh = sheet_(TAB_CONFIG, false);
  if (!sh) throw new Error('No "' + TAB_CONFIG + '" tab. Run Skip-the-Call → Reset to blank Config and Events.');
  var vals = sh.getDataRange().getValues();
  return vals.map(function (r) { return [r[0], r[1]]; });
}

function readEvents_() {
  var sh = sheet_(TAB_EVENTS, false);
  if (!sh) throw new Error('No "' + TAB_EVENTS + '" tab. Run Skip-the-Call → Reset to blank Config and Events.');
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
  writeBlankTabs_();
  ui.alert('Created', 'Config and Events are ready. Fill Config, paste your subjects into Events, then run 1. Plan and 2. Readout.', ui.ButtonSet.OK);
}

function writeBlankTabs_() {
  var cfgRows = [['key', 'value', 'note']];
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) {
    var v = CONFIG_DEFAULTS[k];
    if (typeof v === 'number' && v < 1 && ['baseline_rate', 'mde', 'planned_split_skip'].indexOf(k) >= 0) v = (v * 100) + '%';
    cfgRows.push([k, v, CONFIG_NOTES[k] || '']);
  });
  writeTab_(TAB_CONFIG, cfgRows, 1);
  var ev = writeTab_(TAB_EVENTS, [EVENT_COLUMNS], 1);
  ev.getRange(2, 1).setNote('One row per subject who received the offer. Dates as YYYY-MM-DD or real date cells. See docs/data-contract.md.');
  addEventDropdowns_(ev);
}

/** Dropdowns on the two columns whose values the engine checks: arm and assignment_source. */
function addEventDropdowns_(sh) {
  [['arm', ARMS], ['assignment_source', SOURCES]].forEach(function (pair) {
    var col = EVENT_COLUMNS.indexOf(pair[0]) + 1;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(pair[1], true).setAllowInvalid(true).build();
    sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  });
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
  if (!sheet_(TAB_START, false)) writeStartTab_();
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
