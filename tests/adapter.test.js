// The adapter example in adapters/README.md must run as written on the sample export.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const python = spawnSync('python3', ['--version']).status === 0;

test('map_csv.py turns the sample CRM export into Events rows', { skip: !python && 'python3 not found' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stc-')), 'events.csv');
  const r = spawnSync('python3', ['-I', 'adapters/map_csv.py', '--mapping', 'examples/mapping-sample.json',
    '--in', 'examples/crm-export-sample.csv', '--out', out], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 41);
  assert.equal(lines[0].split(',')[1], 'arm');
  assert.ok(lines.slice(1).every(l => /^P-\d+,(call|skip),\d{4}-\d\d-\d\d,(randomizer|auto|manual),/.test(l)));
});
