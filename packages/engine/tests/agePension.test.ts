import { describe, expect, it } from 'vitest';
import { agePension, deemedIncome, minimumDrawdownPercent } from '../src/agePension';
import { loadRuleset } from '../src/loadRuleset';

const ruleset = loadRuleset('au-2026-07');
const ap = ruleset.agePension;
const FY = ap.fortnightsPerYear.value;
const MAX_SINGLE = ap.maxRateFortnight.value.single.total * FY;

/** A single person of pension age, with nothing, unless overridden. */
const one = (o: Partial<{
  age: number;
  employmentIncome: number;
  workBonusBalance: number;
  homeOwner: boolean;
  financialAssets: number;
  assessableAssets: number;
  otherAssessableIncome: number;
}> = {}) => ({
  people: [
    {
      id: 'a',
      age: o.age ?? 70,
      employmentIncome: o.employmentIncome ?? 0,
      workBonusBalance: o.workBonusBalance ?? 0,
    },
  ],
  partnered: false,
  homeOwner: o.homeOwner ?? true,
  financialAssets: o.financialAssets ?? 0,
  assessableAssets: o.assessableAssets ?? 0,
  otherAssessableIncome: o.otherAssessableIncome ?? 0,
});

describe('deeming', () => {
  it('applies the lower rate below the threshold', () => {
    expect(deemedIncome(50_000, true, ruleset)).toBeCloseTo(50_000 * 0.0125, 2);
  });

  it('applies the upper rate only to the excess', () => {
    // 66,800 at 1.25% + 33,200 at 3.25%
    expect(deemedIncome(100_000, true, ruleset)).toBeCloseTo(66_800 * 0.0125 + 33_200 * 0.0325, 2);
  });

  it('uses the higher combined threshold for a couple', () => {
    expect(deemedIncome(110_600, false, ruleset)).toBeCloseTo(110_600 * 0.0125, 2);
  });
});

describe('Age Pension - eligibility and the full rate', () => {
  it('pays nothing before Age Pension age', () => {
    expect(agePension(one({ age: 66 }), ruleset).entitlement).toBe(0);
  });

  it('pays the full single rate with no income and no assets', () => {
    const r = agePension(one(), ruleset);
    expect(r.entitlement).toBeCloseTo(MAX_SINGLE, 2);
    expect(r.bindingTest).toBe('none');
    // Sanity: the published single total of $1,200.90/fn annualises to ~$31,223.
    expect(MAX_SINGLE).toBeCloseTo(31_223.4, 2);
  });
});

describe('Age Pension - assets test against the published limits', () => {
  const limit = ap.assetsTest.value.fullPensionLimit.singleHomeowner;
  const cutOff = ap.assetsTest.value.cutOff.singleHomeowner;

  it('still pays the full rate at exactly the full-pension asset limit', () => {
    // Assets are set through `assessableAssets` only, so the income test cannot bind.
    const r = agePension(one({ assessableAssets: limit }), ruleset);
    expect(r.entitlement).toBeCloseTo(MAX_SINGLE, 2);
  });

  it('reduces by $3 per fortnight per $1,000 over the limit', () => {
    const r = agePension(one({ assessableAssets: limit + 100_000 }), ruleset);
    expect(r.assetsTestReduction).toBeCloseTo(100 * 3 * FY, 2);
    expect(r.entitlement).toBeCloseTo(MAX_SINGLE - 100 * 3 * FY, 2);
    expect(r.bindingTest).toBe('assets');
  });

  it('pays zero at the published cut-off point, which the taper independently reproduces', () => {
    // The strongest check available: Services Australia publishes the limit, the cut-off
    // and the maximum rate separately, and DSS publishes the taper. They must agree.
    const r = agePension(one({ assessableAssets: cutOff }), ruleset);
    expect(r.entitlement).toBeCloseTo(0, 0);
  });

  it('uses the higher non-homeowner limit', () => {
    const nonHomeLimit = ap.assetsTest.value.fullPensionLimit.singleNonHomeowner;
    const r = agePension(one({ homeOwner: false, assessableAssets: nonHomeLimit }), ruleset);
    expect(r.entitlement).toBeCloseTo(MAX_SINGLE, 2);
  });
});

