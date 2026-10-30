const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const G = require('../examples/generate.js');

const DAY = 86400000;
const day = (iso) => Math.floor(Date.parse(iso) / DAY);

function configRows(over) {
  const base = {
    test_name: 'T', next_stage_label: 'questionnaire', primary_endpoint: 'stage',
    baseline_rate: '3%', mde: '2%', alpha: 0.05, power: 0.8, ni_margin: '1.5%',
    planned_split_skip: '50%', offers_per_week: 200, start_date: '2026-03-02',
    freeze_date: '2026-05-24', snapshot_date: '2026-07-15',
    maturity_stage_days: 30, maturity_qualified_days: 30, maturity_proposal_days: 45, maturity_won_days: 90,
    age_checkpoints: '7,14,21,30,45,60,90', exclude_prior: true,
    baseline_proposal_rate: '1.2%', baseline_won_rate: '0.3%'
  };
  Object.assign(base, over || {});
  return Object.entries(base);
}

function eventsFrom(rows) {
  const cols = Object.keys(rows[0]);
  return { header: cols, rows: rows.map(r => cols.map(c => r[c])) };
}

const SYN = G.generate({ seed: 7 });
const EV = eventsFrom(SYN);

test('date parsing accepts ISO strings, Date objects, sheet serials and dd.mm.yyyy', () => {
  const d = day('2026-03-02');
  assert.equal(E.toDay('2026-03-02'), d);
  assert.equal(E.toDay('2026-03-02 14:00:00'), d);
  assert.equal(E.toDay(new Date(2026, 2, 2)), d);
  assert.equal(E.toDay(46083), d);                 // Google Sheets serial for 2026-03-02
  assert.equal(E.toDay('02.03.2026'), d);
  assert.equal(E.toDay(''), null);
  assert.equal(E.toDay('not a date'), null);
  assert.equal(E.dayToIso(d), '2026-03-02');
  assert.equal(E.dayToIso(E.weekStart(day('2026-03-05'))), '2026-03-02'); // Thursday -> Monday
});

test('config parsing: percent strings, defaults, ni_margin falls back to mde', () => {
  const cfg = E.parseConfig(configRows({ ni_margin: '' }), day('2026-07-15'));
  assert.equal(cfg.baseline_rate, 0.03);
  assert.equal(cfg.mde, 0.02);
  assert.equal(cfg.ni_margin, 0.02);
  assert.equal(cfg.maturity.proposal, 45);
  assert.deepEqual(cfg.age_checkpoints, [7, 14, 21, 30, 45, 60, 90]);
  assert.equal(cfg.snapshot_date, day('2026-07-15'));
  const dflt = E.parseConfig([], day('2026-01-01'));
  assert.equal(dflt.primary_endpoint, 'stage');
  assert.equal(dflt.exclude_prior, true);
});

test('events parsing: gating, prior flag, dedup, censoring at snapshot', () => {
  const cfg = E.parseConfig(configRows({ snapshot_date: '2026-04-01' }), 0);
  const header = ['subject_id', 'arm', 'offered_at', 'assignment_source', 'stage_at', 'qualified_at', 'proposal_at'];
  const rows = [
    ['a', 'call', '2026-03-01', 'randomizer', '2026-03-10', '', ''],          // normal
    ['b', 'skip', '2026-03-01', '', '2026-02-01', '', ''],                     // prior engagement
    ['c', 'skip', '2026-03-01', 'auto', '', '2026-03-05', '2026-04-20'],       // proposal after snapshot
    ['a', 'call', '2026-03-02', 'randomizer', '', '', ''],                     // duplicate id
    ['d', 'other', '2026-03-01', '', '', '', ''],                              // bad arm
    ['e', 'call', '', '', '', '', ''],                                         // no offer
    ['f', 'call', '2026-05-01', 'randomizer', '', '', ''],                     // after snapshot
    ['', '', '', '', '', '', '']                                               // blank
  ];
  const out = E.parseEvents(header, rows, cfg);
  assert.equal(out.subjects.length, 3);
  const byId = Object.fromEntries(out.subjects.map(s => [s.id, s]));
  assert.equal(byId.a.stage - byId.a.offered, 9);
  assert.equal(byId.b.prior, true);
  assert.equal(byId.b.stage, null);
  assert.equal(byId.c.proposal, null, 'proposal after the snapshot is not yet observable');
  assert.equal(byId.c.qualified, byId.c.qualified_raw, 'qualified via call counts as qualified by any route');
  assert.equal(byId.a.source, 'randomizer');
  const names = out.problems.map(p => p.check);
  assert.ok(names.includes('Duplicate subject_id'));
  assert.ok(names.includes('Unknown arm'));
  assert.ok(names.includes('Missing offered_at'));
  assert.ok(names.includes('Offers after the snapshot date'));
  assert.ok(names.includes('Outcomes after the snapshot date'));
});

test('events parsing fails loudly when a required column is missing', () => {
  const cfg = E.parseConfig(configRows(), 0);
  const out = E.parseEvents(['subject_id', 'offered_at'], [['a', '2026-03-01']], cfg);
  assert.equal(out.subjects.length, 0);
  assert.equal(out.problems[0].status, 'FAIL');
});

