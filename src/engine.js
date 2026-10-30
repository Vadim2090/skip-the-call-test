/**
 * engine.js — the measurement logic. Pure: takes the Config key/value pairs and
 * the Events rows, returns the Plan / Readout / Maturation / Checks tables as
 * arrays of arrays. No Apps Script APIs, so Node can run and test it.
 *
 * Depends on stats.js being loaded first (Apps Script shares one global scope;
 * Node gets it through require below).
 */

if (typeof require !== 'undefined' && typeof wilson === 'undefined') {
  var _S = require('./stats.js');
  var wilson = _S.wilson, fisher = _S.fisher, binomTest = _S.binomTest,
    diffCI = _S.diffCI, sampleSizeSuperiority = _S.sampleSizeSuperiority,
    sampleSizeNonInferiority = _S.sampleSizeNonInferiority, powerAt = _S.powerAt,
    nonInferiority = _S.nonInferiority;
}

var ARMS = ['call', 'skip'];           // control = qualification call first; treatment = skip it
var SOURCES = ['randomizer', 'auto', 'manual'];
var MIN_WEEK_N = 20;                 // below this a weekly scorecard line is noise

var EVENT_COLUMNS = [
  'subject_id', 'arm', 'offered_at', 'assignment_source', 'channel', 'segment',
  'call_booked_at', 'call_held_at', 'stage_at', 'qualified_at', 'proposal_at',
  'won_at', 'revenue'
];

var CONFIG_DEFAULTS = {
  test_name: 'Skip-the-Call test',
  next_stage_label: 'next stage',
  primary_endpoint: 'stage',
  baseline_rate: 0.03,
  mde: 0.02,
  alpha: 0.05,
  power: 0.8,
  ni_margin: '',
  planned_split_skip: 0.5,
  offers_per_week: 100,
  start_date: '',
  freeze_date: '',
  snapshot_date: '',
  maturity_stage_days: 30,
  maturity_qualified_days: 30,
  maturity_proposal_days: 45,
  maturity_won_days: 90,
  age_checkpoints: '7,14,21,30,45,60,90',
  exclude_prior: true,
  baseline_proposal_rate: '',
  baseline_won_rate: ''
};

// ───────────────────────── dates ───────────────────────────────────────────

var MS_DAY = 86400000;

/** Any cell value -> day number (days since epoch, UTC) or null. */
function toDay(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / MS_DAY);
  }
  if (typeof v === 'number') {
    // Google Sheets serial date (days since 1899-12-30)
    if (v > 20000 && v < 80000) return Math.floor(v) - 25569;
    return null;
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_DAY);
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);           // dd.mm.yyyy or dd/mm/yyyy
  if (m) return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / MS_DAY);
  var t = Date.parse(s);
  return isNaN(t) ? null : Math.floor(t / MS_DAY);
}

