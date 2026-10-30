#!/usr/bin/env node
/**
 * demo.js — run the whole kit on the example data and print the four tabs to the
 * terminal. No Google account needed.
 *
 *   node examples/demo.js                 # uses examples/config.csv + examples/events.csv
 *   node examples/demo.js my-config.csv my-events.csv
 *   node examples/demo.js my-config.csv my-events.csv --md   # full-width Markdown tables, nothing cut
 */
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.length);
  return lines.map(l => {
    const out = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

function printRows(rows) {
  const widths = [];
  rows.forEach(r => r.forEach((c, i) => { widths[i] = Math.min(42, Math.max(widths[i] || 0, String(c).length)); }));
  rows.forEach(r => {
    if (!r.length) { console.log(''); return; }
    console.log(r.map((c, i) => String(c).slice(0, 42).padEnd(widths[i])).join('  ').trimEnd());
  });
}

function printMarkdown(rows) {
  const cell = c => String(c === undefined || c === null ? '' : c).replace(/\|/g, '\\|');
  let table = [];
  const flush = () => {
    if (!table.length) return;
    const n = Math.max(...table.map(r => r.length));
    const pad = r => { const x = r.map(cell); while (x.length < n) x.push(''); return '| ' + x.join(' | ') + ' |'; };
    console.log(pad(table[0]));
    console.log('|' + ' --- |'.repeat(n));
    table.slice(1).forEach(r => console.log(pad(r)));
    console.log('');
    table = [];
  };
  rows.forEach(r => {
    if (!r.length || r.every(c => c === '')) { flush(); return; }
    if (r.length === 1 || r.slice(1).every(c => c === '')) { flush(); console.log(cell(r[0]) + '\n'); return; }
    table.push(r);
  });
  flush();
}

const md = process.argv.includes('--md');
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const cfgFile = files[0] || path.join(__dirname, 'config.csv');
const evFile = files[1] || path.join(__dirname, 'events.csv');
if (!fs.existsSync(evFile)) {
  console.error(`${evFile} not found. Run: node examples/generate.js`);
  process.exit(1);
}
const config = readCsv(cfgFile);
const events = readCsv(evFile);
const out = E.runAll(config, events[0], events.slice(1));
for (const [name, tab] of [['PLAN', out.plan], ['READOUT', out.readout], ['MATURATION', out.maturation], ['CHECKS', out.checks]]) {
  if (md) { console.log('## ' + name + '\n'); printMarkdown(tab.rows); continue; }
  console.log('\n' + '='.repeat(100) + '\n' + name + '\n' + '='.repeat(100));
  printRows(tab.rows);
}
