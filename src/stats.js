/**
 * stats.js — pure statistics for the Skip-the-Call test.
 *
 * No Apps Script APIs here. Every function takes numbers and returns numbers,
 * so the same file runs in Google Apps Script (V8) and under Node for tests.
 *
 * Conventions: rates are fractions (0.034), never percentages; a "table" for
 * Fisher is [[a, b], [c, d]] = [[conv_A, nonconv_A], [conv_B, nonconv_B]].
 */

// ───────────────────────── normal distribution ─────────────────────────────

/** Complementary error function, Numerical Recipes erfcc (|error| < 1.2e-7). */
function erfc(x) {
  var z = Math.abs(x);
  var t = 1 / (1 + 0.5 * z);
  var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 +
    t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
    t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. */
function normCdf(z) {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Two-sided p-value for a z statistic. */
function pFromZ(z) {
  return erfc(Math.abs(z) / Math.SQRT2);
}

/** Standard normal quantile (Acklam's algorithm, |rel error| < 1.2e-9). */
function normQuantile(p) {
  if (p <= 0 || p >= 1) throw new Error('normQuantile: p must be in (0,1)');
  var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  var plow = 0.02425, phigh = 1 - plow, q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ───────────────────────── combinatorics (log space) ───────────────────────

/** log Γ(x), Lanczos approximation. */
function logGamma(x) {
  var g = 7;
  var coef = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  var a = coef[0];
  var t = x + g + 0.5;
  for (var i = 1; i < g + 2; i++) a += coef[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

// ───────────────────────── proportions ─────────────────────────────────────

/** Wilson score interval for k successes out of n. Returns [lo, hi] as fractions. */
function wilson(k, n, z) {
  z = z || 1.959964;
  if (!n) return [0, 0];
  var p = k / n;
  var d = 1 + z * z / n;
  var c = (p + z * z / (2 * n)) / d;
  var h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/**
 * Two-sided Fisher exact test on [[a, b], [c, d]].
 * Sums the probabilities of every table at least as extreme (p <= observed).
 * Computed in log space so n in the thousands does not overflow.
 */
function fisher(a, b, c, d) {
  var r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  if (!n || !r1 || !r2 || !c1 || c1 === n) return 1;
  function logP(i) { return logChoose(r1, i) + logChoose(r2, c1 - i) - logChoose(n, c1); }
  var obs = logP(a);
  var lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1), tot = 0;
  for (var i = lo; i <= hi; i++) {
    var lp = logP(i);
    if (lp <= obs + 1e-9) tot += Math.exp(lp);
  }
  return Math.min(1, tot);
}

/** Two-sided exact binomial test: k successes of n under H0 p = p0. */
function binomTest(k, n, p0) {
  if (!n) return 1;
  function logP(i) { return logChoose(n, i) + i * Math.log(p0) + (n - i) * Math.log(1 - p0); }
  var obs = logP(k), tot = 0;
  for (var i = 0; i <= n; i++) {
    var lp = logP(i);
    if (lp <= obs + 1e-9) tot += Math.exp(lp);
  }
  return Math.min(1, tot);
}

/** Pooled two-proportion z-test. Returns {z, p}. */
function twoPropZ(k1, n1, k2, n2) {
  if (!n1 || !n2) return { z: 0, p: 1 };
  var p = (k1 + k2) / (n1 + n2);
  var se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return { z: 0, p: 1 };
  var z = (k1 / n1 - k2 / n2) / se;
  return { z: z, p: pFromZ(z) };
}

/**
 * Newcombe hybrid score interval for the difference p1 - p2.
 * Behaves well at small counts and at zero conversions, unlike Wald.
 */
function diffCI(k1, n1, k2, n2, z) {
  z = z || 1.959964;
  if (!n1 || !n2) return [0, 0];
  var p1 = k1 / n1, p2 = k2 / n2;
  var w1 = wilson(k1, n1, z), w2 = wilson(k2, n2, z);
  var lo = (p1 - p2) - Math.sqrt(Math.pow(p1 - w1[0], 2) + Math.pow(w2[1] - p2, 2));
  var hi = (p1 - p2) + Math.sqrt(Math.pow(w1[1] - p1, 2) + Math.pow(p2 - w2[0], 2));
  return [lo, hi];
}

// ───────────────────────── planning ────────────────────────────────────────

/**
 * Subjects per arm to detect a difference between p1 and p2 (two-sided alpha,
 * given power), equal allocation, normal approximation with pooled variance
 * under H0. Matches the textbook formula used by common online calculators.
 */
function sampleSizeSuperiority(p1, p2, alpha, power) {
  alpha = alpha || 0.05; power = power || 0.8;
  var delta = Math.abs(p1 - p2);
  if (!delta) return Infinity;
  var pbar = (p1 + p2) / 2;
  var za = normQuantile(1 - alpha / 2), zb = normQuantile(power);
  var num = za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil(num * num / (delta * delta));
}

/**
 * Subjects per arm to show non-inferiority within `margin` (absolute), one-sided
 * alpha, given power, assuming the true rates are equal to `p`.
 */
function sampleSizeNonInferiority(p, margin, alpha, power) {
  alpha = alpha || 0.05; power = power || 0.8;
  if (!margin) return Infinity;
  var za = normQuantile(1 - alpha), zb = normQuantile(power);
  var num = (za + zb) * (za + zb) * 2 * p * (1 - p);
  return Math.ceil(num / (margin * margin));
}

/**
 * Power to detect |p1 - p2| with n1, n2 subjects (two-sided alpha).
 */
function powerAt(p1, p2, n1, n2, alpha) {
  alpha = alpha || 0.05;
  if (!n1 || !n2) return 0;
  var delta = Math.abs(p1 - p2);
  var pbar = (n1 * p1 + n2 * p2) / (n1 + n2);
  var se0 = Math.sqrt(pbar * (1 - pbar) * (1 / n1 + 1 / n2));
  var se1 = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
  if (!se1) return 0;
  var za = normQuantile(1 - alpha / 2);
  return normCdf((delta - za * se0) / se1);
}

/**
 * Non-inferiority verdict for treatment (k_t/n_t) vs control (k_c/n_c) within an
 * absolute margin. One-sided 95% lower bound of (p_t - p_c) via Newcombe.
 * Returns {diff, lower, margin, nonInferior}.
 */
function nonInferiority(k_t, n_t, k_c, n_c, margin, alpha) {
  alpha = alpha || 0.05;
  var z = normQuantile(1 - alpha);
  var ci = diffCI(k_t, n_t, k_c, n_c, z);
  var diff = (n_t ? k_t / n_t : 0) - (n_c ? k_c / n_c : 0);
  return { diff: diff, lower: ci[0], margin: margin, nonInferior: n_t > 0 && n_c > 0 && ci[0] > -margin };
}

if (typeof module !== 'undefined') {
  module.exports = {
    erfc: erfc, normCdf: normCdf, pFromZ: pFromZ, normQuantile: normQuantile,
    logGamma: logGamma, logChoose: logChoose, wilson: wilson, fisher: fisher,
    binomTest: binomTest, twoPropZ: twoPropZ, diffCI: diffCI,
    sampleSizeSuperiority: sampleSizeSuperiority,
    sampleSizeNonInferiority: sampleSizeNonInferiority,
    powerAt: powerAt, nonInferiority: nonInferiority
  };
}
