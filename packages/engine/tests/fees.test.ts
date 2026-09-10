import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';
import { baseCase } from '../src/fixtures/baseCase';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};

const superTotal = (r: { balances: { superAccumulation: number; superPension: number } }) =>
  r.balances.superAccumulation + r.balances.superPension;

const withFees = (o: {
  superFee?: number;
  investmentFee?: number;
  insurance?: number;
}): Scenario => ({
  ...baseCase,
  household: {
    ...baseCase.household,
    people: [{ ...baseCase.household.people[0], insurancePremiumInSuper: o.insurance }],
  },
  assumptions: {
    ...baseCase.assumptions,
    feeRateSuper: o.superFee,
    feeRateInvestments: o.investmentFee,
  },
});

describe('fees', () => {
  it('are absent unless asked for, so an existing plan is unchanged', () => {
    const none = project(withFees({}), ruleset, datasets);
    const zero = project(withFees({ superFee: 0, investmentFee: 0 }), ruleset, datasets);
    expect(none.rows[0].balances.total).toBe(zero.rows[0].balances.total);
    expect(none.rows[0].costs.total).toBe(0);
  });

  it('charge the balance, and say how much', () => {
    const row = project(withFees({ superFee: 0.006 }), ruleset, datasets).rows[0];
    // The opening balance is $250,000 plus this year's contributions.
    expect(row.costs.superFees).toBeGreaterThan(250_000 * 0.006);
    expect(row.costs.superFees).toBeLessThan(300_000 * 0.006);
  });

  it('cost about what compounding says they cost', () => {
    // 0.7% on a balance growing at 7.5% for 40 years: the closed form says the fee
    // leaves you with (1.068/1.075)^40 of what you would have had, about 77%.
    const long = (fee: number): Scenario => {
      const s = withFees({ superFee: fee });
      return {
        ...s,
        household: {
          ...s.household,
          annualSavings: 0,
          people: [
            {
              ...s.household.people[0],
              salary: 0,
              // Never retires, so the balance is left alone to compound and the only
              // thing acting on it is the fee.
              retirementAge: 95,
              superBalance: 250_000,
              voluntarySuperContribution: 0,
            },
          ],
        },
      };
    };
    const free = superTotal(project(long(0), ruleset, datasets).rows[39]);
    const charged = superTotal(project(long(0.007), ruleset, datasets).rows[39]);
    expect(charged / free).toBeCloseTo(0.993 ** 40, 1);
    expect(charged / free).toBeLessThan(0.8);
  });

  it('are levied before earnings tax, so the tax falls too', () => {
    const free = project(withFees({}), ruleset, datasets).rows[0];
    const charged = project(withFees({ superFee: 0.01 }), ruleset, datasets).rows[0];
    expect(charged.tax.superEarnings).toBeLessThan(free.tax.superEarnings);
  });

  it('apply outside super as well', () => {
    const free = project(withFees({}), ruleset, datasets).rows[2];
    const charged = project(withFees({ investmentFee: 0.002 }), ruleset, datasets).rows[2];
    expect(charged.balances.investments).toBeLessThan(free.balances.investments);
    expect(charged.costs.investmentFees).toBeGreaterThan(0);
  });
});

describe('insurance premiums paid from super', () => {
  it('come out of the balance while the salary lasts', () => {
    const free = project(withFees({}), ruleset, datasets).rows[0];
    const insured = project(withFees({ insurance: 1_200 }), ruleset, datasets).rows[0];
    expect(insured.costs.insurance).toBeCloseTo(1_200, 0);
    expect(superTotal(insured)).toBeLessThan(superTotal(free));
  });

  it('stop at retirement, when the cover usually does', () => {
    const rows = project(withFees({ insurance: 1_200 }), ruleset, datasets).rows;
    const retiredAt = baseCase.household.people[0].retirementAge;
    const working = rows.find((r) => r.ages.you === retiredAt - 1);
    const retired = rows.find((r) => r.ages.you === retiredAt);
    expect(working!.costs.insurance).toBeGreaterThan(0);
    expect(retired!.costs.insurance).toBe(0);
  });

  it('index at CPI, being a price like any other', () => {
    const rows = project(withFees({ insurance: 1_000 }), ruleset, datasets).rows;
    expect(rows[4].costs.insurance).toBeCloseTo(1_000 * 1.025 ** 4, 0);
  });
});
