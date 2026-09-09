import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import type { HealthCostCurve, LifeTables } from '../src/types';
import { baseCase } from '../src/fixtures/baseCase';
import { toRealRow } from '../src/report';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};
const result = project(baseCase, ruleset, datasets);

const at = (age: number) => result.rows.find((r) => r.ages.you === age)!;

describe('Example household - structural behaviour', () => {
  it('runs from age 42 to the plan-to age of 95', () => {
    expect(result.rows[0].ages.you).toBe(42);
    expect(result.rows.at(-1)!.ages.you).toBe(95);
    expect(result.rows).toHaveLength(54);
  });

  it('saves, and does not spend, while still working', () => {
    for (let age = 42; age < 47; age++) {
      expect(at(age).spending.total).toBe(0);
      expect(at(age).savings).toBeGreaterThan(0);
    }
  });

  it('starts spending at the retirement age and stops saving', () => {
    expect(at(47).spending.total).toBeGreaterThan(0);
    expect(at(47).savings).toBe(0);
  });

  it('does not put gross salary on the balance sheet while working', () => {
    // `annualSavings` is the net of salary after living costs and tax. Counting the
    // salary as surplus as well would double-count it into cash every working year.
    for (let age = 42; age < 47; age++) {
      expect(at(age).income.salary).toBeGreaterThan(0); // it still sets the SG base
      expect(at(age).income.total).toBe(0); // but none of it is spendable here
    }
  });

  it('taxes investment income at the marginal rate salary puts it at, and only that', () => {
    // Distributions land on top of salary, so they attract that marginal rate. Salary tax
    // itself is inside `savings` and must not be charged again.
    const { investments } = baseCase.household;
    const yieldRate = baseCase.assumptions.investmentIncomeYield;
    const expectedIncome = investments * yieldRate;
    const marginal = 0.3 + 0.02; // 100k salary sits in the 30c bracket, plus Medicare
    const first = at(42);
    expect(first.income.investmentIncome).toBeCloseTo(expectedIncome, 2);
    expect(first.tax.personal).toBeCloseTo(expectedIncome * marginal, 2);
    expect(first.balances.cash).toBeCloseTo(expectedIncome * (1 - marginal), 2);
  });

  it('accrues the super guarantee on salary while working, and stops at retirement', () => {
    const salary = baseCase.household.people[0].salary;
    const sg = at(42)!.contributions.superGuarantee;
    expect(sg).toBeCloseTo(salary * 0.12, 0);
    expect(at(46).contributions.superGuarantee).toBeGreaterThan(sg); // wage growth
    expect(at(47).contributions.superGuarantee).toBe(0);
  });

  it('indexes retirement spending to CPI', () => {
    const target = baseCase.household.retirementSpending;
    // cpiIndex on the row is rounded for display, so index independently here.
    expect(at(47).spending.baseline).toBeCloseTo(target * Math.pow(1.025, 5), 0);
    // In today's dollars the baseline is flat at the target until the phases bite.
    expect(toRealRow(at(60)).spending.baseline).toBeCloseTo(target, 0);
    expect(toRealRow(at(74)).spending.baseline).toBeCloseTo(target, 0);
  });

  it('steps real spending down through the go-go / slow-go / no-go phases', () => {
    const target = baseCase.household.retirementSpending;
    expect(toRealRow(at(74)).spending.baseline).toBeCloseTo(target, 0);
    expect(toRealRow(at(75)).spending.baseline).toBeCloseTo(target * 0.85, 0);
    expect(toRealRow(at(84)).spending.baseline).toBeCloseTo(target * 0.85, 0);
    expect(toRealRow(at(85)).spending.baseline).toBeCloseTo(target * 0.75, 0);
  });

  it('adds an age-shaped health cost line that rises as baseline spending falls', () => {
    // The two move in opposite directions, which is exactly why the build plan asks for
    // health to be a separate line rather than folded into the baseline.
    const young = toRealRow(at(50));
    const old = toRealRow(at(90));
    expect(old.spending.health).toBeGreaterThan(young.spending.health * 2);
    expect(old.spending.baseline).toBeLessThan(young.spending.baseline);
  });

  it('refuses to run with health costs on but no curve supplied', () => {
    expect(() => project(baseCase, ruleset, {})).toThrow(/no health-cost curve/);
  });
});

