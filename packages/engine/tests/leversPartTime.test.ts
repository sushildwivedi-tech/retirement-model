import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { compareScenarios } from '../src/levers';
import {
  earliestRetirementAge,
  earliestRetirementAgeDeterministic,
} from '../src/goalseek';
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

describe('earliest retirement age, deterministically', () => {
  it('finds an age at which the money lasts the whole plan', () => {
    const r = earliestRetirementAgeDeterministic(baseCase, ruleset, datasets);
    expect(r.age).not.toBeNull();
    const at = project(
      {
        ...baseCase,
        household: {
          ...baseCase.household,
          people: [{ ...baseCase.household.people[0], retirementAge: r.age! }],
        },
      },
      ruleset,
      datasets,
    );
    expect(at.moneyRunsOutAge).toBeNull();
  });

  it('is genuinely the EARLIEST such age - one year sooner fails', () => {
    const r = earliestRetirementAgeDeterministic(baseCase, ruleset, datasets);
    const oneEarlier = project(
      {
        ...baseCase,
        household: {
          ...baseCase.household,
          people: [{ ...baseCase.household.people[0], retirementAge: r.age! - 1 }],
        },
      },
      ruleset,
      datasets,
    );
    expect(oneEarlier.moneyRunsOutAge).not.toBeNull();
  });

  it('reports how far it is from the age currently planned', () => {
    const r = earliestRetirementAgeDeterministic(baseCase, ruleset, datasets);
    expect(r.plannedAge).toBe(baseCase.household.people[0].retirementAge);
    expect(r.yearsFromPlan).toBe(r.age! - r.plannedAge);
    expect(r.plannedAgeWorks).toBe(false); // the example retires too early to last
  });

  it('says the planned age works when it does', () => {
    const modest: Scenario = {
      ...baseCase,
      household: { ...baseCase.household, retirementSpending: 25_000 },
    };
    const r = earliestRetirementAgeDeterministic(modest, ruleset, datasets);
    expect(r.plannedAgeWorks).toBe(true);
    expect(r.age!).toBeLessThanOrEqual(r.plannedAge);
  });

  it('returns null when no retirement age works at all', () => {
    // Reaching this branch takes a frankly absurd number, and that is the point. Deferring
    // retirement is such a powerful lever that even a $400k spend is affordable by 77, and
    // even with no salary at all fifty years of untouched compounding rescues $2m a year.
    // The null path exists for completeness rather than for any realistic household.
    const impossible: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        retirementSpending: 100_000_000,
        annualSavings: 0,
        people: [{ ...baseCase.household.people[0], salary: 0 }],
      },
    };
    const r = earliestRetirementAgeDeterministic(impossible, ruleset, datasets);
    expect(r.age).toBeNull();
    expect(r.yearsFromPlan).toBeNull();
  });

  it('working longer can rescue a spend that looks impossible', () => {
    // Worth pinning because it is counter-intuitive and it is what the headline relies on:
    // the answer to "when can I retire" is almost never "never".
    const heavy: Scenario = {
      ...baseCase,
      household: { ...baseCase.household, retirementSpending: 400_000 },
    };
    const r = earliestRetirementAgeDeterministic(heavy, ruleset, datasets);
    expect(r.age).not.toBeNull();
    expect(r.age!).toBeGreaterThan(70);
  });

  it('is always earlier than the answer that accounts for risk', () => {
    // The central path is kinder than most paths, so the deterministic age must not be
    // later than the one that has to clear a confidence bar.
    const det = earliestRetirementAgeDeterministic(baseCase, ruleset, datasets);
    const prob = earliestRetirementAge(baseCase, ruleset, datasets, {
      confidence: 0.85,
      searchRuns: 200,
      runs: 300,
      seed: 5,
    });
    expect(det.age!).toBeLessThanOrEqual(prob.value!);
  });
});
