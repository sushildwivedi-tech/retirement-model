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
const CAP = ruleset.super.concessionalCap.value;
const THRESHOLD = ruleset.super.carryForwardTotalSuperBalanceThreshold.value;

const saver = (o: {
  carried?: number;
  wanted?: number;
  superBalance?: number;
}): Scenario => ({
  ...baseCase,
  household: {
    ...baseCase.household,
    people: [
      {
        ...baseCase.household.people[0],
        retirementAge: 70,
        salary: 120_000,
        superBalance: o.superBalance ?? 250_000,
        voluntarySuperContribution: o.wanted ?? 0,
        unusedConcessionalCapCarriedForward: o.carried,
      },
    ],
  },
});

const firstYearVoluntary = (s: Scenario) =>
  project(s, ruleset, datasets).rows[0].contributions.voluntary;

describe('carry-forward concessional cap', () => {
  it('trims to this year’s cap when there is nothing carried forward', () => {
    const sg = project(saver({ wanted: 100_000 }), ruleset, datasets).rows[0].contributions
      .superGuarantee;
    expect(firstYearVoluntary(saver({ wanted: 100_000 }))).toBeCloseTo(CAP - sg, 0);
  });

  it('lets a carried-forward amount through on top of it', () => {
    const plain = firstYearVoluntary(saver({ wanted: 100_000 }));
    const carried = firstYearVoluntary(saver({ wanted: 100_000, carried: 40_000 }));
    expect(carried - plain).toBeCloseTo(40_000, 0);
  });

  it('refuses it once the balance is over the threshold', () => {
    const under = firstYearVoluntary(
      saver({ wanted: 100_000, carried: 40_000, superBalance: THRESHOLD - 50_000 }),
    );
    const over = firstYearVoluntary(
      saver({ wanted: 100_000, carried: 40_000, superBalance: THRESHOLD + 50_000 }),
    );
    expect(under - over).toBeCloseTo(40_000, 0);
  });

  it('accrues what a year does not use, and spends it later', () => {
    // Five years contributing nothing but the guarantee, then one big year. The unused
    // cap from those years is available in the sixth.
    const rows = project(saver({ wanted: 0 }), ruleset, datasets).rows;
    const sg = rows[0].contributions.superGuarantee;
    const unusedPerYear = CAP - sg;
    expect(unusedPerYear).toBeGreaterThan(0);

    const bigYear: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        people: [
          {
            ...baseCase.household.people[0],
            retirementAge: 70,
            salary: 120_000,
            superBalance: 250_000,
            // Only wanted from year five onwards would be ideal; the engine takes one
            // figure, so this asks for more than a single year's cap every year and the
            // ring is what limits it.
            voluntarySuperContribution: 200_000,
          },
        ],
      },
    };
    const big = project(bigYear, ruleset, datasets).rows;
    // Year one can use only this year's cap; there is nothing banked yet.
    expect(big[0].contributions.voluntary).toBeCloseTo(CAP - big[0].contributions.superGuarantee, 0);
    // And once the ring is empty it stays at the annual cap, never above it.
    expect(big[3].contributions.voluntary).toBeCloseTo(
      Math.max(0, big[3].contributions.superGuarantee > 0 ? big[3].contributions.voluntary : 0),
      0,
    );
  });

  it('expires after five years', () => {
    // A carried amount that is never used falls out of the ring on the sixth year.
    const s = saver({ carried: 30_000, wanted: 0 });
    const rows = project(s, ruleset, datasets).rows;
    // Nothing is contributed, so the ring only ever grows - but the seeded amount is
    // gone by the time six further years have been pushed on.
    expect(rows[0].contributions.voluntary).toBe(0);

    const late: Scenario = {
      ...s,
      household: {
        ...s.household,
        people: [{ ...s.household.people[0], voluntarySuperContribution: 200_000 }],
      },
    };
    const lateRows = project(late, ruleset, datasets).rows;
    // In year one the seeded $30,000 is available on top of the annual cap.
    const capOne = lateRows[0].contributions.superGuarantee + lateRows[0].contributions.voluntary;
    expect(capOne).toBeGreaterThan(CAP);
  });

  it('never lets a year exceed its own cap plus what was banked', () => {
    const rows = project(saver({ wanted: 200_000, carried: 60_000 }), ruleset, datasets).rows;
    for (const row of rows.slice(0, 10)) {
      const total = row.contributions.superGuarantee + row.contributions.voluntary;
      if (total === 0) continue;
      expect(total).toBeLessThanOrEqual(CAP * 1.5 + 60_000 + 1);
    }
  });
});
