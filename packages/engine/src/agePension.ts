import type { Ruleset } from './types';

export interface AgePensionPerson {
  id: string;
  age: number;
  /** Salary or wages. The Work Bonus applies to this, not to investment income. */
  employmentIncome: number;
  /** Carried Work Bonus credit at the start of the year. Per person. */
  workBonusBalance: number;
}

export interface AgePensionInput {
  people: AgePensionPerson[];
  /** Two people who are a couple. Drives which rate, free area and asset limit apply. */
  partnered: boolean;
  homeOwner: boolean;
  /** Combined across the household - both tests assess a couple jointly. */
  financialAssets: number;
  assessableAssets: number;
  /** Rent, defined-benefit pensions and anything else assessed directly, combined. */
  otherAssessableIncome: number;
  /** Rent paid per year. Only a non-homeowner can attract Rent Assistance. */
  rentPerYear?: number;
}

export interface AgePensionResult {
  /** Total annual entitlement across the household, Rent Assistance included. */
  entitlement: number;
  /** The Rent Assistance part of it. Nil for a homeowner, or where no pension is payable. */
  rentAssistance: number;
  /** Entitlement per person - each partner is paid separately. */
  byPerson: Record<string, number>;
  /** Maximum the household could receive given who is of pension age. */
  maxRate: number;
  deemedIncome: number;
  assessedIncome: number;
  incomeTestReduction: number;
  assetsTestReduction: number;
  bindingTest: 'income' | 'assets' | 'none';
  workBonusUsed: number;
  workBonusBalanceEnd: Record<string, number>;
}

/** Deemed income on financial assets: a lower rate up to a threshold, upper rate above. */
export function deemedIncome(financialAssets: number, single: boolean, ruleset: Ruleset): number {
  const d = ruleset.agePension.deeming.value;
  const threshold = single ? d.threshold.single : d.threshold.coupleCombinedAtLeastOnePensioner;
  const lower = Math.min(financialAssets, threshold);
  const upper = Math.max(0, financialAssets - threshold);
  return lower * d.lowerRate + upper * d.upperRate;
}

/**
 * Age Pension entitlement for a year.
 *
 * Both the income test and the assets test are applied and the LOWER result is paid.
 *
 * Couples are assessed on COMBINED income and assets, but each partner is paid
 * separately and bears HALF the reduction. That is what reconciles the published
 * numbers: the assets taper of $3 per $1,000 per fortnight exhausts the couple's
 * combined rate exactly at the published couple cut-off, so an individual partner is
 * tapered at $1.50. The same halving is why a couple where only one partner has reached
 * pension age still cuts out at the full couple asset limit rather than half of it.
 */