test('synthetic data: the planted facts come out', () => {
  const out = E.runAll(configRows(), EV.header, EV.rows, day('2026-07-15'));
  const checks = Object.fromEntries(out.checks.checks.map(c => [c.check, c]));

  // ~2% prior engagement, excluded
  const prior = checks['Prior engagement before the offer'];
  assert.ok(prior.value > 20 && prior.value < 90, `prior=${prior.value}`);
  assert.equal(out.readout.population.length, out.subjects.length - prior.value);

  // the auto-reply routes only into skip -> balance WARN and source-mix FAIL
  assert.equal(checks['Arm balance vs planned split'].status, 'WARN');
  assert.equal(checks['Non-randomized assignment share per arm'].status, 'FAIL');

  // randomized subjects: equal true rates -> small observed difference
  const r = out.readout.result.stage;
  const rnd = out.readout.population.filter(s => s.source === 'randomizer');
  const c = E.endpointCounts(rnd.filter(s => s.arm === 'call'), 'stage', 30);
  const k = E.endpointCounts(rnd.filter(s => s.arm === 'skip'), 'stage', 30);
  assert.ok(Math.abs(c.rate - k.rate) < 0.012, `randomized diff ${k.rate - c.rate}`);
  // pooled skip rate is inflated by the auto-routed high-intent subjects
  assert.ok(r.skip.rate > k.rate, 'pooled skip rate should exceed the randomized skip rate');
  assert.equal(checks['Primary endpoint, randomizer-only subjects'].status, 'WARN');

  // the call arm has a second route that bypasses the next stage
  const bypass = checks['Call arm: qualified without reaching the questionnaire'];
  assert.ok(parseInt(bypass.value, 10) > 10, bypass.value);
  // ...and the call precedes the next stage most of the time in the call arm
  const after = checks['Call arm: questionnaire reached after a held call'];
  const m = String(after.value).match(/^(\d+) of (\d+)$/);
  assert.ok(m && (+m[1]) / (+m[2]) > 0.5, after.value);

  // on "qualified by any route" the call arm is at least as good as skip
  const q = out.readout.result.qualified;
  assert.ok(q.call.rate >= q.skip.rate - 0.005, `qualified call ${q.call.rate} vs skip ${q.skip.rate}`);

  // every subject is mature on the primary endpoint at this snapshot
  assert.equal(r.call.mature, r.call.offered);
  assert.equal(r.skip.mature, r.skip.offered);
});

test('plan: sample size, weeks, read dates, readability of secondary endpoints', () => {
  const cfg = E.parseConfig(configRows(), day('2026-07-15'));
  const plan = E.buildPlan(cfg);
  assert.ok(Math.abs(plan.nSup - 1506) <= 2);
  assert.equal(plan.weeks, Math.ceil(2 * plan.nSup / 200));
  assert.equal(E.dayToIso(plan.freeze), '2026-05-24');
  const flat = plan.rows.map(r => r.join(' | ')).join('\n');
  assert.ok(flat.includes('First read: primary endpoint | 2026-06-23'));
  assert.ok(flat.includes('Read: won | 2026-08-22'));
  assert.ok(/won \| \d+% \| NOT readable/.test(flat), 'won must be flagged as not readable at this volume');
});

test('mid-test read: young cohorts get a scorecard, future rows are dropped', () => {
  const out = E.runAll(configRows({ snapshot_date: '2026-04-20' }), EV.header, EV.rows, day('2026-04-20'));
  assert.ok(out.subjects.every(s => s.age >= 0));
  assert.ok(out.maturation.scorecard.length > 0, 'scorecard should have young weeks');
  assert.ok(out.maturation.scorecard.every(w => ['ahead', 'on pace', 'behind', 'too few'].includes(w.status)));
  const r = out.readout.result.stage;
  assert.ok(r.call.mature < r.call.offered, 'some subjects are younger than the window');
  const checks = Object.fromEntries(out.checks.checks.map(c => [c.check, c]));
  assert.equal(checks['Subjects younger than the primary window'].status, 'INFO');
});

test('readout verdict text: significant vs null with non-inferiority', () => {
  // build a tiny dataset with a clear skip win
  const header = ['subject_id', 'arm', 'offered_at', 'stage_at'];
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push(['c' + i, 'call', '2026-01-01', i < 8 ? '2026-01-10' : '']);
  for (let i = 0; i < 400; i++) rows.push(['s' + i, 'skip', '2026-01-01', i < 40 ? '2026-01-10' : '']);
  const out = E.runAll(configRows({ snapshot_date: '2026-03-01', start_date: '2026-01-01', freeze_date: '2026-01-31' }), header, rows, day('2026-03-01'));
  const flat = out.readout.rows.map(r => r.join(' | ')).join('\n');
  assert.ok(flat.includes('significant: skip higher'));
  assert.ok(flat.includes('Significant on the primary endpoint'));
});

test('plan verdict says feasible, long or not practical from the enrolment weeks', () => {
  const v = (over) => E.buildPlan(E.parseConfig(configRows(Object.assign({ freeze_date: '' }, over)))).rows[1][1];
  assert.match(v({ baseline_rate: '10%', mde: '5%', ni_margin: '', offers_per_week: 300 }), /^Feasible: /);
  assert.match(v({ offers_per_week: 200 }), /^Long: 16 weeks .* 16 weeks to show/);
  assert.match(v({ offers_per_week: 50 }), /^Not practical at this volume: 61 weeks .* 64 weeks .*raise the MDE or widen ni_margin/);
  assert.match(v({ ni_margin: '0.5%', offers_per_week: 200 }), /^Not practical.*: 16 weeks .*To shorten it: widen ni_margin,/);
  assert.match(v({ offers_per_week: 200 }), /Decide on questionnaire; proposal and won will not be readable/);
  assert.match(v({ offers_per_week: 200, primary_endpoint: 'qualified' }), /Decide on qualified by any route;/);
});
