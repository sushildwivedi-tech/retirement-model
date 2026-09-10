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
const pensionAge = ruleset.agePension.eligibilityAge.value;

const retiree = (o: { investments: number; superBalance: number }): Scenario => ({
  ...baseCase,
  household: {
    ...baseCase.household,
    cash: 20_000,
    investments: o.investments,
    annualSavings: 0,
    retirementSpending: 60_000,
    people: [
      {
        ...baseCase.household.people[0],
        currentAge: pensionAge,
        dateOfBirth: `${2026 - pensionAge}-01-01`,
        retirementAge: pensionAge,
        salary: 0,
        superBalance: o.superBalance,
      },
    ],
  },
});

describe('Commonwealth Seniors Health Card', () => {
  it('goes to the self-funded retiree it exists for', () => {
    // Too much to get any pension, but nowhere near the income limit.
    const row = project(retiree({ investments: 1_200_000, superBalance: 1_500_000 }), ruleset, datasets)
      .rows[0];
    expect(row.agePension).toBe(0);
    expect(row.seniorsHealthCard).toBe(true);
  });

  it('is not needed by someone already on the pension', () => {
    const row = project(retiree({ investments: 50_000, superBalance: 100_000 }), ruleset, datasets)
      .rows[0];
    expect(row.agePension).toBeGreaterThan(0);
    expect(row.seniorsHealthCard).toBe(false);
  });

  it('is refused above the income limit', () => {
    // Deemed income on a very large pension balance alone clears the single limit.
    const row = project(retiree({ investments: 6_000_000, superBalance: 6_000_000 }), ruleset, datasets)
      .rows[0];
    expect(row.seniorsHealthCard).toBe(false);
  });

  it('does not exist before Age Pension age', () => {
    const rows = project(baseCase, ruleset, datasets).rows;
    const young = rows.find((r) => r.ages.you === pensionAge - 1);
    expect(young!.seniorsHealthCard).toBe(false);
  });

  it('is reported as eligibility, never as a dollar figure', () => {
    const row = project(retiree({ investments: 1_200_000, superBalance: 1_500_000 }), ruleset, datasets)
      .rows[0];
    expect(typeof row.seniorsHealthCard).toBe('boolean');
  });
});