export function agePension(input: AgePensionInput, ruleset: Ruleset): AgePensionResult {
  const ap = ruleset.agePension;
  const fy = ap.fortnightsPerYear.value;
  const eligibilityAge = ap.eligibilityAge.value;
  const eligible = input.people.filter((p) => p.age >= eligibilityAge);

  const workBonusBalanceEnd: Record<string, number> = {};
  const byPerson: Record<string, number> = {};
  for (const p of input.people) {
    workBonusBalanceEnd[p.id] = p.workBonusBalance;
    byPerson[p.id] = 0;
  }

  const none: AgePensionResult = {
    entitlement: 0,
    rentAssistance: 0,
    byPerson,
    maxRate: 0,
    deemedIncome: 0,
    assessedIncome: 0,
    incomeTestReduction: 0,
    assetsTestReduction: 0,
    bindingTest: 'none',
    workBonusUsed: 0,
    workBonusBalanceEnd,
  };
  if (eligible.length === 0) return none;

  const single = !input.partnered;
  const rates = ap.maxRateFortnight.value;
  const perPersonRate = (single ? rates.single.total : rates.coupleEach.total) * fy;
  const maxRate = perPersonRate * eligible.length;

  // --- Work Bonus: offsets employment income before the income test, per person ----
  const wb = ap.workBonus.value;
  let employmentAfterBonus = 0;
  let workBonusUsed = 0;
  for (const p of input.people) {
    // Only someone of pension age accrues a Work Bonus; a younger partner's earnings are
    // still assessed in full against the couple's combined income.
    if (p.age < eligibilityAge) {
      employmentAfterBonus += p.employmentIncome;
      continue;
    }
    const accrued = Math.min(wb.maximumBalance, p.workBonusBalance + wb.creditPerFortnight * fy);
    const used = Math.min(accrued, p.employmentIncome);
    workBonusUsed += used;
    employmentAfterBonus += p.employmentIncome - used;
    workBonusBalanceEnd[p.id] = accrued - used;
  }

  // --- Income test (combined) ------------------------------------------------------
  const deemed = deemedIncome(input.financialAssets, single, ruleset);
  const assessedIncome = deemed + employmentAfterBonus + input.otherAssessableIncome;
  const it = ap.incomeTest.value;
  const freeArea = (single ? it.freeAreaFortnight.single : it.freeAreaFortnight.coupleCombined) * fy;
  const combinedTaper = single ? it.taperPerDollar.single : it.taperPerDollar.coupleCombinedTotal;
  const incomeTestReduction = Math.max(0, assessedIncome - freeArea) * combinedTaper;

  // --- Assets test (combined) ------------------------------------------------------
  const at = ap.assetsTest.value;
  const limit = single
    ? input.homeOwner
      ? at.fullPensionLimit.singleHomeowner
      : at.fullPensionLimit.singleNonHomeowner
    : input.homeOwner
      ? at.fullPensionLimit.coupleHomeownerCombined
      : at.fullPensionLimit.coupleNonHomeownerCombined;
  const excessThousands = Math.max(0, input.assessableAssets - limit) / 1000;
  const assetsTestReduction = excessThousands * at.taperPerThousandPerFortnight * fy;

  // Pay the lower of the two results, i.e. apply the larger reduction. A couple splits
  // the reduction between them; each eligible partner bears half.
  const combinedReduction = Math.max(incomeTestReduction, assetsTestReduction);
  const perPersonReduction = single ? combinedReduction : combinedReduction / 2;
  const perPerson = Math.max(0, perPersonRate - perPersonReduction);
  for (const p of eligible) byPerson[p.id] = perPerson;
  const pensionEntitlement = perPerson * eligible.length;

  // --- Rent Assistance -------------------------------------------------------------
  // Paid on top of the pension, and only to someone actually receiving it: 75c for every
  // dollar of rent above a threshold, capped. A homeowner cannot get it.
  const rent = input.rentPerYear ?? 0;
  let rentAssistance = 0;
  if (!input.homeOwner && rent > 0 && pensionEntitlement > 0) {
    const ra = ap.rentAssistance.value;
    const band = single ? ra.single : ra.coupleCombined;
    rentAssistance = Math.min(
      Math.max(0, rent - band.rentThresholdFortnight * fy) * ra.taperPerDollarOfRent,
      band.maxPaymentFortnight * fy,
    );
    // A couple is paid the combined maximum between them, like the pension itself.
    const share = rentAssistance / eligible.length;
    for (const p of eligible) byPerson[p.id] += share;
  }
  const entitlement = pensionEntitlement + rentAssistance;

  return {
    entitlement,
    rentAssistance,
    byPerson,
    maxRate,
    deemedIncome: deemed,
    assessedIncome,
    incomeTestReduction,
    assetsTestReduction,
    bindingTest:
      entitlement === maxRate
        ? 'none'
        : assetsTestReduction >= incomeTestReduction
          ? 'assets'
          : 'income',
    workBonusUsed,
    workBonusBalanceEnd,
  };
}

/** Minimum annual payment factor for an account-based pension, by age at 1 July. */
export function minimumDrawdownPercent(age: number, ruleset: Ruleset): number {
  const bands = ruleset.super.minimumDrawdownPercentByAge.value;
  if (bands === null) throw new Error('minimumDrawdownPercent: the ruleset has no drawdown table');
  let pct = 0;
  for (const b of bands) if (age >= b.fromAge) pct = b.percent;
  return pct;
}
