import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { agePension } from '../src/agePension';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';
import { baseCase } from '../src/fixtures/baseCase';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};
const FY = ruleset.agePension.fortnightsPerYear.value;

describe('a voluntary contribution follows pay, not prices', () => {
  it('grows at the wage index rather than CPI', () => {
    const s: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        people: [
          {
            ...baseCase.household.people[0],
            retirementAge: 65,
            voluntarySuperContribution: 10_000,
            wageGrowth: 0.05,
          },
        ],
      },
      assumptions: { ...baseCase.assumptions, cpi: 0.025 },
    };
    const rows = project(s, ruleset, datasets).rows;
    // Ten years of 5% wage growth, not 2.5% inflation.
    expect(rows[10].contributions.voluntary).toBeCloseTo(10_000 * 1.05 ** 10, -1);
  });

  it('keeps the same share of a rising salary', () => {
    const s: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        people: [
          {
            ...baseCase.household.people[0],
            retirementAge: 65,
            salary: 100_000,
            voluntarySuperContribution: 5_000,
            wageGrowth: 0.04,
          },
        ],
      },
    };
    const rows = project(s, ruleset, datasets).rows;
    const share = (i: number) => rows[i].contributions.voluntary / rows[i].income.salary;
    expect(share(8)).toBeCloseTo(share(0), 6);
  });
});

describe('personal assets count for the assets test but are never deemed', () => {
  const retired = (personalAssets?: number): Scenario => ({
    ...baseCase,
    household: {
      ...baseCase.household,
      personalAssets,
      cash: 100_000,
      investments: 500_000,
      annualSavings: 0,
      people: [
        {
          ...baseCase.household.people[0],
          currentAge: 67,
          dateOfBirth: '1959-01-01',
          retirementAge: 67,
          salary: 0,
          superBalance: 100_000,
        },
      ],
    },
  });

  it('reduces the pension by the published $3 per $1,000 per fortnight taper', () => {
    const without = project(retired(), ruleset, datasets).rows[0];
    const with20k = project(retired(20_000), ruleset, datasets).rows[0];
    // Only meaningful where the assets test is the binding one.
    expect(with20k.agePensionDetail.bindingTest).toBe('assets');
    expect(without.agePension - with20k.agePension).toBeCloseTo((20_000 / 1_000) * 3 * FY, 0);
  });

  it('does not deem them, because a car earns nothing', () => {
    const without = project(retired(), ruleset, datasets).rows[0];
    const with20k = project(retired(20_000), ruleset, datasets).rows[0];
    expect(with20k.agePensionDetail.deemedIncome).toBeCloseTo(
      without.agePensionDetail.deemedIncome,
      6,
    );
  });

  it('defaults to nothing, so an existing plan is unchanged', () => {
    expect(project(retired(), ruleset, datasets).rows[0].agePension).toBe(
      project(retired(0), ruleset, datasets).rows[0].agePension,
    );
  });
});

describe('recontributing a compulsory drawdown that was not needed', () => {
  const spendLittle = (on: boolean): Scenario => ({
    ...baseCase,
    household: {
      ...baseCase.household,
      recontributeExcessDrawdown: on,
      annualSavings: 0,
      // Well below what the minimum drawdown will force out, so there is a real surplus.
      retirementSpending: 20_000,
      cash: 20_000,
      investments: 50_000,
      people: [
        {
          ...baseCase.household.people[0],
          currentAge: 70,
          dateOfBirth: '1956-01-01',
          retirementAge: 70,
          salary: 0,
          superBalance: 900_000,
        },
      ],
    },
  });

  it('is off unless asked for', () => {
    const off = project(spendLittle(false), ruleset, datasets).rows[0];
    expect(off.contributions.recontributed).toBe(0);
  });

  it('puts the surplus back into super when it is asked for', () => {
    const on = project(spendLittle(true), ruleset, datasets).rows[0];
    expect(on.contributions.recontributed).toBeGreaterThan(0);
    expect(on.income.superPensionPayments).toBeGreaterThan(0);
    // Never more than the minimum forced out in the first place.
    expect(on.contributions.recontributed).toBeLessThanOrEqual(
      on.income.superPensionPayments + 1,
    );
  });

  it('leaves less sitting in cash to be deemed', () => {
    const off = project(spendLittle(false), ruleset, datasets).rows[0];
    const on = project(spendLittle(true), ruleset, datasets).rows[0];
    expect(on.balances.cash).toBeLessThan(off.balances.cash);
  });

  it('stops at 75, when non-concessional contributions stop', () => {
    const old = (): Scenario => {
      const s = spendLittle(true);
      return {
        ...s,
        household: {
          ...s.household,
          people: [
            { ...s.household.people[0], currentAge: 76, dateOfBirth: '1950-01-01', retirementAge: 76 },
          ],
        },
      };
    };
    expect(project(old(), ruleset, datasets).rows[0].contributions.recontributed).toBe(0);
  });
});

describe('spending more than you earn while working', () => {
  const dissaving = (annualSavings: number): Scenario => ({
    ...baseCase,
    household: { ...baseCase.household, annualSavings, cash: 0, investments: 300_000 },
  });

  it('draws the gap from the portfolio rather than ignoring it', () => {
    const saving = project(dissaving(0), ruleset, datasets).rows[0];
    const spending = project(dissaving(-20_000), ruleset, datasets).rows[0];
    expect(spending.balances.investments).toBeLessThan(saving.balances.investments);
    expect(spending.spending.total - saving.spending.total).toBeCloseTo(20_000, 0);
  });

  it('stops at retirement, when retirement spending takes over', () => {
    const rows = project(dissaving(-20_000), ruleset, datasets).rows;
    const retired = rows.find((r) => r.ages.you >= baseCase.household.people[0].retirementAge);
    const working = rows[0];
    expect(working.spending.total).toBeGreaterThan(0);
    // The dissaving line is gone; what is left is the retirement spending target.
    expect(retired!.spending.total).toBeGreaterThan(0);
    expect(retired!.income.salary).toBe(0);
  });
});
