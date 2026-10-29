/**
 * synthetic.js — a synthetic Events dataset with a known truth. Pure, so it runs
 * both under Node (examples/generate.js) and inside the Sheet (menu: Load example).
 *
 * The planted facts:
 *   * the true next-stage rate is EQUAL in both arms (3.0%) among randomized subjects
 *   * the call arm reaches the next stage mostly after a held call (20% book, 60% of
 *     those are held, 18% of held calls lead to the next stage), and about 2.5% of
 *     the arm qualifies via the call WITHOUT the next stage: the second route
 *   * an auto-reply routes early repliers (high intent, 12% next-stage rate) ONLY
 *     into the skip arm: the selection bias the Checks tab must catch
 *   * conversions arrive with a lag (exponential, median ~10 days to the next stage)
 *   * 2% of subjects had engaged before the offer (prior engagement)
 */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

var SYNTHETIC_DEFAULTS = {
  seed: 7, n: 2400, start: '2026-03-02', weeks: 12,
  rateStage: 0.03, autoShare: 0.15, autoRate: 0.12,
  callBooked: 0.20, callHeld: 0.60, stageGivenHeld: 0.18, stageGivenNoCall: 0.0085,
  qualifiedGivenHeldNoStage: 0.25,
  priorShare: 0.02, proposalGivenQualified: 0.45, wonGivenProposal: 0.2,
  channels: ['linkedin', 'email'], segments: ['founder', 'ops', 'other']
};

/** Returns an array of plain objects, one per subject, keys = Events columns. */
function generateSynthetic(opts) {
  var o = {};
  Object.keys(SYNTHETIC_DEFAULTS).forEach(function (k) { o[k] = SYNTHETIC_DEFAULTS[k]; });
  if (opts) Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
  var rnd = mulberry32(o.seed);
  var expo = function (median) { return -Math.log(1 - rnd()) * median / Math.LN2; };
  var day0 = Date.parse(o.start) / 86400000;
  var iso = function (d) { return new Date(Math.round(d) * 86400000).toISOString().slice(0, 10); };
  var pad = function (i) { var s = String(i); while (s.length < 5) s = '0' + s; return s; };
  var rows = [];
  for (var i = 0; i < o.n; i++) {
    var offered = day0 + Math.floor(rnd() * o.weeks * 7);
    var isAuto = rnd() < o.autoShare;
    var arm = isAuto ? 'skip' : (rnd() < 0.5 ? 'skip' : 'call');
    var r = {
      subject_id: 's' + pad(i + 1), arm: arm, offered_at: iso(offered),
      assignment_source: isAuto ? 'auto' : 'randomizer',
      channel: o.channels[Math.floor(rnd() * o.channels.length)],
      segment: o.segments[Math.floor(rnd() * o.segments.length)],
      call_booked_at: '', call_held_at: '', stage_at: '', qualified_at: '',
      proposal_at: '', won_at: '', revenue: ''
    };
    var qualifiedDay = null;
    if (rnd() < o.priorShare) {
      r.stage_at = iso(offered - 20 - Math.floor(rnd() * 200));     // engaged before the offer
    } else {
      var callHeld = null;
      if (arm === 'call' && rnd() < o.callBooked) {
        var booked = offered + Math.floor(expo(3));
        r.call_booked_at = iso(booked);
        if (rnd() < o.callHeld) { callHeld = booked + 1 + Math.floor(rnd() * 5); r.call_held_at = iso(callHeld); }
      }
      var pStage = isAuto ? o.autoRate : o.rateStage;
      if (arm === 'call') pStage = callHeld !== null ? o.stageGivenHeld : o.stageGivenNoCall;
      if (rnd() < pStage) {
        var base = callHeld !== null ? callHeld : offered;
        var st = base + Math.floor(expo(10));
        r.stage_at = iso(st); qualifiedDay = st;
      } else if (arm === 'call' && callHeld !== null && rnd() < o.qualifiedGivenHeldNoStage) {
        var q = callHeld + Math.floor(expo(4));
        r.qualified_at = iso(q); qualifiedDay = q;
      }
      if (qualifiedDay !== null && rnd() < o.proposalGivenQualified) {
        var pr = qualifiedDay + Math.floor(expo(12));
        r.proposal_at = iso(pr);
        if (rnd() < o.wonGivenProposal) {
          r.won_at = iso(pr + Math.floor(expo(20)));
          r.revenue = 3000 + Math.floor(rnd() * 9) * 500;
        }
      }
    }
    rows.push(r);
  }
  return rows;
}

if (typeof module !== 'undefined') {
  module.exports = { generateSynthetic: generateSynthetic, mulberry32: mulberry32, SYNTHETIC_DEFAULTS: SYNTHETIC_DEFAULTS };
}