function dayToIso(d) {
  if (d === null || d === undefined) return '';
  return new Date(d * MS_DAY).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing day d. */
function weekStart(d) {
  var dow = (d + 3) % 7;            // 1970-01-01 (day 0) was a Thursday = index 3 in a Monday-based week
  if (dow < 0) dow += 7;
  return d - dow;
}

// ───────────────────────── config ──────────────────────────────────────────

function toRate(v, dflt) {
  if (v === '' || v === null || v === undefined) return dflt;
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  var s = String(v).trim();
  if (s.slice(-1) === '%') return parseFloat(s) / 100;
  var x = parseFloat(s);
  if (isNaN(x)) return dflt;
  return x > 1 ? x / 100 : x;
}

function toBool(v, dflt) {
  if (v === '' || v === null || v === undefined) return dflt;
  if (typeof v === 'boolean') return v;
  return /^(true|yes|y|1)$/i.test(String(v).trim());
}

function toNum(v, dflt) {
  if (v === '' || v === null || v === undefined) return dflt;
  var x = parseFloat(v);
  return isNaN(x) ? dflt : x;
}

/** kvRows: [[key, value], ...] as read from the Config tab. */
function parseConfig(kvRows, today) {
  var raw = {};
  for (var i = 0; i < kvRows.length; i++) {
    var k = String(kvRows[i][0] || '').trim().toLowerCase();
    if (!k || k === 'key') continue;
    raw[k] = kvRows[i][1] === undefined ? '' : kvRows[i][1];
  }
  var get = function (k) { return raw[k] === undefined ? CONFIG_DEFAULTS[k] : raw[k]; };
  var cfg = {
    test_name: String(get('test_name') || CONFIG_DEFAULTS.test_name),
    next_stage_label: String(get('next_stage_label') || CONFIG_DEFAULTS.next_stage_label),
    primary_endpoint: String(get('primary_endpoint') || 'stage').trim().toLowerCase(),
    baseline_rate: toRate(get('baseline_rate'), CONFIG_DEFAULTS.baseline_rate),
    mde: toRate(get('mde'), CONFIG_DEFAULTS.mde),
    alpha: toRate(get('alpha'), CONFIG_DEFAULTS.alpha),
    power: toRate(get('power'), CONFIG_DEFAULTS.power),
    planned_split_skip: toRate(get('planned_split_skip'), CONFIG_DEFAULTS.planned_split_skip),
    offers_per_week: toNum(get('offers_per_week'), CONFIG_DEFAULTS.offers_per_week),
    start_date: toDay(get('start_date')),
    freeze_date: toDay(get('freeze_date')),
    snapshot_date: toDay(get('snapshot_date')),
    maturity: {
      stage: toNum(get('maturity_stage_days'), 30),
      qualified: toNum(get('maturity_qualified_days'), 30),
      proposal: toNum(get('maturity_proposal_days'), 45),
      won: toNum(get('maturity_won_days'), 90)
    },
    age_checkpoints: String(get('age_checkpoints') || CONFIG_DEFAULTS.age_checkpoints)
      .split(/[,; ]+/).map(Number).filter(function (x) { return x > 0; }),
    exclude_prior: toBool(get('exclude_prior'), true),
    baseline_proposal_rate: toRate(get('baseline_proposal_rate'), null),
    baseline_won_rate: toRate(get('baseline_won_rate'), null)
  };
  cfg.ni_margin = toRate(get('ni_margin'), cfg.mde);
  if (['stage', 'qualified'].indexOf(cfg.primary_endpoint) < 0) cfg.primary_endpoint = 'stage';
  if (cfg.snapshot_date === null) cfg.snapshot_date = today !== undefined ? today : Math.floor(Date.now() / MS_DAY);
  return cfg;
}

function endpointDefs(cfg) {
  var label = cfg.next_stage_label;
  return [
    { key: 'stage', label: 'Reached ' + label, maturity: cfg.maturity.stage },
    { key: 'qualified', label: 'Qualified by any route (' + label + ' OR via call)', maturity: cfg.maturity.qualified },
    { key: 'proposal', label: 'Proposal', maturity: cfg.maturity.proposal },
    { key: 'won', label: 'Won', maturity: cfg.maturity.won }
  ];
}

// ───────────────────────── events ──────────────────────────────────────────

/**
 * header: the Events header row; rows: the data rows (any cell types).
 * Returns {subjects, problems} where each subject carries day numbers.
 */
function parseEvents(header, rows, cfg) {
  var idx = {};
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (h) idx[h] = i;
  }
  var problems = [];
  var missing = EVENT_COLUMNS.filter(function (c) {
    return idx[c] === undefined && ['subject_id', 'arm', 'offered_at'].indexOf(c) >= 0;
  });
  if (missing.length) {
    problems.push({ check: 'Events header', status: 'FAIL', value: missing.join(', '), note: 'required column(s) missing' });
    return { subjects: [], problems: problems };
  }
  var cell = function (r, c) { return idx[c] === undefined ? '' : r[idx[c]]; };
  var seen = {}, dup = 0, badArm = 0, noOffer = 0, badSource = 0, future = 0, censored = 0;
  var subjects = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var id = String(cell(row, 'subject_id') || '').trim();
    if (!id) continue;                                   // blank line
    var arm = String(cell(row, 'arm') || '').trim().toLowerCase();
    var offered = toDay(cell(row, 'offered_at'));
    if (ARMS.indexOf(arm) < 0) { badArm++; continue; }
    if (offered === null) { noOffer++; continue; }
    if (offered > cfg.snapshot_date) { future++; continue; }     // not observable at the snapshot
    if (seen[id]) { dup++; continue; }
    seen[id] = true;
    var src = String(cell(row, 'assignment_source') || 'randomizer').trim().toLowerCase() || 'randomizer';
    if (SOURCES.indexOf(src) < 0) { badSource++; src = 'manual'; }
    var s = {
      id: id, arm: arm, offered: offered, source: src,
      channel: String(cell(row, 'channel') || '').trim() || '(none)',
      segment: String(cell(row, 'segment') || '').trim() || '(none)',
      call_booked: toDay(cell(row, 'call_booked_at')),
      call_held: toDay(cell(row, 'call_held_at')),
      stage: toDay(cell(row, 'stage_at')),
      qualified_raw: toDay(cell(row, 'qualified_at')),
      proposal: toDay(cell(row, 'proposal_at')),
      won: toDay(cell(row, 'won_at')),
      revenue: toNum(cell(row, 'revenue'), 0),
      prior: false
    };
    // Outcome gating: anything dated before the offer is prior engagement, not an outcome;
    // anything dated after the snapshot has not happened yet from the snapshot's point of view.
    ['call_booked', 'call_held', 'stage', 'qualified_raw', 'proposal', 'won'].forEach(function (k) {
      if (s[k] !== null && s[k] < s.offered) { s.prior = true; s[k] = null; }
      else if (s[k] !== null && s[k] > cfg.snapshot_date) { s[k] = null; censored++; }
    });
    // "qualified by any route" = the shared next stage OR a qualification reached via the call.
    s.qualified = (s.stage !== null && s.qualified_raw !== null) ? Math.min(s.stage, s.qualified_raw)
      : (s.stage !== null ? s.stage : s.qualified_raw);
    s.age = cfg.snapshot_date - s.offered;
    subjects.push(s);
  }
  if (dup) problems.push({ check: 'Duplicate subject_id', status: 'WARN', value: dup, note: 'later duplicates dropped; one row per subject' });
  if (badArm) problems.push({ check: 'Unknown arm', status: 'WARN', value: badArm, note: 'rows dropped; arm must be call or skip' });
  if (noOffer) problems.push({ check: 'Missing offered_at', status: 'WARN', value: noOffer, note: 'rows dropped' });
  if (badSource) problems.push({ check: 'Unknown assignment_source', status: 'WARN', value: badSource, note: 'treated as manual; use randomizer / auto / manual' });
  if (future) problems.push({ check: 'Offers after the snapshot date', status: 'INFO', value: future, note: 'dropped: snapshot_date = ' + dayToIso(cfg.snapshot_date) });
  if (censored) problems.push({ check: 'Outcomes after the snapshot date', status: 'INFO', value: censored, note: 'blanked for this read; they count once the snapshot moves past them' });
  return { subjects: subjects, problems: problems };
}

