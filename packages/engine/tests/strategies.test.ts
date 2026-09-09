import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { maxSustainableSpend, earliestRetirementAge } from '../src/goalseek';
import { crashInFirstRetirementYear, runHistoricalSequence, SHIPPED_SEQUENCES } from '../src/stressTests';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import { baseCase } from '../src/fixtures/baseCase';
import type { DrawdownStrategy, HealthCostCurve, LifeTables, Scenario } from '../src/types';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};
const withStrategy = (s: DrawdownStrategy, extra: Partial<Scenario['assumptions']> = {}): Scenario => ({
  ...baseCase,
  assumptions: { ...baseCase.assumptions, drawdownStrategy: s, ...extra },
});

describe('drawdown strategies', () => {
  const strategies: DrawdownStrategy[] = [
    'outsideSuperFirst',
    'superFirst',
    'proportional',
    'cashBuffer',
  ];

  it.each(strategies)('%s funds spending without going negative', (s) => {
    const r = project(withStrategy(s), ruleset, datasets);
    for (const row of r.rows) {
      expect(row.balances.cash).toBeGreaterThanOrEqual(-0.01);
      expect(row.balances.investments).toBeGreaterThanOrEqual(-0.01);
      expect(row.balances.superAccumulation).toBeGreaterThanOrEqual(-0.01);
      expect(row.balances.superPension).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it.each(strategies)('%s only reports a shortfall once nothing accessible is left', (s) => {
    const r = project(withStrategy(s), ruleset, datasets);
    for (const row of r.rows.filter((x) => x.shortfall > 0)) {
      expect(row.balances.accessible).toBeLessThan(1);
    }
  });

  it('superFirst cannot touch super before preservation age either', () => {
    const r = project(withStrategy('superFirst'), ruleset, datasets);
    for (const row of r.rows.filter((x) => x.ages.you < 60)) {
      expect(row.drawdown.superAccumulation).toBe(0);
      expect(row.drawdown.superPension).toBe(0);
    }
  });

  it('superFirst leaves more outside super and less in super than outsideSuperFirst', () => {
    // Needs a household that still holds both after preservation age, so this builds a
    // richer one rather than leaning on however wealthy the shared example happens to be.
    const rich = (st: DrawdownStrategy): Scenario => ({
      ...withStrategy(st),
      household: {
        ...baseCase.household,
        investments: 900_000,
        // Spending high enough that drawdown actually happens after preservation age -
        // a household that never touches either bucket cannot show a difference.
        retirementSpending: 140_000,
        people: [{ ...baseCase.household.people[0], superBalance: 600_000 }],
      },
    });
    const a = project(rich('outsideSuperFirst'), ruleset, datasets);
    const b = project(rich('superFirst'), ruleset, datasets);
    const at = (r: typeof a, age: number) => r.rows.find((x) => x.ages.you === age)!;
    expect(at(b, 65).balances.investments).toBeGreaterThan(at(a, 65).balances.investments);
    const superOf = (r: typeof a, age: number) =>
      at(r, age).balances.superAccumulation + at(r, age).balances.superPension;
    expect(superOf(b, 65)).toBeLessThan(superOf(a, 65));
  });

  it('cashBuffer keeps cash on hand instead of running it to zero', () => {
    const r = project(withStrategy('cashBuffer', { cashBufferYears: 3 }), ruleset, datasets);
    const mid = r.rows.find((x) => x.ages.you === 55)!;
    expect(mid.balances.cash).toBeGreaterThan(0);
    const plain = project(withStrategy('outsideSuperFirst'), ruleset, datasets);
    expect(mid.balances.cash).toBeGreaterThan(
      plain.rows.find((x) => x.ages.you === 55)!.balances.cash,
    );
  });

  it('the choice of strategy actually changes the outcome', () => {
    const ages = strategies.map((s) => project(withStrategy(s), ruleset, datasets).moneyRunsOutAge);
    expect(new Set(ages).size).toBeGreaterThan(1);
  });
});

describe('glide path', () => {
  it('lowers the super return from the given age', () => {
    const glided: Scenario = {
      ...baseCase,
      assumptions: {
        ...baseCase.assumptions,
        glidePath: [
          { fromAge: 55, expectedReturn: 0.065, volatility: 0.08, label: 'Balanced' },
          { fromAge: 65, expectedReturn: 0.045, volatility: 0.04, label: 'Conservative' },
        ],
      },
    };
    const plain = project(baseCase, ruleset, datasets);
    const g = project(glided, ruleset, datasets);
    const at = (r: typeof plain, age: number) =>
      r.rows.find((x) => x.ages.you === age)!.balances.superPension +
      r.rows.find((x) => x.ages.you === age)!.balances.superAccumulation;
    // Same up to 54, lower afterwards - a more defensive mix gives up median outcome.
    expect(at(g, 54)).toBeCloseTo(at(plain, 54), 0);
    expect(at(g, 66)).toBeLessThan(at(plain, 66));
  });
});

describe('goal seek', () => {
  it('finds a maximum sustainable spend below the current target', () => {
    const r = maxSustainableSpend(baseCase, ruleset, datasets, {
      confidence: 0.85,
      searchRuns: 200,
      runs: 400,
      seed: 3,
    });
    expect(r.value).not.toBeNull();
    expect(r.value!).toBeGreaterThan(0);
    expect(r.value!).toBeLessThan(baseCase.household.retirementSpending);
  });

  it('finds an earliest retirement age later than the planned one', () => {
    const r = earliestRetirementAge(baseCase, ruleset, datasets, {
      confidence: 0.85,
      searchRuns: 200,
      runs: 400,
      seed: 3,
    });
    expect(r.value).not.toBeNull();
    expect(r.value!).toBeGreaterThan(baseCase.household.people[0].retirementAge);
    expect(r.value!).toBeLessThanOrEqual(baseCase.assumptions.planToAge);
  });

  it('a lower confidence target permits a higher spend', () => {
    const strict = maxSustainableSpend(baseCase, ruleset, datasets, { confidence: 0.9, searchRuns: 150, runs: 200, seed: 6 });
    const loose = maxSustainableSpend(baseCase, ruleset, datasets, { confidence: 0.5, searchRuns: 150, runs: 200, seed: 6 });
    expect(loose.value!).toBeGreaterThan(strict.value!);
  });
});

describe('stress tests', () => {
  it('ships no historical sequences rather than invented ones', () => {
    // A plausible-looking series would defeat the purpose: the point of a historical
    // stress test is that the returns actually happened.
    expect(SHIPPED_SEQUENCES).toEqual([]);
  });

  it('replays a supplied sequence', () => {
    const flat = Array.from({ length: 10 }, () => ({
      cash: 0,
      investments: 0,
      superAccumulation: 0,
      primaryResidence: 0,
    }));
    const r = runHistoricalSequence(
      baseCase,
      ruleset,
      {
        id: 'flat',
        label: 'Ten flat years',
        startYear: 2026,
        source: 'test',
        url: '',
        retrievedAt: '2026-09-09',
        returns: flat,
      },
      datasets,
    );
    expect(r.sequenceYears).toBe(10);
    // Zero returns for a decade must leave less than the normal assumption would.
    const normal = project(baseCase, ruleset, datasets);
    const at = (x: typeof normal, age: number) => x.rows.find((y) => y.ages.you === age)!;
    expect(at(r.result, 51).balances.accessible).toBeLessThan(at(normal, 51).balances.accessible);
  });

  it('a crash in the first year of retirement brings the failure forward', () => {
    const crash = crashInFirstRetirementYear(baseCase, ruleset, datasets, { drop: -0.3 });
    const normal = project(baseCase, ruleset, datasets);
    expect(crash.result.moneyRunsOutAge).not.toBeNull();
    // Sequence risk: the same average return, arriving in a worse order, costs years.
    expect(crash.result.moneyRunsOutAge!).toBeLessThan(normal.moneyRunsOutAge ?? 999);
  });
});