describe('Age Pension - income test against the published cut-off', () => {
  const freeArea = ap.incomeTest.value.freeAreaFortnight.single * FY;

  it('still pays the full rate at the income free area', () => {
    const r = agePension(one({ otherAssessableIncome: freeArea }), ruleset);
    expect(r.entitlement).toBeCloseTo(MAX_SINGLE, 2);
  });

  it('reduces by 50c per dollar over the free area', () => {
    const r = agePension(one({ otherAssessableIncome: freeArea + 10_000 }), ruleset);
    expect(r.incomeTestReduction).toBeCloseTo(5_000, 2);
    expect(r.bindingTest).toBe('income');
  });

  it('pays zero at the published income cut-off point', () => {
    const cutOff = ap.incomeTest.value.cutOffFortnight.single * FY;
    const r = agePension(one({ otherAssessableIncome: cutOff }), ruleset);
    expect(r.entitlement).toBeCloseTo(0, 0);
  });
});

describe('Age Pension - the two tests together', () => {
  it('pays the lower of the two results', () => {
    // Assets bind hard, income barely at all.
    const r = agePension(one({ assessableAssets: 600_000, financialAssets: 600_000 }), ruleset);
    const byIncome = MAX_SINGLE - r.incomeTestReduction;
    const byAssets = MAX_SINGLE - r.assetsTestReduction;
    expect(r.entitlement).toBeCloseTo(Math.min(byIncome, byAssets), 2);
  });

  it('deems super and investments, so a large balance cuts the pension', () => {
    const r = agePension(one({ financialAssets: 900_000, assessableAssets: 900_000 }), ruleset);
    expect(r.entitlement).toBe(0);
  });
});

describe('Work Bonus', () => {
  it('offsets employment income before the income test', () => {
    const r = agePension(one({ employmentIncome: 5_000 }), ruleset);
    expect(r.workBonusUsed).toBe(5_000);
    expect(r.assessedIncome).toBe(0);
    expect(r.entitlement).toBeCloseTo(MAX_SINGLE, 2);
  });

  it('accrues only $300 a fortnight in the first year, and passes the excess to the income test', () => {
    const wb = ap.workBonus.value;
    const firstYearAccrual = wb.creditPerFortnight * FY; // 7,800, not the 11,800 cap
    const r = agePension(one({ employmentIncome: 30_000 }), ruleset);
    expect(r.workBonusUsed).toBe(firstYearAccrual);
    expect(r.assessedIncome).toBeCloseTo(30_000 - firstYearAccrual, 2);
  });

  it('carries unused credit forward, up to the published maximum balance', () => {
    const wb = ap.workBonus.value;
    // A year of not working leaves a balance; the cap stops it growing without limit.
    const idle = agePension(one({ workBonusBalance: 7_000 }), ruleset);
    expect(idle.workBonusBalanceEnd.a).toBe(wb.maximumBalance);
    const spent = agePension(one({ workBonusBalance: wb.maximumBalance, employmentIncome: 50_000 }), ruleset);
    expect(spent.workBonusUsed).toBe(wb.maximumBalance);
    expect(spent.workBonusBalanceEnd.a).toBe(0);
  });

  it('does not apply to investment income, only employment income', () => {
    const r = agePension(one({ otherAssessableIncome: 5_000 }), ruleset);
    expect(r.workBonusUsed).toBe(0);
    expect(r.assessedIncome).toBe(5_000);
  });
});

describe('minimum pension drawdown factors', () => {
  it.each([
    [60, 0.04],
    [64, 0.04],
    [65, 0.05],
    [74, 0.05],
    [75, 0.06],
    [80, 0.07],
    [85, 0.09],
    [90, 0.11],
    [95, 0.14],
    [100, 0.14],
  ])('age %i -> %f', (age, pct) => {
    expect(minimumDrawdownPercent(age, ruleset)).toBeCloseTo(pct, 5);
  });
});
