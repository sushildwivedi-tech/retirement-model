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
const NC_CAP = ruleset.super.nonConcessionalCap.value;
const TBC = ruleset.super.generalTransferBalanceCap.value;

const contributor = (o: {
  amount?: number;
  age?: number;
  superBalance?: number;
  cash?: number;
  investments?: number;
}): Scenario => ({
  ...baseCase,
  household: {
    ...baseCase.household,
    cash: o.cash ?? 200_000,
    investments: o.investments ?? 300_000,
    people: [
      {
        ...baseCase.household.people[0],
        currentAge: o.age ?? 42,
        dateOfBirth: `${2026 - (o.age ?? 42)}-01-01`,
        retirementAge: 70,
        superBalance: o.superBalance ?? 250_000,
        afterTaxContribution: o.amount,
      },
    ],
  },
});

const first = (s: Scenario) => project(s, ruleset, datasets).rows[0];

describe('after-tax contributions', () => {
  it('do not happen unless asked for', () => {
    expect(first(contributor({})).contributions.afterTax).toBe(0);
  });

  it('go in untaxed, because the tax was already paid', () => {
    const none = first(contributor({}));
    const some = first(contributor({ amount: 50_000 }));
    expect(some.contributions.afterTax).toBeCloseTo(50_000, 0);
    // The fund takes nothing off it: contributions tax is unchanged.
    expect(some.tax.superContributions).toBeCloseTo(none.tax.superContributions, 0);
  });

  it('come out of savings rather than appearing from nowhere', () => {
    const none = first(contributor({}));
    const some = first(contributor({ amount: 50_000 }));
    const movedOut =
      none.balances.cash + none.balances.investments - (some.balances.cash + some.balances.investments);
    expect(movedOut).toBeGreaterThan(45_000);
  });

  it('are trimmed to the cap', () => {
    expect(first(contributor({ amount: NC_CAP * 5 })).contributions.afterTax).toBeCloseTo(
      NC_CAP,
      0,
    );
  });

  it('allow three years at once after two quiet years — the bring-forward', () => {
    // Nothing for two years, then a big ask: the room has built to three caps.
    const rows = project(contributor({ amount: 0 }), ruleset, datasets).rows;
    expect(rows[2].contributions.afterTax).toBe(0);

    const s = contributor({ amount: NC_CAP * 5, cash: 2_000_000, investments: 500_000 });
    const big = project(s, ruleset, datasets).rows;
    // Year one: one cap, since the room starts at one.
    expect(big[0].contributions.afterTax).toBeCloseTo(NC_CAP, -2);
    // And never more than three caps in any single year.
    for (const row of big.slice(0, 12)) {
      expect(row.contributions.afterTax).toBeLessThanOrEqual(NC_CAP * 3 * row.cpiIndex + 1);
    }
  });

  it('stop once the balance reaches the transfer balance cap', () => {
    const rich = first(contributor({ amount: 50_000, superBalance: TBC + 10_000 }));
    expect(rich.contributions.afterTax).toBe(0);
  });

  it('stop at 75', () => {
    const old = first(contributor({ amount: 50_000, age: 76 }));
    expect(old.contributions.afterTax).toBe(0);
  });

  it('are limited by what the household actually has', () => {
    const broke = first(contributor({ amount: 50_000, cash: 1_000, investments: 2_000 }));
    expect(broke.contributions.afterTax).toBeLessThanOrEqual(3_000);
  });
});
