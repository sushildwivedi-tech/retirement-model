import { describe, expect, it } from 'vitest';
import { agePension } from '../src/agePension';
import { project } from '../src/engine';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';
import { baseCase } from '../src/fixtures/baseCase';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};
const FY = ruleset.agePension.fortnightsPerYear.value;
const RA = ruleset.agePension.rentAssistance.value;

const renter = (rentPerYear: number, homeOwner = false) =>
  agePension(
    {
      people: [{ id: 'a', age: 70, employmentIncome: 0, workBonusBalance: 0 }],
      partnered: false,
      homeOwner,
      financialAssets: 50_000,
      assessableAssets: 50_000,
      otherAssessableIncome: 0,
      rentPerYear,
    },
    ruleset,
  );

describe('Rent Assistance', () => {
  it('pays nothing at or below the rent threshold', () => {
    expect(renter(RA.single.rentThresholdFortnight * FY).rentAssistance).toBe(0);
    expect(renter(0).rentAssistance).toBe(0);
  });

  it('pays 75c for every dollar of rent above it', () => {
    const rent = (RA.single.rentThresholdFortnight + 100) * FY;
    expect(renter(rent).rentAssistance).toBeCloseTo(100 * FY * 0.75, 2);
  });

  it('reaches the published maximum at the published rent, and stops there', () => {
    const atMax = renter(RA.single.rentForMaxPaymentFortnight * FY).rentAssistance;
    expect(atMax).toBeCloseTo(RA.single.maxPaymentFortnight * FY, 0);
    expect(renter(RA.single.rentForMaxPaymentFortnight * FY * 3).rentAssistance).toBeCloseTo(
      atMax,
      0,
    );
  });

  it('is not paid to a homeowner, whatever they pay in rent', () => {
    expect(renter(30_000, true).rentAssistance).toBe(0);
  });

  it('is not paid to someone getting no pension at all', () => {
    const rich = agePension(
      {
        people: [{ id: 'a', age: 70, employmentIncome: 0, workBonusBalance: 0 }],
        partnered: false,
        homeOwner: false,
        financialAssets: 3_000_000,
        assessableAssets: 3_000_000,
        otherAssessableIncome: 0,
        rentPerYear: 30_000,
      },
      ruleset,
    );
    expect(rich.entitlement).toBe(0);
    expect(rich.rentAssistance).toBe(0);
  });

  it('uses the couple rates for a couple, and splits the payment between them', () => {
    const couple = agePension(
      {
        people: [
          { id: 'a', age: 70, employmentIncome: 0, workBonusBalance: 0 },
          { id: 'b', age: 70, employmentIncome: 0, workBonusBalance: 0 },
        ],
        partnered: true,
        homeOwner: false,
        financialAssets: 50_000,
        assessableAssets: 50_000,
        otherAssessableIncome: 0,
        rentPerYear: RA.coupleCombined.rentForMaxPaymentFortnight * FY,
      },
      ruleset,
    );
    expect(couple.rentAssistance).toBeCloseTo(RA.coupleCombined.maxPaymentFortnight * FY, 0);
    expect(couple.byPerson.a).toBeCloseTo(couple.byPerson.b, 6);
  });
});

describe('a household that rents', () => {
  const renting = (rentPerYear?: number): Scenario => ({
    ...baseCase,
    household: {
      ...baseCase.household,
      homeOwner: rentPerYear === undefined,
      primaryResidence: rentPerYear === undefined ? baseCase.household.primaryResidence : 0,
      rentPerYear,
    },
  });

  it('pays rent every year, working or retired', () => {
    const owner = project(renting(), ruleset, datasets).rows;
    const tenant = project(renting(30_000), ruleset, datasets).rows;
    expect(tenant[0].spending.total - owner[0].spending.total).toBeCloseTo(30_000, 0);
    const later = 20;
    expect(tenant[later].spending.total).toBeGreaterThan(owner[later].spending.total);
  });

  it('indexes the rent at CPI', () => {
    const a = project(renting(30_000), ruleset, datasets).rows[0].spending.total;
    const b = project(renting(30_000), ruleset, datasets).rows[10].spending.total;
    const owner0 = project(renting(), ruleset, datasets).rows[0].spending.total;
    const owner10 = project(renting(), ruleset, datasets).rows[10].spending.total;
    expect(b - owner10).toBeCloseTo((a - owner0) * 1.025 ** 10, -1);
  });

  it('collects Rent Assistance once the pension starts', () => {
    const rows = project(renting(30_000), ruleset, datasets).rows;
    const onPension = rows.find((r) => r.agePension > 0);
    expect(onPension!.agePensionDetail.rentAssistance).toBeGreaterThan(0);
  });

  it('leaves a homeowner’s projection alone to the cent', () => {
    const a = project(renting(), ruleset, datasets).rows;
    const b = project(baseCase, ruleset, datasets).rows;
    expect(a[30].balances.total).toBe(b[30].balances.total);
    expect(a[30].agePension).toBe(b[30].agePension);
  });
});
