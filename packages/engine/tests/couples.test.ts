import { describe, expect, it } from 'vitest';
import { agePension } from '../src/agePension';
import { project } from '../src/engine';
import {
  earliestRetirementAge,
  earliestRetirementAgeDeterministic,
} from '../src/goalseek';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import type { HealthCostCurve, LifeTables } from '../src/types';
import { baseCase } from '../src/fixtures/baseCase';
import type { Scenario } from '../src/types';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};
const ap = ruleset.agePension;
const FY = ap.fortnightsPerYear.value;
const COUPLE_EACH = ap.maxRateFortnight.value.coupleEach.total * FY;
const COUPLE_COMBINED = ap.maxRateFortnight.value.coupleCombined.total * FY;

/**
 * `assets` sets BOTH the assessable and the deemed (financial) figure, which is realistic.
 * `assessableOnly` sets just the assets-test figure, to isolate one test from the other -
 * at these balances deeming alone is enough to make the income test bind.
 */
const couple = (o: {
  ages?: [number, number];
  assets?: number;
  assessableOnly?: number;
  income?: number;
  employment?: [number, number];
  homeOwner?: boolean;
}) => ({
  people: [
    { id: 'a', age: o.ages?.[0] ?? 70, employmentIncome: o.employment?.[0] ?? 0, workBonusBalance: 0 },
    { id: 'b', age: o.ages?.[1] ?? 70, employmentIncome: o.employment?.[1] ?? 0, workBonusBalance: 0 },
  ],
  partnered: true,
  homeOwner: o.homeOwner ?? true,
  financialAssets: o.assets ?? 0,
  assessableAssets: o.assessableOnly ?? o.assets ?? 0,
  otherAssessableIncome: o.income ?? 0,
});

describe('Age Pension for a couple', () => {
  it('pays the couple rate to each partner, not the single rate', () => {
    const r = agePension(couple({}), ruleset);
    expect(r.byPerson.a).toBeCloseTo(COUPLE_EACH, 2);
    expect(r.byPerson.b).toBeCloseTo(COUPLE_EACH, 2);
    expect(r.entitlement).toBeCloseTo(COUPLE_COMBINED, 2);
    // A couple gets more in total but less each than a single pensioner.
    expect(COUPLE_EACH).toBeLessThan(ap.maxRateFortnight.value.single.total * FY);
  });

  it('uses the combined asset limit and reproduces the published couple cut-off', () => {
    const at = ap.assetsTest.value;
    expect(
      agePension(couple({ assessableOnly: at.fullPensionLimit.coupleHomeownerCombined }), ruleset)
        .entitlement,
    ).toBeCloseTo(COUPLE_COMBINED, 2);
    expect(
      agePension(couple({ assessableOnly: at.cutOff.coupleHomeownerCombined }), ruleset).entitlement,
    ).toBeCloseTo(0, 0);
  });

  it('lets deeming alone bind the income test at the full-pension asset limit', () => {
    // Holding the couple's whole asset limit in FINANCIAL assets deems enough income to
    // pass the free area, so the pension is cut even though the assets test is satisfied.
    const at = ap.assetsTest.value;
    const r = agePension({ ...couple({ assets: at.fullPensionLimit.coupleHomeownerCombined }) }, ruleset);
    expect(r.bindingTest).toBe('income');
    expect(r.entitlement).toBeLessThan(COUPLE_COMBINED);
  });

  it('reproduces the published couple income cut-off', () => {
    const cutOff = ap.incomeTest.value.cutOffFortnight.coupleCombined * FY;
    expect(agePension(couple({ income: cutOff }), ruleset).entitlement).toBeCloseTo(0, 0);
  });

  it('uses the higher combined deeming threshold', () => {
    const d = ap.deeming.value;
    const r = agePension(couple({ assets: d.threshold.coupleCombinedAtLeastOnePensioner }), ruleset);
    expect(r.deemedIncome).toBeCloseTo(d.threshold.coupleCombinedAtLeastOnePensioner * d.lowerRate, 2);
  });
});

describe('Age Pension where only one partner has reached pension age', () => {
  it('pays only the eligible partner, at the couple rate', () => {
    const r = agePension(couple({ ages: [70, 60] }), ruleset);
    expect(r.byPerson.a).toBeCloseTo(COUPLE_EACH, 2);
    expect(r.byPerson.b).toBe(0);
    expect(r.entitlement).toBeCloseTo(COUPLE_EACH, 2);
  });

  it('still assesses the couple against the COMBINED limits, not half of them', () => {
    // This is the load-bearing case for halving the taper. Services Australia publishes
    // the same cut-off for "a couple, one partner eligible" as for a couple: $1,102,500.
    // That only works if the eligible partner is tapered at $1.50 per $1,000, not $3.
    const at = ap.assetsTest.value;
    const r = agePension(
      { ...couple({ ages: [70, 60] }), assessableAssets: at.cutOff.coupleHomeownerCombined },
      ruleset,
    );
    expect(r.entitlement).toBeCloseTo(0, 0);

    const justUnder = agePension(
      {
        ...couple({ ages: [70, 60] }),
        assessableAssets: at.cutOff.coupleHomeownerCombined - 100_000,
      },
      ruleset,
    );
    expect(justUnder.entitlement).toBeGreaterThan(0);
  });

  it('counts a younger partner’s earnings in full - no Work Bonus before pension age', () => {
    const r = agePension(couple({ ages: [70, 60], employment: [0, 40_000] }), ruleset);
    expect(r.workBonusUsed).toBe(0);
    expect(r.assessedIncome).toBeCloseTo(40_000, 2);
  });
});

