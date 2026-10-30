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

test('join_keys.py matches on several keys, refuses collisions and reports what it missed', { skip: !python && 'python3 not found' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stc-'));
  const run = (keys) => spawnSync('python3', ['-I', 'adapters/join_keys.py', '--offers', 'examples/join-offers-sample.csv',
    '--outcomes', 'examples/join-fills-sample.csv', '--keys', keys, '--date-col', 'submitted_at', '--date-format', '%d/%m/%Y',
    '--into', 'stage_at', '--out', path.join(dir, keys + '.csv'), '--unmatched', path.join(dir, 'u.csv')], { cwd: root, encoding: 'utf8' });
  const one = run('email');
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /matched: 3 \(43%\)/);
  const three = run('email,linkedin,name');
  assert.match(three.stdout, /matched: 6 \(86%\)/);
  assert.match(three.stdout, /via name: 1 {2}\(1 shared name values ignored\)/);
  const rows = fs.readFileSync(path.join(dir, 'email,linkedin,name.csv'), 'utf8').trim().split(/\r?\n/);
  const header = rows[0].split(',');
  const stage = header.indexOf('stage_at');
  assert.equal(rows.slice(1).filter(r => r.split(',')[stage]).length, 6);
  assert.ok(rows.some(r => r.startsWith('P-1004,') && r.endsWith(',2026-04-13')), 'personal-email fill matched via LinkedIn');
});

test('demo.js --md prints untruncated Markdown tables', () => {
  const r = spawnSync('node', ['examples/demo.js', 'examples/config.csv', 'examples/events.csv', '--md'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^## CHECKS$/m);
  assert.match(r.stdout, /\| Non-randomized assignment share per arm \| FAIL \|/);
  assert.match(r.stdout, /Read the randomizer-only line below, not the pooled readout \|/);
});

test('SKILL.md has the frontmatter a skill loader needs and points only at files that exist', () => {
  const s = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const fm = s.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
  assert.ok(fm, 'frontmatter');
  assert.equal(fm[1], 'skip-the-call-test');
  assert.ok(fm[2].length <= 1024, 'description under 1024 characters');
  const paths = [...s.matchAll(/`((?:docs|examples|adapters|src)\/[\w.-]+)`/g)].map(m => m[1]);
  assert.ok(paths.length > 5);
  for (const p of paths) assert.ok(fs.existsSync(path.join(root, p)), p);
});

test('join_keys.py compares real dates, reports undated rows and accepts header-only files', { skip: !python && 'python3 not found' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stc-'));
  const w = (n, t) => { fs.writeFileSync(path.join(dir, n), t); return path.join(dir, n); };
  const offers = w('o.csv', 'subject_id,email,stage_at\nA,a@x.example,01.06.2026\nB,b@x.example,\n');
  const fills = w('f.csv', 'email,at\na@x.example,2026-05-01\nb@x.example,not a date\nb@x.example,\n');
  const out = path.join(dir, 'out.csv');
  const r = spawnSync('python3', ['-I', 'adapters/join_keys.py', '--offers', offers, '--outcomes', fills, '--keys', 'email',
    '--date-col', 'at', '--into', 'stage_at', '--out', out, '--unmatched', path.join(dir, 'u.csv')], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /rows without a usable at: 2/);
  assert.match(r.stdout, /matched: 1 \(100%\)/);
  const rows = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/);
  assert.equal(rows[1], 'A,a@x.example,2026-05-01', 'earlier incoming date replaces a later dd.mm.yyyy one');
  assert.match(fs.readFileSync(path.join(dir, 'u.csv'), 'utf8'), /no usable date/);
  const empty = w('e.csv', 'email,at\n');
  const r2 = spawnSync('python3', ['-I', 'adapters/join_keys.py', '--offers', offers, '--outcomes', empty, '--keys', 'email',
    '--date-col', 'at', '--into', 'stage_at', '--out', path.join(dir, 'o2.csv')], { cwd: root, encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stderr);
});