describe('Example household - preservation age is the binding constraint', () => {
  it('reports a 13-year bridge from retirement at 47 to preservation age 60', () => {
    expect(result.bridge).toHaveLength(1);
    expect(result.bridge[0]).toMatchObject({ personId: 'you', startAge: 47, endAge: 60, years: 13 });
  });

  it('cannot touch super before age 60', () => {
    for (let age = 47; age < 60; age++) {
      expect(at(age).drawdown.superAccumulation).toBe(0);
    }
  });

  it('excludes super from accessible assets before 60 and includes it from 60', () => {
    const before = at(59);
    const after = at(60);
    expect(before.balances.accessible).toBeCloseTo(before.balances.cash + before.balances.investments, 0);
    expect(after.balances.accessible).toBeCloseTo(
      after.balances.cash +
        after.balances.investments +
        after.balances.superAccumulation +
        after.balances.superPension,
      0,
    );
  });
});

describe('Example household - the downsize event', () => {
  const downsizeYear = at(47);

  it('fires once, at 47', () => {
    const firings = result.rows.filter((r) => r.events.some((e) => e.startsWith('Downsize')));
    expect(firings).toHaveLength(1);
    expect(firings[0].ages.you).toBe(47);
  });

  it('replaces the home with the $750k (indexed) one', () => {
    const growth = Math.pow(1.04, 6); // t = 5, applied at t + 1.
    const newHome = (baseCase.events.find((e) => e.kind === 'downsize') as { newHomeValue: number })
      .newHomeValue;
    expect(downsizeYear.balances.primaryResidence).toBeCloseTo(newHome * growth, 0);
  });

  it('is too early for a downsizer super contribution, and says so', () => {
    expect(downsizeYear.contributions.downsizer).toBe(0);
    expect(downsizeYear.events.join(' ')).toMatch(/NOT eligible/);
    expect(result.warnings.join(' ')).toMatch(/below the downsizer contribution age of 55/);
  });

  it('puts the net proceeds into outside-super investments', () => {
    const before = at(46).balances.investments;
    expect(downsizeYear.balances.investments).toBeGreaterThan(before);
  });
});

describe('Example household - the headline answer', () => {
  it('produces a money-runs-out age (or reports that it never runs out)', () => {
    // Pins the example household's headline answer so an unintended change is visible.
    expect(result.moneyRunsOutAge).toMatchInlineSnapshot(`80`);
  });

  it('flags the parts of the spec that are still not modelled', () => {
    expect(result.notModelled.length).toBeGreaterThan(5);
    expect(result.notModelled.join(' ')).toMatch(/Monte Carlo/);
    expect(result.notModelled.join(' ')).toMatch(/probability-weighted/);
  });

  it('no longer claims couples are unmodelled, now that they are', () => {
    // A stale entry in this list is worse than no list: it is the panel the UI shows to
    // say how much to trust the numbers.
    expect(result.notModelled.join(' ')).not.toMatch(/Couples - a second person/);
  });
});

describe('accounting identity', () => {
  it('never reports a negative balance in any bucket', () => {
    for (const r of result.rows) {
      expect(r.balances.cash).toBeGreaterThanOrEqual(0);
      expect(r.balances.investments).toBeGreaterThanOrEqual(0);
      expect(r.balances.superAccumulation).toBeGreaterThanOrEqual(0);
    }
  });

  it('only reports a shortfall once every accessible bucket is empty', () => {
    for (const r of result.rows.filter((x) => x.shortfall > 0)) {
      expect(r.balances.accessible).toBeCloseTo(0, 2);
    }
  });
});