// ───────────────────────── helpers ─────────────────────────────────────────

function pct(x, digits) {
  if (x === null || x === undefined || isNaN(x)) return '';
  return (100 * x).toFixed(digits === undefined ? 2 : digits) + '%';
}
function pp(x, digits) {
  if (x === null || x === undefined || isNaN(x)) return '';
  var v = (100 * x).toFixed(digits === undefined ? 2 : digits);
  return (x > 0 ? '+' : '') + v + ' pp';
}
function fmtP(p) { return p === null ? '' : (p < 0.001 ? '<0.001' : p.toFixed(3)); }
function ciText(ci, digits) { return pct(ci[0], digits) + ' to ' + pct(ci[1], digits); }
function byArm(subjects, arm) { return subjects.filter(function (s) { return s.arm === arm; }); }

/** Counts for one endpoint on one population: mature n, converted within window, to-date. */
function endpointCounts(pop, key, maturityDays) {
  var mature = pop.filter(function (s) { return s.age >= maturityDays; });
  var within = mature.filter(function (s) { return s[key] !== null && (s[key] - s.offered) <= maturityDays; }).length;
  var toDate = pop.filter(function (s) { return s[key] !== null; }).length;
  return { offered: pop.length, mature: mature.length, within: within, toDate: toDate,
    rate: mature.length ? within / mature.length : null,
    rateToDate: pop.length ? toDate / pop.length : null };
}

function population(subjects, cfg) {
  return cfg.exclude_prior ? subjects.filter(function (s) { return !s.prior; }) : subjects;
}

// ───────────────────────── readout ─────────────────────────────────────────

