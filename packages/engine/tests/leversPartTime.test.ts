import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { compareScenarios } from '../src/levers';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import { baseCase } from '../src/fixtures/baseCase';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};
const withPartTime = (amount: number, years: number): Scenario => ({
  ...baseCase,
  household: {
    ...baseCase.household,
    people: [
      {
        ...baseCase.household.people[0],
        partTimeIncome: { amount, fromAge: 47, toAge: 47 + years },
      },
    ],
  },
});

describe('part-time income in retirement', () => {
  const r = project(withPartTime(30_000, 5), ruleset, datasets);
  const at = (age: number) => r.rows.find((x) => x.ages.you === age)!;

  it('is paid only inside its window', () => {
    expect(at(46).income.partTime).toBe(0);
    expect(at(47).income.partTime).toBeGreaterThan(0);
    expect(at(51).income.partTime).toBeGreaterThan(0);
    expect(at(52).income.partTime).toBe(0);
  });

  it('is indexed to CPI', () => {
    expect(at(47).income.partTime).toBeCloseTo(30_000 * Math.pow(1.025, 5), 0);
    expect(at(51).income.partTime).toBeCloseTo(30_000 * Math.pow(1.025, 9), 0);
  });

  it('does NOT attract the super guarantee - it is contracting, not employment', () => {
    for (let age = 47; age < 52; age++) {
      expect(at(age).contributions.superGuarantee).toBe(0);
    }
  });

  it('reduces how much has to be drawn from the portfolio', () => {
    const without = project(baseCase, ruleset, datasets);
    const w = (x: typeof without, age: number) => x.rows.find((y) => y.ages.you === age)!;
    expect(at(48).drawdown.total).toBeLessThan(w(without, 48).drawdown.total);
    expect(at(48).balances.accessible).toBeGreaterThan(w(without, 48).balances.accessible);
  });

  it('makes the money last longer', () => {
    const without = project(baseCase, ruleset, datasets);
    expect(without.moneyRunsOutAge).not.toBeNull();
    // Five years of part-time work at the start of retirement is enough to carry the
    // example household the whole way, so "later" here means "never runs out at all".
    expect(r.moneyRunsOutAge === null || r.moneyRunsOutAge > without.moneyRunsOutAge!).toBe(true);
  });

  it('does most of its work in the bridge, where a dollar is worth most', () => {
    // Earning during the bridge protects the only assets that can be spent then, so a
    // smaller amount earned early beats the same amount earned after super unlocks.
    const early = project(withPartTime(20_000, 5), ruleset, datasets);
    const late: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        people: [
          {
            ...baseCase.household.people[0],
            partTimeIncome: { amount: 20_000, fromAge: 62, toAge: 67 },
          },
        ],
      },
    };
    const lateResult = project(late, ruleset, datasets);
    const score = (x: typeof early) => (x.moneyRunsOutAge === null ? 999 : x.moneyRunsOutAge);
    expect(score(early)).toBeGreaterThan(score(lateResult));
  });

  it('is taxable, unlike a super pension payment', () => {
    expect(at(48).tax.personal).toBeGreaterThan(0);
  });

  it('counts as employment income for the Work Bonus once of pension age', () => {
    // Running the part-time window across Age Pension age exercises the Work Bonus path.
    const late = project(
      {
        ...baseCase,
        household: {
          ...baseCase.household,
          people: [
            {
              ...baseCase.household.people[0],
              partTimeIncome: { amount: 20_000, fromAge: 67, toAge: 72 },
            },
          ],
        },
      },
      ruleset,
      datasets,
    );
    const row = late.rows.find((x) => x.ages.you === 68)!;
    expect(row.income.partTime).toBeGreaterThan(0);
    // The Work Bonus absorbs part of it, so assessed income is below the raw earnings.
    expect(row.agePensionDetail.assessedIncome).toBeLessThan(
      row.income.partTime + row.agePensionDetail.deemedIncome,
    );
  });
});

describe('comparing plan changes', () => {
  it('reports a baseline and one outcome per variant', () => {
    const c = compareScenarios(
      baseCase,
      [
        { label: 'Retire two years later', scenario: { ...baseCase, household: { ...baseCase.household, people: [{ ...baseCase.household.people[0], retirementAge: 49 }] } } },
        { label: 'Spend 10k less', scenario: { ...baseCase, household: { ...baseCase.household, retirementSpending: baseCase.household.retirementSpending - 10_000 } } },
      ],
      ruleset,
      datasets,
    );
    expect(c.baseline.label).toBe('Current plan');
    expect(c.outcomes).toHaveLength(2);
  });

  it('gives a positive delta to changes that help', () => {
    const better: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        retirementSpending: baseCase.household.retirementSpending - 15_000,
      },
    };
    const c = compareScenarios(baseCase, [{ label: 'Spend less', scenario: better }], ruleset, datasets);
    const o = c.outcomes[0];
    expect(o.fixesIt || (o.deltaYears ?? 0) > 0).toBe(true);
  });

  it('gives a negative delta to changes that hurt', () => {
    const worse: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        retirementSpending: baseCase.household.retirementSpending + 15_000,
      },
    };
    const c = compareScenarios(baseCase, [{ label: 'Spend more', scenario: worse }], ruleset, datasets);
    expect(c.outcomes[0].deltaYears!).toBeLessThan(0);
  });

  it('says "fixes it" rather than inventing a number when a change removes the failure', () => {
    const muchBetter: Scenario = {
      ...baseCase,
      household: { ...baseCase.household, retirementSpending: 20_000 },
    };
    const c = compareScenarios(baseCase, [{ label: 'Spend very little', scenario: muchBetter }], ruleset, datasets);
    expect(c.outcomes[0].runsOutAge).toBeNull();
    expect(c.outcomes[0].fixesIt).toBe(true);
    expect(c.outcomes[0].deltaYears).toBeNull();
  });
});
