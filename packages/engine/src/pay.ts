import type { Ruleset } from './types';
import { grossFromNet, netFromGross, personalIncomeTax } from './tax';

export interface PayBreakdown {
  /** Gross annual salary, before anything comes out of it. */
  gross: number;
  /** What the employer pays into super on top of the salary. */
  superGuarantee: number;
  /**
   * The salary sacrifice actually made, which is the amount asked for trimmed to the
   * room left under the concessional cap once the super guarantee has taken its share.
   */
  salarySacrifice: number;
  /** Sacrifice asked for but not made, because the cap had no room for it. */
  salarySacrificeRefused: number;
  /** Gross less the sacrifice: what the tax scale is applied to. */
  taxableIncome: number;
  /** Income tax payable, including the Medicare levy and after offsets. */
  tax: number;
  /** Take-home pay for the year - what reaches the bank account. */
  net: number;
}

/**
 * How much of a wanted salary sacrifice actually fits.
 *
 * The concessional cap covers the super guarantee as well, so the room left is the cap
 * less the guarantee - and above roughly $270,000 of salary the guarantee alone fills the
 * cap and there is no room at all. This mirrors what the projection does year by year
 * (see the trimming in `engine.ts`), so the figure quoted to the user when they enter
 * their pay is the figure the model will actually contribute. It uses the unindexed cap,
 * which is right for the plan's first year - the year the form's figures describe.
 *
 * The salary itself is the other limit: you cannot sacrifice more of it than you earn.
 */
function sacrificeThatFits(gross: number, wanted: number, ruleset: Ruleset) {
  const sg = Math.min(gross, ruleset.super.maximumContributionBaseAnnual.value) *
    ruleset.super.guaranteeRate.value;
  const room = Math.max(0, ruleset.super.concessionalCap.value - sg);
  const made = Math.max(0, Math.min(wanted, room, gross));
  return { sg, made, refused: Math.max(0, wanted - made) };
}

/**
 * What a gross salary actually leaves in the hand over a year.
 *
 * Salary sacrifice comes out before tax, which is the whole point of it: it lowers
 * taxable income, so the cost to take-home is less than the amount sacrificed. The super
 * guarantee is not deducted - it is paid on top of salary, not out of it.
 *
 * What this does not model: HELP repayments, reportable fringe benefits, and the
 * Division 293 surcharge on contributions for very high earners.
 */
export function takeHome(
  gross: number,
  ruleset: Ruleset,
  opts: { salarySacrifice?: number; saptoEligible?: boolean } = {},
): PayBreakdown {
  const g = Number.isFinite(gross) && gross > 0 ? gross : 0;
  const wanted = Number.isFinite(opts.salarySacrifice ?? 0) ? Math.max(0, opts.salarySacrifice ?? 0) : 0;
  const { sg, made, refused } = sacrificeThatFits(g, wanted, ruleset);
  const taxableIncome = Math.max(0, g - made);
  const tax = personalIncomeTax(taxableIncome, ruleset, {
    saptoEligible: opts.saptoEligible ?? false,
  }).payable;
  return {
    gross: g,
    superGuarantee: sg,
    salarySacrifice: made,
    salarySacrificeRefused: refused,
    taxableIncome,
    tax,
    net: g === 0 ? 0 : taxableIncome - tax,
  };
}

/**
 * The gross salary that leaves a given amount in the hand over a year, given a salary
 * sacrifice - the inverse of `takeHome`.
 *
 * With no sacrifice, or with one that fits under the cap, this is just the tax scale run
 * backwards plus the sacrifice on top. It is solved by bisection anyway, because once the
 * sacrifice is large enough to be trimmed the two move together: a higher salary means a
 * bigger super guarantee, which leaves less room under the cap, which trims the sacrifice
 * further. Bisection does not care.
 */
export function grossFromTakeHome(
  net: number,
  ruleset: Ruleset,
  opts: { salarySacrifice?: number; saptoEligible?: boolean } = {},
): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  const wanted = Math.max(0, opts.salarySacrifice ?? 0);
  const taxOpts = { saptoEligible: opts.saptoEligible ?? false };
  if (wanted === 0) return grossFromNet(net, ruleset, taxOpts);

  // The taxable income that produces this take-home, then the sacrifice back on top. Right
  // whenever the whole sacrifice fits, which is the ordinary case.
  const guess = grossFromNet(net, ruleset, taxOpts) + wanted;
  if (sacrificeThatFits(guess, wanted, ruleset).made === wanted) return guess;

  let lo = grossFromNet(net, ruleset, taxOpts); // no sacrifice made at all
  let hi = guess; // the whole of it made
  for (let i = 0; i < 200 && hi - lo > 0.005; i++) {
    const mid = (lo + hi) / 2;
    if (takeHome(mid, ruleset, opts).net < net) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}