function buildReadout(subjects, cfg, checksSummary) {
  var pop = population(subjects, cfg);
  var eps = endpointDefs(cfg);
  var rows = [];
  rows.push([cfg.test_name + ' — readout', 'snapshot ' + dayToIso(cfg.snapshot_date),
    'subjects ' + pop.length + (cfg.exclude_prior ? ' (prior engagement excluded)' : ''),
    checksSummary || '']);
  rows.push([]);
  rows.push(['Endpoint', 'Arm', 'Offered', 'Mature n', 'Converted within window', 'Rate (mature)', '95% CI', 'Converted to date', 'Rate to date', 'Window (days)']);
  var result = {};
  eps.forEach(function (ep) {
    var c = endpointCounts(byArm(pop, 'call'), ep.key, ep.maturity);
    var k = endpointCounts(byArm(pop, 'skip'), ep.key, ep.maturity);
    result[ep.key] = { call: c, skip: k };
    [['call', c], ['skip', k]].forEach(function (pair) {
      var x = pair[1];
      rows.push([ep.label, pair[0], x.offered, x.mature, x.within, pct(x.rate), x.mature ? ciText(wilson(x.within, x.mature)) : '',
        x.toDate, pct(x.rateToDate), ep.maturity]);
    });
    var p = (c.mature && k.mature) ? fisher(k.within, k.mature - k.within, c.within, c.mature - c.within) : null;
    var diff = (c.mature && k.mature) ? (k.rate - c.rate) : null;
    var ci = (c.mature && k.mature) ? diffCI(k.within, k.mature, c.within, c.mature) : [0, 0];
    var verdict = '';
    if (p === null) verdict = 'no mature subjects in one arm yet';
    else if (p < cfg.alpha) verdict = 'significant: ' + (diff > 0 ? 'skip' : 'call') + ' higher';
    else verdict = 'no significant difference';
    result[ep.key].p = p; result[ep.key].diff = diff; result[ep.key].ci = ci;
    rows.push([ep.label, 'skip − call', '', '', '', pp(diff), p === null ? '' : ciText(ci), 'Fisher p ' + fmtP(p), verdict, '']);
    rows.push([]);
  });

  // Primary endpoint: non-inferiority when not significant
  var pk = cfg.primary_endpoint;
  var prim = result[pk];
  rows.push(['Primary endpoint: ' + eps.filter(function (e) { return e.key === pk; })[0].label]);
  if (prim.p !== null && prim.p >= cfg.alpha) {
    var ni = nonInferiority(prim.skip.within, prim.skip.mature, prim.call.within, prim.call.mature, cfg.ni_margin, cfg.alpha);
    result.ni = ni;
    rows.push(['Non-inferiority (skip within ' + pct(cfg.ni_margin, 1) + ' of call)',
      ni.nonInferior ? 'NON-INFERIOR' : 'NOT SHOWN',
      'difference ' + pp(ni.diff) + ', one-sided lower bound ' + pp(ni.lower),
      ni.nonInferior ? 'skipping the call does not lose more than the margin' :
        'the data cannot rule out a loss larger than the margin: a null result is not parity']);
    var pw = powerAt(cfg.baseline_rate, cfg.baseline_rate + cfg.mde, prim.call.mature, prim.skip.mature, cfg.alpha);
    rows.push(['Power to detect the planned MDE at current mature n', pct(pw, 0), 'mature n: call ' + prim.call.mature + ', skip ' + prim.skip.mature,
      pw < 0.8 ? 'underpowered: keep enrolling or wait for maturity' : 'adequately powered']);
  } else if (prim.p !== null) {
    rows.push(['Significant on the primary endpoint', 'Fisher p ' + fmtP(prim.p), pp(prim.diff), 'read the other endpoints before deciding: see docs/traps.md, trap 1']);
  }
  rows.push([]);

  // By segment, primary endpoint (mix check)
  var segs = {};
  pop.forEach(function (s) { segs[s.segment] = true; });
  var segNames = Object.keys(segs).sort();
  if (segNames.length > 1) {
    rows.push(['By segment — primary endpoint, mature subjects only']);
    rows.push(['Segment', 'call mature n', 'call rate', 'skip mature n', 'skip rate', 'Fisher p', 'share of call arm', 'share of skip arm']);
    var callN = byArm(pop, 'call').length, skipN = byArm(pop, 'skip').length;
    var m = cfg.maturity[pk];
    segNames.forEach(function (sg) {
      var sub = pop.filter(function (s) { return s.segment === sg; });
      var c = endpointCounts(byArm(sub, 'call'), pk, m), k = endpointCounts(byArm(sub, 'skip'), pk, m);
      var p = (c.mature && k.mature) ? fisher(k.within, k.mature - k.within, c.within, c.mature - c.within) : null;
      rows.push([sg, c.mature, pct(c.rate), k.mature, pct(k.rate), fmtP(p),
        pct(callN ? c.offered / callN : 0, 0), pct(skipN ? k.offered / skipN : 0, 0)]);
    });
    rows.push([]);
  }
  return { rows: rows, result: result, population: pop };
}

// ───────────────────────── maturation ──────────────────────────────────────

/** Share of `pop` converting on `key` within `age` days, using only subjects observed that long. */
function curvePoint(pop, key, age) {
  var exposed = pop.filter(function (s) { return s.age >= age; });
  var conv = exposed.filter(function (s) { return s[key] !== null && (s[key] - s.offered) <= age; }).length;
  return { exposed: exposed.length, conv: conv, rate: exposed.length ? conv / exposed.length : null };
}

/** Build an interpolating function age -> expected rate from a mature pool. */
function curveFn(pool, key, checkpoints, maturityDays) {
  var pts = [[0, 0]];
  checkpoints.concat([maturityDays]).sort(function (a, b) { return a - b; }).forEach(function (a) {
    if (a > maturityDays) return;
    var cp = curvePoint(pool, key, a);
    if (cp.rate !== null) pts.push([a, cp.rate]);
  });
  return function (age) {
    if (age <= 0) return 0;
    for (var i = 1; i < pts.length; i++) {
      if (age <= pts[i][0]) {
        var a0 = pts[i - 1][0], r0 = pts[i - 1][1], a1 = pts[i][0], r1 = pts[i][1];
        return r0 + (r1 - r0) * (age - a0) / (a1 - a0);
      }
    }
    return pts[pts.length - 1][1];
  };
}

