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

/**
 * A retired couple with an age gap, both already stopped, living off the portfolio. The
 * younger partner's super is the variable: everything else is held still.
 */
const retiredCouple = (o: {
  youngerAge: number;
  youngerSuper: number;
  olderSuper?: number;
  youngerInPension?: boolean;
}): Scenario => ({
  ...baseCase,
  household: {
    ...baseCase.household,
    cash: 50_000,
    investments: 150_000,
    annualSavings: 0,
    retirementSpending: 50_000,
    people: [
      {
        ...baseCase.household.people[0],
        id: 'older',
        name: 'Older',
        currentAge: 68,
        dateOfBirth: '1958-01-01',
        retirementAge: 68,
        salary: 0,
        superBalance: o.olderSuper ?? 100_000,
      },
      {
        ...baseCase.household.people[0],
        id: 'younger',
        name: 'Younger',
        currentAge: o.youngerAge,
        dateOfBirth: `${2026 - o.youngerAge}-01-01`,
        retirementAge: o.youngerAge,
        salary: 0,
        superBalance: o.youngerSuper,
      },
    ],
  },
  assumptions: {
    ...baseCase.assumptions,
    // Keep the younger partner's balance in accumulation, so the exemption is what is
    // being measured rather than the pension-phase conversion.
    convertSuperToPensionPhase: o.youngerInPension ?? false,
  },
});

const firstYear = (s: Scenario) => project(s, ruleset, datasets).rows[0];

describe('accumulation super is exempt until its owner reaches Age Pension age', () => {
  it('ignores a younger partner’s accumulation balance entirely', () => {
    // $400,000 held by a 62-year-old is invisible to both tests, so the household is
    // assessed as though it were not there at all.
    const withSuper = firstYear(retiredCouple({ youngerAge: 62, youngerSuper: 400_000 }));
    const without = firstYear(retiredCouple({ youngerAge: 62, youngerSuper: 0 }));
    expect(withSuper.agePension).toBeCloseTo(without.agePension, 0);
    expect(withSuper.agePensionDetail.exemptSuper).toBeCloseTo(400_000, -3);
    expect(without.agePensionDetail.exemptSuper).toBe(0);
  });

  it('assesses the same money once it sits in the older partner’s account', () => {
    // Identical household wealth, identical ages. The only difference is whose account
    // holds the $400,000 - which is precisely the decision the strategy turns on.
    const inYounger = firstYear(
      retiredCouple({ youngerAge: 62, youngerSuper: 400_000, olderSuper: 0 }),
    );
    const inOlder = firstYear(
      retiredCouple({ youngerAge: 62, youngerSuper: 0, olderSuper: 400_000 }),
    );
    expect(inOlder.agePension).toBeLessThan(inYounger.agePension);
    expect(inOlder.agePensionDetail.exemptSuper).toBe(0);
  });

  it('is worth real money — thousands a year, not a rounding difference', () => {
    const inYounger = firstYear(
      retiredCouple({ youngerAge: 62, youngerSuper: 400_000, olderSuper: 0 }),
    );
    const inOlder = firstYear(
      retiredCouple({ youngerAge: 62, youngerSuper: 0, olderSuper: 400_000 }),
    );
    // On this household it is worth about $3,900 a year. It is bounded by how much
    // pension there is to lose - only one partner is of pension age here - and by which
    // test binds; where the assets test bites across the whole balance the $3 per $1,000
    // per fortnight taper puts it an order of magnitude higher.
    expect(inYounger.agePension - inOlder.agePension).toBeGreaterThan(3_000);
  });

  it('is worth far more where the assets test bites across the whole balance', () => {
    const inYounger = firstYear(
      retiredCouple({ youngerAge: 66, youngerSuper: 400_000, olderSuper: 250_000 }),
    );
    const inOlder = firstYear(
      retiredCouple({ youngerAge: 66, youngerSuper: 0, olderSuper: 650_000 }),
    );
    expect(inYounger.agePension - inOlder.agePension).toBeGreaterThan(10_000);
  });

  it('still assesses a younger partner’s PENSION-phase balance', () => {
    // Converting to a pension is a choice, and it costs the exemption.
    const accumulation = firstYear(retiredCouple({ youngerAge: 62, youngerSuper: 400_000 }));
    const pensionPhase = firstYear(
      retiredCouple({ youngerAge: 62, youngerSuper: 400_000, youngerInPension: true }),
    );
    expect(pensionPhase.agePension).toBeLessThan(accumulation.agePension);
    expect(pensionPhase.agePensionDetail.exemptSuper).toBe(0);
  });

  it('exempts nothing for a single person of pension age', () => {
    const only = baseCase.household.people[0].id;
    const row = project(baseCase, ruleset, datasets).rows.find(
      (r) => r.ages[only] >= pensionAge,
    );
    expect(row?.agePensionDetail.exemptSuper).toBe(0);
  });

  it('reports the exemption falling away year by year as the younger partner ages', () => {
    const rows = project(retiredCouple({ youngerAge: 62, youngerSuper: 400_000 }), ruleset, datasets)
      .rows;
    // The older partner's age drives the row; the younger turns 67 five years in.
    expect(rows[0].agePensionDetail.exemptSuper).toBeGreaterThan(0);
    expect(rows[5].agePensionDetail.exemptSuper).toBe(0);
  });
});
