#!/usr/bin/env node
/**
 * plan.js — step 0: can you run this test at your volume? Three numbers in, the Plan tab out.
 * No data and no Google account needed.
 *
 *   node examples/plan.js --baseline 3% --mde 2% --per-week 200
 *   node examples/plan.js --baseline 3% --mde 2% --per-week 200 --proposal 1.2% --won 0.3%
 *
 * Any other Config key works the same way: --ni_margin 1.5% --start_date 2026-03-02
 */
const E = require('../src/engine.js');

const ALIASES = { baseline: 'baseline_rate', 'per-week': 'offers_per_week', proposal: 'baseline_proposal_rate', won: 'baseline_won_rate' };
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node examples/plan.js --baseline 3% --mde 2% --per-week 200 [--proposal 1.2%] [--won 0.3%]');
  process.exit(args.length ? 0 : 1);
}
const rows = [];
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, '');
  if (args[i + 1] === undefined) { console.error(`Missing value for ${args[i]}`); process.exit(1); }
  const name = ALIASES[key] || key;
  if (!(name in E.CONFIG_DEFAULTS)) { console.error(`Unknown option ${args[i]}`); process.exit(1); }
  rows.push([name, args[i + 1]]);
}
const plan = E.buildPlan(E.parseConfig(rows));
plan.rows.forEach(r => console.log(r.filter(c => c !== '' && c !== undefined).join('  |  ')));
