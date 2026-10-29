#!/usr/bin/env node
/**
 * generate.js — write the synthetic example dataset to a CSV.
 * The generator itself lives in src/synthetic.js (shared with the Sheet).
 *
 * Usage: node examples/generate.js [out.csv] [seed]
 */
const fs = require('fs');
const path = require('path');
const { generateSynthetic } = require('../src/synthetic.js');

function toCsv(rows) {
  const cols = Object.keys(rows[0]);
  return [cols.join(',')].concat(rows.map(r => cols.map(c => r[c]).join(','))).join('\n') + '\n';
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, 'events.csv');
  const seed = Number(process.argv[3] || 7);
  const rows = generateSynthetic({ seed });
  fs.writeFileSync(out, toCsv(rows));
  console.log(`wrote ${rows.length} subjects to ${out}`);
}

module.exports = { generate: generateSynthetic, toCsv };
