import type { Ruleset } from './types';
import { grossFromNet, netFromGross, personalIncomeTax } from './tax';

export interface PayOptions {
  /** Salary sacrifice wanted per year, before the concessional cap has its say. */
  salarySacrifice?: number;
  /** What the employer puts in per year, if more than the legislated minimum. */
  employerSuper?: number;
  /**
   * The employer's contribution as a rate on salary, e.g. 0.154. Use this rather than
   * `employerSuper` when solving for the salary behind a take-home figure: the two move
   * together, and a rate keeps them consistent at whatever salary the solve lands on.
   * Takes precedence over `employerSuper`.
   */
  employerSuperRate?: number;
  saptoEligible?: boolean;
}

/** What the employer puts in at a given salary, from whichever of the two options is set. */
function employerSuperOn(gross: number, opts: PayOptions): number | undefined {
  if (opts.employerSuperRate) return opts.employerSuperRate * gross;
  return opts.employerSuper;
}

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
 * The super guarantee on a salary: the legislated minimum an employer must pay.
 *
 * It stops at the maximum contribution base, which is set so that the guarantee on it is
 * almost exactly the concessional cap.
 */
export function superGuaranteeOn(gross: number, ruleset: Ruleset): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return (
    Math.min(gross, ruleset.super.maximumContributionBaseAnnual.value) *
    ruleset.super.guaranteeRate.value
  );
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
function sacrificeThatFits(
  gross: number,
  wanted: number,
  ruleset: Ruleset,
  employerSuper?: number,
) {
  const minimum = Math.min(gross, ruleset.super.maximumContributionBaseAnnual.value) *
    ruleset.super.guaranteeRate.value;
  // An employer paying above the minimum uses more of the cap, leaving less room to
  // sacrifice into. Not a detail: at 15.4% the room disappears a long way sooner.
  const sg = employerSuper ? Math.max(minimum, employerSuper) : minimum;
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
  opts: PayOptions = {},
): PayBreakdown {
  const g = Number.isFinite(gross) && gross > 0 ? gross : 0;
  const wanted = Number.isFinite(opts.salarySacrifice ?? 0) ? Math.max(0, opts.salarySacrifice ?? 0) : 0;
  const { sg, made, refused } = sacrificeThatFits(g, wanted, ruleset, employerSuperOn(g, opts));
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
  opts: PayOptions = {},
): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  const wanted = Math.max(0, opts.salarySacrifice ?? 0);
  const taxOpts = { saptoEligible: opts.saptoEligible ?? false };
  if (wanted === 0) return grossFromNet(net, ruleset, taxOpts);

  // The taxable income that produces this take-home, then the sacrifice back on top. Right
  // whenever the whole sacrifice fits, which is the ordinary case.
  const guess = grossFromNet(net, ruleset, taxOpts) + wanted;
  if (sacrificeThatFits(guess, wanted, ruleset, employerSuperOn(guess, opts)).made === wanted) {
    return guess;
  }

  let lo = grossFromNet(net, ruleset, taxOpts); // no sacrifice made at all
  let hi = guess; // the whole of it made
  for (let i = 0; i < 200 && hi - lo > 0.005; i++) {
    const mid = (lo + hi) / 2;
    if (takeHome(mid, ruleset, opts).net < net) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}