describe('projection with two people', () => {
  const twoPerson: Scenario = {
    ...baseCase,
    name: 'Couple',
    household: {
      ...baseCase.household,
      retirementSpending: 95_000,
      people: [
        baseCase.household.people[0],
        {
          id: 'partner',
          name: 'Partner',
          dateOfBirth: '1986-01-01',
          currentAge: 40,
          retirementAge: 50,
          salary: 120_000,
          wageGrowth: 0.035,
          superBalance: 140_000,
        },
      ],
    },
  };

  it('runs, and accrues super guarantee for both people', () => {
    const r = project(twoPerson, ruleset, datasets);
    const first = r.rows[0];
    expect(first.alive).toEqual(['you', 'partner']);
    const salaries = baseCase.household.people[0].salary + 120_000;
    expect(first.contributions.superGuarantee).toBeCloseTo(salaries * 0.12, 2);
    expect(Object.keys(first.balances.superByPerson)).toEqual(['you', 'partner']);
  });

  it('gates each person’s super on their own preservation age and retirement age', () => {
    const r = project(twoPerson, ruleset, datasets);
    // The partner keeps working to 50 and is younger, so their SG continues after the first person stops.
    const skStops = r.rows.find((x) => x.ages.you === 47)!;
    expect(skStops.contributions.superGuarantee).toBeCloseTo(
      120_000 * Math.pow(1.035, 5) * 0.12,
      0,
    );
    const bothStopped = r.rows.find((x) => x.ages.partner === 50)!;
    expect(bothStopped.contributions.superGuarantee).toBe(0);
  });

  it('rejects a third person rather than mismodelling it', () => {
    const three = {
      ...twoPerson,
      household: {
        ...twoPerson.household,
        people: [...twoPerson.household.people, { ...twoPerson.household.people[1], id: 'c' }],
      },
    };
    expect(() => project(three, ruleset, datasets)).toThrow(/one or two people/);
  });

  it('rejects an ownership split that does not sum to 1', () => {
    const bad = {
      ...twoPerson,
      household: { ...twoPerson.household, outsideSuperOwnership: { you: 0.5, partner: 0.2 } },
    };
    expect(() => project(bad, ruleset, datasets)).toThrow(/must sum to 1/);
  });
});

describe('death of the first partner', () => {
  const withDeath: Scenario = {
    ...baseCase,
    name: 'Couple, first death at 70',
    household: {
      ...baseCase.household,
      retirementSpending: 95_000,
      spendingStepDownOnFirstDeath: 0.7,
      people: [
        baseCase.household.people[0],
        {
          id: 'partner',
          name: 'Partner',
          dateOfBirth: '1986-01-01',
          currentAge: 40,
          retirementAge: 50,
          salary: 120_000,
          wageGrowth: 0.035,
          superBalance: 140_000,
        },
      ],
    },
    events: [...baseCase.events, { kind: 'death', personId: 'partner', atAge: 70 }],
  };

  const r = project(withDeath, ruleset, datasets);
  const before = r.rows.find((x) => x.ages.partner === 69)!;
  const after = r.rows.find((x) => x.ages.partner === 70)!;

  it('steps baseline spending down to 70% in the year of death', () => {
    expect(after.alive).toEqual(['you']);
    expect(after.spending.baseline / before.spending.baseline).toBeCloseTo(0.7 * 1.025, 3);
  });

  it('drops health costs to one person, which is a bigger fall than the 70% step-down', () => {
    // Health is per living person, so it halves rather than stepping to 70%. Total
    // spending therefore falls by more than the baseline step-down alone would suggest.
    expect(after.spending.health).toBeLessThan(before.spending.health * 0.7);
    expect(after.spending.total / before.spending.total).toBeLessThan(0.7 * 1.025);
  });

  it('passes the deceased partner’s super to the survivor rather than losing it', () => {
    expect(before.balances.superByPerson.partner).toBeGreaterThan(0);
    expect(after.balances.superByPerson.partner).toBe(0);
    // Nothing vanished: the survivor's balance jumps by roughly what the partner held.
    expect(after.balances.superByPerson.you).toBeGreaterThan(before.balances.superByPerson.you);
  });

  it('switches to the single Age Pension rate afterwards', () => {
    const singleRate = ap.maxRateFortnight.value.single.total * FY;
    expect(after.agePensionDetail.maxRate).toBeCloseTo(singleRate * after.cpiIndex, 0);
    expect(before.agePensionDetail.maxRate).toBeCloseTo(COUPLE_COMBINED * before.cpiIndex, 0);
  });
});