function buildMaturation(subjects, cfg) {
  var pop = population(subjects, cfg);
  var eps = endpointDefs(cfg);
  var rows = [];
  rows.push([cfg.test_name + ' — maturation', 'snapshot ' + dayToIso(cfg.snapshot_date)]);
  rows.push(['A. Conversion by age since offer. Each cell counts only subjects observed at least that many days (exposure-correct denominators).']);
  rows.push([]);
  eps.forEach(function (ep) {
    rows.push([ep.label]);
    rows.push(['Age (days)', 'call exposed n', 'call converted', 'call rate', 'skip exposed n', 'skip converted', 'skip rate', 'skip − call']);
    cfg.age_checkpoints.forEach(function (a) {
      var c = curvePoint(byArm(pop, 'call'), ep.key, a), k = curvePoint(byArm(pop, 'skip'), ep.key, a);
      rows.push([a, c.exposed, c.conv, pct(c.rate), k.exposed, k.conv, pct(k.rate),
        (c.rate !== null && k.rate !== null) ? pp(k.rate - c.rate) : '']);
    });
    rows.push([]);
  });

  // B. Young cohorts scorecard on the primary endpoint
  var pk = cfg.primary_endpoint, mdays = cfg.maturity[pk];
  rows.push(['B. Young cohorts (offer week) on the primary endpoint: observed vs expected at each subject\'s own age.']);
  rows.push(['Expected = the arm\'s own maturation curve, built from subjects observed for the full window, evaluated at each subject\'s age and summed.']);
  rows.push(['Week', 'Arm', 'n', 'youngest age', 'Observed', 'Expected at age', 'Observed rate', '95% CI of observed', 'Expected rate', 'Status', 'Curve basis n']);
  var scorecard = [];
  ARMS.forEach(function (arm) {
    var armPop = byArm(pop, arm);
    var mature = armPop.filter(function (s) { return s.age >= mdays; });
    var basis = mature, basisNote = '';
    if (mature.length < 30) { basis = pop.filter(function (s) { return s.age >= mdays; }); basisNote = ' (pooled arms)'; }
    if (basis.length < 30) return;
    var f = curveFn(basis, pk, cfg.age_checkpoints, mdays);
    var weeks = {};
    armPop.forEach(function (s) { var w = weekStart(s.offered); (weeks[w] = weeks[w] || []).push(s); });
    Object.keys(weeks).map(Number).sort().forEach(function (w) {
      var ws = weeks[w];
      var youngest = Math.min.apply(null, ws.map(function (s) { return s.age; }));
      if (youngest >= mdays) return;                       // fully mature: read it in the Readout
      var observed = ws.filter(function (s) { return s[pk] !== null; }).length;
      var expected = ws.reduce(function (acc, s) { return acc + f(Math.min(s.age, mdays)); }, 0);
      var ci = wilson(observed, ws.length);
      var expRate = expected / ws.length;
      var status = ws.length < MIN_WEEK_N ? 'too few' : (expRate < ci[0] ? 'ahead' : (expRate > ci[1] ? 'behind' : 'on pace'));
      scorecard.push({ week: w, arm: arm, n: ws.length, observed: observed, expected: expected, status: status });
      rows.push([dayToIso(w), arm, ws.length, youngest, observed, expected.toFixed(1), pct(observed / ws.length, 1), ciText(ci, 1), pct(expRate, 1), status, basis.length + basisNote]);
    });
  });
  if (!scorecard.length) rows.push(['(no young cohorts, or fewer than 30 mature subjects to build a curve from)']);
  return { rows: rows, scorecard: scorecard };
}

// ───────────────────────── checks ──────────────────────────────────────────

