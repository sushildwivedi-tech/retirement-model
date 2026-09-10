import type { Ruleset } from './types';

export interface TaxBreakdown {
  /** Tax from the resident rate scale, before offsets. */
  gross: number;
  medicareLevy: number;
  lowIncomeTaxOffset: number;
  seniorsAndPensionersTaxOffset: number;
  /** What is actually payable: max(0, gross - offsets) + Medicare levy. */
  payable: number;
}

/** Tax from the resident rate scale. Excludes the Medicare levy and all offsets. */
export function grossIncomeTax(taxableIncome: number, ruleset: Ruleset): number {
  if (taxableIncome <= 0) return 0;
  const brackets = ruleset.incomeTax.brackets.value;
  // Brackets are ordered; the last has upTo === null and catches everything above.
  for (const b of brackets) {
    if (b.upTo === null || taxableIncome <= b.upTo) {
      return b.base + (taxableIncome - b.over) * b.rate;
    }
  }
  throw new Error('grossIncomeTax: no bracket matched - the top bracket must have upTo: null');
}

/** Low income tax offset. Non-refundable: it can reduce tax to zero but no further. */
export function lito(taxableIncome: number, ruleset: Ruleset): number {
  const o = ruleset.incomeTax.lowIncomeTaxOffset.value;
  if (taxableIncome <= o.fullOffsetUpTo) return o.maxOffset;
  if (taxableIncome <= o.firstTaperTo) {
    return o.maxOffset - (taxableIncome - o.fullOffsetUpTo) * o.firstTaper;
  }
  if (taxableIncome <= o.cutOut) {
    return Math.max(0, o.secondTaperOffsetAt - (taxableIncome - o.firstTaperTo) * o.secondTaper);
  }
  return 0;
}

/**
 * Seniors and pensioners tax offset.
 *
 * Only available to someone who qualifies for the Age Pension, so the caller must pass
 * `eligible`. `rebateIncome` is approximated by taxable income - see the `assumed`
 * warning the engine raises, since true rebate income also adds reportable super
 * contributions and net investment losses.
 */
export function sapto(
  rebateIncome: number,
  ruleset: Ruleset,
  opts: { eligible: boolean; status?: 'single' | 'couplePartnerEach' },
): number {
  if (!opts.eligible) return 0;
  const s = ruleset.incomeTax.seniorsAndPensionersTaxOffset.value;
  const band = s[opts.status ?? 'single'];
  if (rebateIncome <= band.shadeOutThreshold) return band.maxOffset;
  if (rebateIncome >= band.cutOutThreshold) return 0;
  return band.maxOffset - (rebateIncome - band.shadeOutThreshold) * s.taperRate;
}

/**
 * Medicare levy, including the low-income reduction.
 *
 * Below the lower threshold the levy is nil; between the thresholds it shades in at 10c
 * per dollar of income above the lower threshold; above the upper threshold it is the
 * full 2%. Someone entitled to SAPTO gets much higher thresholds, which matters a great
 * deal for a retiree whose taxable income is small.
 */
export function medicareLevyFor(
  taxableIncome: number,
  ruleset: Ruleset,
  saptoEligible: boolean,
): number {
  if (taxableIncome <= 0) return 0;
  const rate = ruleset.incomeTax.medicareLevyRate.value;
  const th = ruleset.incomeTax.medicareLevyLowIncomeThresholds.value;
  const band = saptoEligible ? th.singleWithSapto : th.single;
  if (taxableIncome <= band.lower) return 0;
  if (taxableIncome >= band.upper) return taxableIncome * rate;
  return (taxableIncome - band.lower) * th.shadeInRate;
}

/**
 * Personal income tax for one person for one year.
 *
 * Offsets reduce the income tax liability only - they do not reduce the Medicare levy,
 * so the levy is added after the offsets are applied.
 */
export function personalIncomeTax(
  taxableIncome: number,
  ruleset: Ruleset,
  opts: { saptoEligible: boolean; saptoStatus?: 'single' | 'couplePartnerEach' } = {
    saptoEligible: false,
  },
): TaxBreakdown {
  const gross = grossIncomeTax(taxableIncome, ruleset);
  const l = lito(taxableIncome, ruleset);
  const s = sapto(taxableIncome, ruleset, {
    eligible: opts.saptoEligible,
    status: opts.saptoStatus,
  });
  const medicareLevy = medicareLevyFor(taxableIncome, ruleset, opts.saptoEligible);
  const afterOffsets = Math.max(0, gross - l - s);
  return {
    gross,
    medicareLevy,
    lowIncomeTaxOffset: l,
    seniorsAndPensionersTaxOffset: s,
    payable: afterOffsets + medicareLevy,
  };
}

/** Take-home pay: gross salary less the tax actually payable on it. */
export function netFromGross(
  gross: number,
  ruleset: Ruleset,
  opts: { saptoEligible: boolean; saptoStatus?: 'single' | 'couplePartnerEach' } = {
    saptoEligible: false,
  },
): number {
  if (gross <= 0) return 0;
  return gross - personalIncomeTax(gross, ruleset, opts).payable;
}

/**
 * The gross salary that leaves a given amount in the hand - the inverse of
 * `netFromGross`.
 *
 * Solved by bisection rather than algebraically. The relationship is piecewise linear,
 * but the pieces are not the tax brackets: the LITO taper, the second LITO taper, the
 * Medicare levy shade-in and SAPTO all break it at their own thresholds, and inverting
 * that by hand is a standing invitation for one of those edges to be missed. Bisection
 * uses whatever the ruleset actually says, so a threshold change in a future ruleset
 * needs no change here. Net pay is strictly increasing in gross - the steepest effective
 * marginal rate in the scale is well under 100% - so the bisection has a unique root.
 *
 * Note what this does *not* model: the super guarantee (paid on top of salary, not out
 * of it), salary sacrifice, HELP repayments, and any other deduction. It is the same
 * definition of taxable income the projection uses for a working year.
 */
export function grossFromNet(
  net: number,
  ruleset: Ruleset,
  opts: { saptoEligible: boolean; saptoStatus?: 'single' | 'couplePartnerEach' } = {
    saptoEligible: false,
  },
): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  let lo = net; // gross is never below net: tax is never negative.
  let hi = Math.max(net * 2, 1000);
  // Grow the upper bound until it over-shoots. Doubling terminates quickly because the
  // top marginal rate is 45% + 2%, so gross never exceeds roughly twice net.
  while (netFromGross(hi, ruleset, opts) < net) {
    hi *= 2;
    if (hi > 1e12) return hi; // pathological ruleset; better than looping forever.
  }
  for (let i = 0; i < 200 && hi - lo > 0.005; i++) {
    const mid = (lo + hi) / 2;
    if (netFromGross(mid, ruleset, opts) < net) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
