import type { LifeTable, LifeTables } from './types';

/**
 * Probability of surviving from `fromAge` to each later age, using period mortality.
 *
 * These are PERIOD tables: they hold today's mortality rates fixed, so they take no
 * account of future improvement in mortality. That biases the projection toward dying
 * sooner than a person alive today probably will, which for retirement planning is the
 * dangerous direction - it makes money look like it lasts.
 */
export function survivalCurve(table: LifeTable, fromAge: number): Map<number, number> {
  const qx = new Map(table.map((r) => [r.age, r.qx]));
  const out = new Map<number, number>();
  let alive = 1;
  const maxAge = Math.max(...qx.keys());
  out.set(fromAge, 1);
  for (let age = fromAge; age <= maxAge; age++) {
    alive *= 1 - (qx.get(age) ?? 1);
    out.set(age + 1, alive);
  }
  return out;
}

/**
 * The age by which a given share of people have died - the planning horizon the build
 * plan asks for ("run the plan to at least the 90th-percentile lifespan, not the mean").
 *
 * `percentile` 0.9 returns the age that only 10% of people alive at `fromAge` reach.
 */
export function lifespanPercentile(
  table: LifeTable,
  fromAge: number,
  percentile: number,
): number {
  if (percentile <= 0 || percentile >= 1) {
    throw new Error(`lifespanPercentile: percentile must be between 0 and 1, got ${percentile}`);
  }
  const survival = survivalCurve(table, fromAge);
  const target = 1 - percentile;
  const ages = [...survival.keys()].sort((a, b) => a - b);
  for (const age of ages) {
    if ((survival.get(age) ?? 0) <= target) return age;
  }
  return ages[ages.length - 1];
}

/** Complete expectation of life at an age, straight from the published table. */
export function lifeExpectancy(table: LifeTable, age: number): number {
  const row = table.find((r) => r.age === age);
  if (!row) throw new Error(`lifeExpectancy: no row for age ${age}`);
  return row.ex;
}

export function tableFor(tables: LifeTables, sex: 'male' | 'female'): LifeTable {
  return tables.tables[sex];
}