function buildChecks(subjects, parseProblems, cfg) {
  var all = subjects, pop = population(subjects, cfg);
  var pk = cfg.primary_endpoint, mdays = cfg.maturity[pk];
  var checks = parseProblems.slice();
  var add = function (check, status, value, note) { checks.push({ check: check, status: status, value: value, note: note }); };

  // 1. Prior engagement
  var prior = all.filter(function (s) { return s.prior; }).length;
  add('Prior engagement before the offer', prior ? 'INFO' : 'OK', prior,
    prior ? (cfg.exclude_prior ? 'excluded from every table (exclude_prior = true)' : 'kept: outcomes dated before the offer were blanked') : 'none');

  // 2. Window
  if (cfg.start_date !== null || cfg.freeze_date !== null) {
    var out = pop.filter(function (s) {
      return (cfg.start_date !== null && s.offered < cfg.start_date) || (cfg.freeze_date !== null && s.offered > cfg.freeze_date);
    }).length;
    add('Offers outside start/freeze window', out ? 'WARN' : 'OK', out,
      out ? 'offers before start_date or after freeze_date are in the tables; filter them or fix the dates' : 'all offers inside the window');
  }

  // 3. Arm balance vs planned split
  var nCall = byArm(pop, 'call').length, nSkip = byArm(pop, 'skip').length;
  var pBal = (nCall + nSkip) ? binomTest(nSkip, nCall + nSkip, cfg.planned_split_skip) : 1;
  add('Arm balance vs planned split', pBal < 0.05 ? 'WARN' : 'OK',
    'call ' + nCall + ' / skip ' + nSkip + ' (planned skip share ' + pct(cfg.planned_split_skip, 0) + ')',
    pBal < 0.05 ? 'exact binomial p ' + fmtP(pBal) + ': the split is not what was planned. Something assigns arms besides the randomizer' : 'exact binomial p ' + fmtP(pBal));

  // 4. Assignment source mix per arm
  var mix = {};
  ARMS.forEach(function (a) { mix[a] = {}; SOURCES.forEach(function (s) { mix[a][s] = 0; }); });
  pop.forEach(function (s) { mix[s.arm][s.source]++; });
  var autoCall = mix.call.auto + mix.call.manual, autoSkip = mix.skip.auto + mix.skip.manual;
  var pMix = (nCall && nSkip) ? fisher(autoSkip, nSkip - autoSkip, autoCall, nCall - autoCall) : 1;
  add('Non-randomized assignment share per arm', pMix < 0.05 ? 'FAIL' : 'OK',
    'call ' + pct(nCall ? autoCall / nCall : 0, 1) + ' (' + autoCall + ') / skip ' + pct(nSkip ? autoSkip / nSkip : 0, 1) + ' (' + autoSkip + ')',
    pMix < 0.05 ? 'Fisher p ' + fmtP(pMix) + ': an automation or a person routes subjects into one arm more than the other. Read the randomizer-only line below, not the pooled readout' : 'auto/manual assignments are balanced across arms (Fisher p ' + fmtP(pMix) + ')');

  // 5. Randomizer-only readout on the primary endpoint vs pooled
  var rnd = pop.filter(function (s) { return s.source === 'randomizer'; });
  var rc = endpointCounts(byArm(rnd, 'call'), pk, mdays), rk = endpointCounts(byArm(rnd, 'skip'), pk, mdays);
  var pc = endpointCounts(byArm(pop, 'call'), pk, mdays), pkk = endpointCounts(byArm(pop, 'skip'), pk, mdays);
  var pRnd = (rc.mature && rk.mature) ? fisher(rk.within, rk.mature - rk.within, rc.within, rc.mature - rc.within) : null;
  var pPool = (pc.mature && pkk.mature) ? fisher(pkk.within, pkk.mature - pkk.within, pc.within, pc.mature - pc.within) : null;
  var sigRnd = pRnd !== null && pRnd < cfg.alpha, sigPool = pPool !== null && pPool < cfg.alpha;
  var dRnd = (rc.rate !== null && rk.rate !== null) ? rk.rate - rc.rate : null;
  var dPool = (pc.rate !== null && pkk.rate !== null) ? pkk.rate - pc.rate : null;
  var gap = (dRnd !== null && dPool !== null) ? Math.abs(dPool - dRnd) : 0;
  var disagree = (sigRnd !== sigPool) || gap > cfg.mde / 3;
  add('Primary endpoint, randomizer-only subjects', disagree ? 'WARN' : 'OK',
    'call ' + rc.within + '/' + rc.mature + ' = ' + pct(rc.rate) + ' vs skip ' + rk.within + '/' + rk.mature + ' = ' + pct(rk.rate) + ', ' + pp(dRnd) + ', Fisher p ' + fmtP(pRnd),
    disagree ? 'the pooled readout says ' + pp(dPool) + ' (p ' + fmtP(pPool) + '); the randomized subset says ' + pp(dRnd) + '. The gap is a selection effect, not the treatment. Decide on this line' :
      'agrees with the pooled readout (' + pp(dPool) + ', p ' + fmtP(pPool) + ')');

  // 6. Endpoint trap: the call route that bypasses the next stage
  var callArm = byArm(pop, 'call');
  var viaCallOnly = callArm.filter(function (s) { return s.qualified_raw !== null && s.stage === null; }).length;
  var qualAny = callArm.filter(function (s) { return s.qualified !== null; }).length;
  add('Call arm: qualified without reaching the ' + cfg.next_stage_label, viaCallOnly ? 'INFO' : 'OK',
    viaCallOnly + ' of ' + qualAny + ' qualified',
    viaCallOnly ? 'the call opens a second route. Scoring only "reached ' + cfg.next_stage_label + '" undercounts the call arm by construction: read both endpoints' :
      'no bypass route observed (or qualified_at is not filled in)');
  var stageAfterCall = callArm.filter(function (s) { return s.stage !== null && s.call_held !== null && s.call_held <= s.stage; }).length;
  var stageCall = callArm.filter(function (s) { return s.stage !== null; }).length;
  add('Call arm: ' + cfg.next_stage_label + ' reached after a held call', 'INFO',
    stageAfterCall + ' of ' + stageCall,
    stageCall ? 'how often the call precedes the next stage in the control arm (requires call_held_at)' : 'no next-stage conversions in the call arm yet');

  // 7. Power
  var pw = powerAt(cfg.baseline_rate, cfg.baseline_rate + cfg.mde, pc.mature, pkk.mature, cfg.alpha);
  add('Power at current mature n (primary endpoint, planned MDE)', pw < 0.8 ? 'WARN' : 'OK', pct(pw, 0),
    'mature n: call ' + pc.mature + ', skip ' + pkk.mature + '; planned: ' + sampleSizeSuperiority(cfg.baseline_rate, cfg.baseline_rate + cfg.mde, cfg.alpha, cfg.power) + ' per arm');

  // 8. Maturity
  var young = pop.filter(function (s) { return s.age < mdays; }).length;
  add('Subjects younger than the primary window', young ? 'INFO' : 'OK', young + ' of ' + pop.length,
    young ? 'they are in "to date" columns only. Rates on the mature columns are the comparable ones' : 'every subject is mature on the primary endpoint');

  var rows = [[cfg.test_name + ' — checks', 'snapshot ' + dayToIso(cfg.snapshot_date)], [], ['Check', 'Status', 'Value', 'Note']];
  checks.forEach(function (c) { rows.push([c.check, c.status, c.value, c.note]); });
  return { rows: rows, checks: checks };
}

