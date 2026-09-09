import { describe, expect, it } from 'vitest';
import { lifeExpectancy, lifespanPercentile, survivalCurve } from '../src/longevity';
import { healthIndexAtAge, outOfPocketAtAge, spendingMultiplier, DEFAULT_SPENDING_PHASES } from '../src/health';
import { loadDataset } from '../src/loadRuleset';
import type { HealthCostCurve, LifeTables } from '../src/types';

const tables = loadDataset<LifeTables>('au-life-tables-2020-22');
const curve = loadDataset<HealthCostCurve>('au-health-cost-curve');
const male = tables.tables.male;
const female = tables.tables.female;

describe('Australian Life Tables 2020-22', () => {
  it('matches the published life expectancy at birth', () => {
    expect(lifeExpectancy(male, 0)).toBeCloseTo(81.31, 2);
    expect(lifeExpectancy(female, 0)).toBeCloseTo(85.34, 2);
  });

  it('matches the published life expectancy at 65', () => {
    expect(lifeExpectancy(male, 65)).toBeCloseTo(20.3, 2);
    expect(lifeExpectancy(female, 65)).toBeCloseTo(22.9, 2);
  });

  it('covers every age from 0 to 109 for both sexes', () => {
    expect(male).toHaveLength(110);
    expect(female).toHaveLength(110);
    expect(male[0].age).toBe(0);
    expect(male[109].age).toBe(109);
  });

  it('has mortality rising monotonically through the older ages', () => {
    const older = male.filter((r) => r.age >= 40);
    for (let i = 1; i < older.length; i++) {
      expect(older[i].qx).toBeGreaterThanOrEqual(older[i - 1].qx);
    }
  });
});

describe('survival and planning horizon', () => {
  it('starts at certainty and decreases', () => {
    const s = survivalCurve(male, 42);
    expect(s.get(42)).toBe(1);
    expect(s.get(60)!).toBeLessThan(1);
    expect(s.get(90)!).toBeLessThan(s.get(80)!);
  });

  it('puts the 90th-percentile lifespan well beyond the mean', () => {
    // This is the build plan's point: planning to the mean leaves a one-in-ten chance of
    // outliving the projection.
    const meanAge = 42 + lifeExpectancy(male, 42);
    const p90 = lifespanPercentile(male, 42, 0.9);
    expect(p90).toBeGreaterThan(meanAge);
    expect(p90).toBeGreaterThan(90);
  });

  it('gives women a longer horizon than men', () => {
    expect(lifespanPercentile(female, 42, 0.9)).toBeGreaterThanOrEqual(
      lifespanPercentile(male, 42, 0.9),
    );
  });

  it('rejects a percentile outside (0, 1)', () => {
    expect(() => lifespanPercentile(male, 42, 0)).toThrow(/between 0 and 1/);
    expect(() => lifespanPercentile(male, 42, 1)).toThrow(/between 0 and 1/);
  });
});

describe('health cost curve', () => {
  it('reproduces the AIHW national average at the all-ages index of 1', () => {
    expect(curve.nationalAveragePerPerson2018_19).toBeCloseTo(5288, 0);
    expect(curve.outOfPocketPerPerson2023_24).toBe(1634);
  });

  it('rises steeply with age - 85+ costs several times what mid-career does', () => {
    const mid = healthIndexAtAge(curve, 42);
    const old = healthIndexAtAge(curve, 90);
    expect(old / mid).toBeGreaterThan(4);
  });

  it('interpolates between band midpoints rather than stepping', () => {
    const a = healthIndexAtAge(curve, 67);
    const lo = healthIndexAtAge(curve, 67 - 1);
    const hi = healthIndexAtAge(curve, 67 + 1);
    expect(a).toBeGreaterThan(lo);
    expect(a).toBeLessThan(hi);
  });

  it('flattens outside the published range rather than extrapolating', () => {
    expect(healthIndexAtAge(curve, 100)).toBe(healthIndexAtAge(curve, 90));
    expect(healthIndexAtAge(curve, 120)).toBe(healthIndexAtAge(curve, 90));
  });

  it('scales the out-of-pocket level by the age index', () => {
    expect(outOfPocketAtAge(curve, 90)).toBeCloseTo(1634 * healthIndexAtAge(curve, 90), 2);
  });

  it('every band index is the band spend over the national average', () => {
    for (const b of curve.bands) {
      expect(b.index).toBeCloseTo(b.spendPerPerson2018_19 / curve.nationalAveragePerPerson2018_19, 3);
    }
  });
});

describe('phased spending', () => {
  it.each([
    [65, 1],
    [74, 1],
    [75, 0.85],
    [84, 0.85],
    [85, 0.75],
    [95, 0.75],
  ])('age %i -> multiplier %f', (age, m) => {
    expect(spendingMultiplier(age, DEFAULT_SPENDING_PHASES)).toBeCloseTo(m, 5);
  });
});
