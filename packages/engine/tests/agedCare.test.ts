import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import { baseCase } from '../src/fixtures/baseCase';
import { toRealRow } from '../src/report';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};

const withCare = (overrides: Partial<NonNullable<Scenario['assumptions']['agedCare']>> = {}): Scenario => ({
  ...baseCase,
  assumptions: {
    ...baseCase.assumptions,
    agedCare: {
      enabled: true,
      fromAge: 85,
      years: 4,
      annualAccommodationCost: 40_000,
      payFullMeansTestedContributions: true,
      ...overrides,
    },
  },
});

describe('residential aged care stress test', () => {
  const off = project(baseCase, ruleset, datasets);
  const on = project(withCare(), ruleset, datasets);

  it('costs nothing before the entry age and nothing after the stay ends', () => {
    expect(on.rows.find((r) => r.ages.you === 84)!.spending.agedCare).toBe(0);
    expect(on.rows.find((r) => r.ages.you === 89)!.spending.agedCare).toBe(0);
  });

  it('charges the basic daily fee plus means-tested contributions plus accommodation', () => {
    const year = on.rows.find((r) => r.ages.you === 85)!;
    const cpi = year.cpiIndex;
    const ac = ruleset.agedCare;
    const expected =
      (ac.basicDailyFeePerDay.value +
        ac.hotellingContributionMaxPerDay.value +
        ac.nonClinicalCareContributionMaxPerDay.value) *
        365 *
        cpi +
      40_000 * cpi;
    expect(year.spending.agedCare).toBeCloseTo(expected, 0);
  });

  it('reproduces the published basic daily fee as 85% of the basic Age Pension', () => {
    const ac = ruleset.agedCare;
    const basicFortnight = 1100.3; // single basic rate, Services Australia
    expect(ac.basicDailyFeePerDay.value).toBeCloseTo((basicFortnight / 14) * 0.85, 1);
  });

  it('stops the non-clinical care contribution at the lifetime cap, which binds before four years', () => {
    const on6 = project(withCare({ years: 6 }), ruleset, datasets);
    const ac = ruleset.agedCare;
    const row = (age: number) => on6.rows.find((r) => r.ages.you === age)!;
    const baseOnly = (age: number) => {
      const r = row(age);
      return (
        (ac.basicDailyFeePerDay.value + ac.hotellingContributionMaxPerDay.value) * 365 * r.cpiIndex +
        40_000 * r.cpiIndex
      );
    };
    // A full year of the contribution is $107.32 x 365 = $39,172, so four full years would
    // be $156,687 - more than the $137,917 lifetime cap. The cap binds first, in year four.
    const fullYear = ac.nonClinicalCareContributionMaxPerDay.value * 365;
    expect(fullYear * 4).toBeGreaterThan(ac.nonClinicalCareLifetimeCap.value);

    // Years 5 and 6 carry no contribution at all.
    expect(row(89).spending.agedCare).toBeCloseTo(baseOnly(89), 0);
    expect(row(90).spending.agedCare).toBeCloseTo(baseOnly(90), 0);
    // Year 4 is a partial year - the remaining cap, not a full year's contribution.
    const year4Contribution = row(88).spending.agedCare - baseOnly(88);
    expect(year4Contribution).toBeGreaterThan(0);
    expect(year4Contribution).toBeLessThan(fullYear * row(88).cpiIndex);
  });

  it('charges only the basic daily fee and accommodation for a low-means resident', () => {
    const low = project(withCare({ payFullMeansTestedContributions: false }), ruleset, datasets);
    const year = low.rows.find((r) => r.ages.you === 85)!;
    const expected =
      ruleset.agedCare.basicDailyFeePerDay.value * 365 * year.cpiIndex + 40_000 * year.cpiIndex;
    expect(year.spending.agedCare).toBeCloseTo(expected, 0);
  });

  it('brings the money-runs-out age forward', () => {
    expect(on.moneyRunsOutAge).not.toBeNull();
    expect(on.moneyRunsOutAge!).toBeLessThanOrEqual(off.moneyRunsOutAge ?? 999);
  });

  it('adds roughly $110k a year in today’s dollars at the maximum contribution', () => {
    const year = toRealRow(on.rows.find((r) => r.ages.you === 85)!);
    expect(year.spending.agedCare).toBeGreaterThan(100_000);
    expect(year.spending.agedCare).toBeLessThan(120_000);
  });
});

describe('one-off expenses', () => {
  const withCar: Scenario = {
    ...baseCase,
    events: [
      ...baseCase.events,
      { kind: 'expense', personId: 'you', atAge: 50, amount: 45_000, label: 'Car', repeatEveryYears: 8 },
    ],
  };
  const r = project(withCar, ruleset, datasets);

  it('charges the expense in the year it falls', () => {
    expect(toRealRow(r.rows.find((x) => x.ages.you === 50)!).spending.oneOff).toBeCloseTo(45_000, 0);
    expect(r.rows.find((x) => x.ages.you === 51)!.spending.oneOff).toBe(0);
  });

  it('repeats on the given cycle, indexed to CPI', () => {
    for (const age of [58, 66, 74]) {
      expect(toRealRow(r.rows.find((x) => x.ages.you === age)!).spending.oneOff).toBeCloseTo(45_000, 0);
    }
    expect(r.rows.find((x) => x.ages.you === 59)!.spending.oneOff).toBe(0);
  });
});

describe('longevity reporting', () => {
  it('says nothing, and warns, when no sex is recorded', () => {
    const r = project(baseCase, ruleset, datasets);
    expect(r.longevity).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/no sex recorded/);
  });

  it('reports life expectancy and the 90th percentile once sex is set', () => {
    const male: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        people: [{ ...baseCase.household.people[0], sex: 'male' }],
      },
    };
    const r = project(male, ruleset, datasets);
    expect(r.longevity).toHaveLength(1);
    const l = r.longevity[0];
    expect(l.sex).toBe('male');
    expect(l.lifeExpectancyAge).toBeGreaterThan(80);
    expect(l.ninetiethPercentileAge).toBeGreaterThan(l.lifeExpectancyAge);
    expect(l.survivalToPlanEnd).toBeGreaterThan(0);
    expect(l.survivalToPlanEnd).toBeLessThan(0.5);
  });
});