// ───────────────────────── plan ────────────────────────────────────────────

function buildPlan(cfg) {
  var p1 = cfg.baseline_rate, p2 = cfg.baseline_rate + cfg.mde;
  var nSup = sampleSizeSuperiority(p1, p2, cfg.alpha, cfg.power);
  var nNI = sampleSizeNonInferiority(p1, cfg.ni_margin, cfg.alpha, cfg.power);
  var perWeek = cfg.offers_per_week > 0 ? cfg.offers_per_week : null;
  var wSup = perWeek ? Math.ceil(2 * nSup / perWeek) : null;
  var wNI = perWeek ? Math.ceil(2 * nNI / perWeek) : null;
  var start = cfg.start_date;
  var freeze = cfg.freeze_date !== null ? cfg.freeze_date : (start !== null && wSup ? start + 7 * wSup : null);
  var rows = [];
  rows.push([cfg.test_name + ' — plan']);
  rows.push([]);
  rows.push(['Item', 'Value', 'Note']);
  rows.push(['Primary endpoint', cfg.primary_endpoint === 'stage' ? 'reached ' + cfg.next_stage_label : 'qualified by any route', 'the shared step both arms can reach']);
  rows.push(['Control baseline (call arm)', pct(p1), 'your historical rate from offer to the primary endpoint']);
  rows.push(['Minimum detectable effect', pp(cfg.mde), 'absolute; smaller effects will read as "no difference"']);
  rows.push(['Alpha / power', cfg.alpha + ' / ' + cfg.power, 'two-sided for superiority, one-sided for non-inferiority']);
  rows.push([]);
  rows.push(['Subjects per arm to detect the MDE', nSup, 'total ' + 2 * nSup]);
  rows.push(['Subjects per arm to show non-inferiority within ' + pp(cfg.ni_margin), nNI, 'total ' + 2 * nNI + '; this is the question "can we drop the call without losing"']);
  rows.push(['Weeks to enrol at ' + cfg.offers_per_week + ' offers/week', wSup === null ? '' : wSup + ' (detect) / ' + wNI + ' (non-inferiority)', 'offers, not leads: a subject enters when the offer is made']);
  rows.push([]);
  rows.push(['Start date', dayToIso(start), start === null ? 'set start_date in Config' : '']);
  rows.push(['Freeze date (entry closes)', dayToIso(freeze), 'after this date new subjects go to a new version, never into this one']);
  if (freeze !== null) {
    rows.push(['First read: primary endpoint', dayToIso(freeze + cfg.maturity[cfg.primary_endpoint]), 'freeze + ' + cfg.maturity[cfg.primary_endpoint] + ' days; every subject has had the full window']);
    rows.push(['Read: proposal', dayToIso(freeze + cfg.maturity.proposal), 'freeze + ' + cfg.maturity.proposal + ' days']);
    rows.push(['Read: won', dayToIso(freeze + cfg.maturity.won), 'freeze + ' + cfg.maturity.won + ' days']);
  }
  rows.push([]);
  rows.push(['What this test can read at the planned n']);
  rows.push(['Endpoint', 'Power at ' + nSup + ' per arm', 'Reading']);
  rows.push(['primary', pct(powerAt(p1, p2, nSup, nSup, cfg.alpha), 0), 'designed for this']);
  var unreadable = [];
  [['proposal', cfg.baseline_proposal_rate], ['won', cfg.baseline_won_rate]].forEach(function (pair) {
    if (pair[1] === null) { rows.push([pair[0], '', 'set baseline_' + pair[0] + '_rate in Config to see whether this endpoint is readable']); return; }
    var b = pair[1], pw = powerAt(b, b * (1 + cfg.mde / p1), nSup, nSup, cfg.alpha);
    if (pw < 0.5) unreadable.push(pair[0]);
    rows.push([pair[0], pct(pw, 0), pw < 0.5 ? 'NOT readable at this volume: a difference here will look like noise either way' : (pw < 0.8 ? 'weak: direction only' : 'readable')]);
  });
  rows[1] = ['Verdict', planVerdict_(cfg, wSup, wNI, unreadable)];
  rows.push([]);
  rows.push(['Before launch (each line is a mistake already made once; see docs/traps.md)']);
  [
    '1. Both arms end at the same next stage. Name it, and name the second route the call opens (qualified_at).',
    '2. One randomizer, at one point, before any human or automation touches the subject.',
    '3. Every automation that can deliver the offer (auto-replies, sequences, chatbots) is arm-aware or switched off.',
    '4. Subjects who already engaged (a deal, a form, a call) before the offer are excluded, not reassigned.',
    '5. Entry closes on the freeze date. Later subjects start a new version with its own tabs.',
    '6. The first read happens at freeze + window, not when the numbers look interesting.',
    '7. A null result is reported with its CI and the non-inferiority verdict, never as "no difference".'
  ].forEach(function (l) { rows.push([l]); });
  return { rows: rows, nSup: nSup, nNI: nNI, weeks: wSup, freeze: freeze };
}