describe('when can a couple retire', () => {
  const couple = (over: Partial<{ aRetire: number; bRetire: number; spend: number }> = {}): Scenario => ({
    ...baseCase,
    household: {
      ...baseCase.household,
      retirementSpending: over.spend ?? 95_000,
      people: [
        { ...baseCase.household.people[0], retirementAge: over.aRetire ?? 47 },
        {
          id: 'partner',
          name: 'Partner',
          dateOfBirth: '1986-01-01',
          currentAge: 40,
          retirementAge: over.bRetire ?? 50,
          salary: 90_000,
          wageGrowth: 0.035,
          superBalance: 150_000,
        },
      ],
    },
  });

  it('reports an age for each person, not one age for the household', () => {
    const r = earliestRetirementAgeDeterministic(couple(), ruleset, datasets);
    expect(r.people).toHaveLength(2);
    expect(r.people.map((p) => p.personId)).toEqual(['you', 'partner']);
    expect(r.people.every((p) => Number.isFinite(p.age))).toBe(true);
  });

  it('shifts both by the same number of years, so a planned gap survives', () => {
    // The whole point: two people of different ages retiring "together" do not retire at
    // the same age, and one planning to go earlier should still go earlier.
    const r = earliestRetirementAgeDeterministic(couple({ aRetire: 47, bRetire: 50 }), ruleset, datasets);
    const [a, b] = r.people;
    expect(a.age - a.plannedAge).toBe(r.yearsFromPlan);
    expect(b.age - b.plannedAge).toBe(r.yearsFromPlan);
    expect(b.age - a.age).toBe(50 - 47);
  });

  it('does not force both to the same age', () => {
    const r = earliestRetirementAgeDeterministic(couple({ aRetire: 47, bRetire: 55 }), ruleset, datasets);
    const [a, b] = r.people;
    expect(a.age).not.toBe(b.age);
  });

  it('never retires anyone before today', () => {
    const easy = couple({ spend: 20_000 });
    const r = earliestRetirementAgeDeterministic(easy, ruleset, datasets);
    for (const p of r.people) {
      const person = easy.household.people.find((x) => x.id === p.personId)!;
      expect(p.age).toBeGreaterThanOrEqual(person.currentAge);
    }
  });

  it('the reported ages actually work when fed back in', () => {
    const sc = couple();
    const r = earliestRetirementAgeDeterministic(sc, ruleset, datasets);
    const applied: Scenario = {
      ...sc,
      household: {
        ...sc.household,
        people: sc.household.people.map((p) => ({
          ...p,
          retirementAge: r.people.find((x) => x.personId === p.id)!.age,
        })),
      },
    };
    expect(project(applied, ruleset, datasets).moneyRunsOutAge).toBeNull();
  });

  it('is still the earliest - a year sooner for both fails', () => {
    const sc = couple();
    const r = earliestRetirementAgeDeterministic(sc, ruleset, datasets);
    const sooner: Scenario = {
      ...sc,
      household: {
        ...sc.household,
        people: sc.household.people.map((p) => ({
          ...p,
          retirementAge: r.people.find((x) => x.personId === p.id)!.age - 1,
        })),
      },
    };
    expect(project(sooner, ruleset, datasets).moneyRunsOutAge).not.toBeNull();
  });

  it('gives a single person exactly one entry', () => {
    const r = earliestRetirementAgeDeterministic(baseCase, ruleset, datasets);
    expect(r.people).toHaveLength(1);
    expect(r.people[0].age).toBe(r.age);
  });
});

describe('the probabilistic solver for a couple', () => {
  it('names both ages in its notes, since one number cannot describe two people', () => {
    const sc: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        retirementSpending: 95_000,
        people: [
          baseCase.household.people[0],
          {
            id: 'partner',
            name: 'Partner',
            dateOfBirth: '1986-01-01',
            currentAge: 40,
            retirementAge: 50,
            salary: 90_000,
            wageGrowth: 0.035,
            superBalance: 150_000,
          },
        ],
      },
    };
    const r = earliestRetirementAge(sc, ruleset, datasets, {
      confidence: 0.5,
      searchRuns: 60,
      runs: 80,
      seed: 2,
    });
    expect(r.value).not.toBeNull();
    expect(r.notes.join(' ')).toMatch(/Both stop together/);
    expect(r.notes.join(' ')).toMatch(/You at \d+, Partner at \d+/);
  });

  it('says nothing extra for a single person', () => {
    const r = earliestRetirementAge(baseCase, ruleset, datasets, {
      confidence: 0.5,
      searchRuns: 60,
      runs: 80,
      seed: 2,
    });
    expect(r.notes.join(' ')).not.toMatch(/Both stop together/);
  });
});
