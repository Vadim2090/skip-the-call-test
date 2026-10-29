const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/stats.js');

function close(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} ±${tol}, got ${a}`);
}

test('normal cdf and quantile are inverses at the usual points', () => {
  close(S.normCdf(1.959964), 0.975, 1e-5);
  close(S.normQuantile(0.975), 1.959964, 1e-6);
  close(S.normQuantile(0.8), 0.841621, 1e-6);
  close(S.normCdf(0), 0.5, 1e-7);
  close(S.pFromZ(1.959964), 0.05, 1e-5);
});

test('logChoose matches small exact values', () => {
  close(Math.exp(S.logChoose(10, 3)), 120, 1e-9);
  close(Math.exp(S.logChoose(52, 5)), 2598960, 1e-3);
});

test('wilson interval contains the point estimate and handles zero', () => {
  const [lo, hi] = S.wilson(12, 620);
  assert.ok(lo < 12 / 620 && hi > 12 / 620);
  close(lo, 0.0111, 0.0005);
  close(hi, 0.0335, 0.0005);
  const z = S.wilson(0, 580);
  assert.equal(z[0], 0);
  close(z[1], 0.0066, 0.0005);
});

test('fisher two-sided reproduces reference p-values', () => {
  // 12/620 vs 1/580 (illustrative) -> p = 0.00347, checked against an independent exact enumeration
  close(S.fisher(12, 608, 1, 579), 0.00347, 0.0002);
  // identical arms -> p = 1
  close(S.fisher(5, 95, 5, 95), 1, 1e-9);
  // classic Lady-tasting-tea style table [[3,1],[1,3]] -> p = 0.4857
  close(S.fisher(3, 1, 1, 3), 0.4857, 0.001);
  // empty margins never throw
  assert.equal(S.fisher(0, 0, 0, 0), 1);
  assert.equal(S.fisher(0, 10, 0, 10), 1);
});

test('binomial test flags an unbalanced split', () => {
  // 236 vs 178 for an intended 50/50 (illustrative, as in docs/field-notes.md) -> p = 0.005
  const p = S.binomTest(236, 414, 0.5);
  assert.ok(p < 0.01, `p=${p}`);
  assert.ok(S.binomTest(50, 100, 0.5) > 0.9);
});

test('two-proportion z agrees with fisher in direction', () => {
  const r = S.twoPropZ(30, 500, 15, 500);
  assert.ok(r.z > 0 && r.p < 0.05);
});

test('newcombe difference interval covers the difference and is finite at zero', () => {
  const ci = S.diffCI(12, 620, 1, 580);
  const d = 12 / 620 - 1 / 580;
  assert.ok(ci[0] < d && ci[1] > d);
  assert.ok(ci[0] > 0.002, `lower ${ci[0]}`); // the difference is clearly positive
  const ci0 = S.diffCI(0, 100, 0, 100);
  assert.ok(ci0[0] < 0 && ci0[1] > 0);
});

test('sample size per arm matches the textbook calculator', () => {
  // baseline 3%, target 5%, alpha 0.05, power 0.8 -> 1506 per arm (hand-computed)
  const n = S.sampleSizeSuperiority(0.03, 0.05, 0.05, 0.8);
  assert.ok(Math.abs(n - 1506) <= 2, `n=${n}`);
  // non-inferiority at 3% with a 2pp margin, one-sided 0.05, power 0.8
  const m = S.sampleSizeNonInferiority(0.03, 0.02, 0.05, 0.8);
  assert.ok(m > 800 && m < 1000, `m=${m}`);
});

test('power at the planned n is near the planned power', () => {
  const n = S.sampleSizeSuperiority(0.03, 0.05, 0.05, 0.8);
  close(S.powerAt(0.03, 0.05, n, n), 0.8, 0.02);
  assert.ok(S.powerAt(0.03, 0.05, 100, 100) < 0.2);
});

test('non-inferiority verdict', () => {
  // equal 3% rates at n=1000 each with a 2pp margin -> non-inferior
  const ok = S.nonInferiority(30, 1000, 30, 1000, 0.02);
  assert.ok(ok.nonInferior, JSON.stringify(ok));
  // same rates at n=50 -> cannot conclude
  const no = S.nonInferiority(2, 50, 2, 50, 0.02);
  assert.ok(!no.nonInferior, JSON.stringify(no));
});