/** One sentence for the top of the Plan tab: can this test be run at this volume, and on what. */
function planVerdict_(cfg, wSup, wNI, unreadable) {
  if (wSup === null) return 'Set offers_per_week in Config to see how long the test takes.';
  var weeks = Math.max(wSup, wNI);
  var head = weeks <= 13 ? 'Feasible: ' : (weeks <= 26 ? 'Long: ' : 'Not practical at this volume: ');
  var text = head + weeks + ' weeks of enrolment at ' + cfg.offers_per_week + ' offers/week, then ' +
    cfg.maturity[cfg.primary_endpoint] + ' days until the first read.';
  if (weeks > 26) text += ' Raise the MDE, add volume, or decide without a test and say so.';
  if (unreadable.length) text += ' Decide on ' + cfg.next_stage_label + '; ' + unreadable.join(' and ') + ' will not be readable.';
  return text;
}

// ───────────────────────── entry point ─────────────────────────────────────

/** Everything in one call. configRows: [[k, v]...]; header + rows from Events. */
function runAll(configRows, header, rows, today) {
  var cfg = parseConfig(configRows, today);
  var parsed = parseEvents(header, rows, cfg);
  var checks = buildChecks(parsed.subjects, parsed.problems, cfg);
  var nFail = checks.checks.filter(function (c) { return c.status === 'FAIL'; }).length;
  var nWarn = checks.checks.filter(function (c) { return c.status === 'WARN'; }).length;
  var summary = (nFail || nWarn) ? 'Checks: ' + nFail + ' FAIL, ' + nWarn + ' WARN. Read the Checks tab before this one' : 'Checks: all OK';
  var readout = buildReadout(parsed.subjects, cfg, summary);
  var maturation = buildMaturation(parsed.subjects, cfg);
  var plan = buildPlan(cfg);
  return { cfg: cfg, subjects: parsed.subjects, readout: readout, maturation: maturation, checks: checks, plan: plan };
}

if (typeof module !== 'undefined') {
  module.exports = {
    ARMS: ARMS, SOURCES: SOURCES, EVENT_COLUMNS: EVENT_COLUMNS, CONFIG_DEFAULTS: CONFIG_DEFAULTS,
    toDay: toDay, dayToIso: dayToIso, weekStart: weekStart, parseConfig: parseConfig,
    parseEvents: parseEvents, endpointCounts: endpointCounts, curvePoint: curvePoint,
    buildReadout: buildReadout, buildMaturation: buildMaturation, buildChecks: buildChecks,
    buildPlan: buildPlan, runAll: runAll
  };
}
