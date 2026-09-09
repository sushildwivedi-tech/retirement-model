import type { Scenario } from '../types';

/**
 * An example household, used by the tests and as the app's starting point.
 *
 * These are illustrative round numbers, deliberately not anyone's real finances. Put your
 * own figures in `scenarios/local.json` (gitignored) and the app prefills from there.
 *
 * The AGES are load-bearing for the tests: retiring at 47 with a preservation age of 60
 * creates the thirteen-year bridge period that much of the test suite exercises.
 */
export const BASE_CASE_MISSING_INPUTS: readonly string[] = [];

export const baseCase: Scenario = {
  name: "Example household",
  startYear: 2026,
  household: {
    homeOwner: true,
    cash: 0,
    investments: 150_000,
    primaryResidence: 900_000,
    annualSavings: 30_000,
    retirementSpending: 60_000,
    people: [
      {
        id: 'you',
        name: 'You',
        // Age 42 at the 2026 plan start implies a 1984 birth year.
        // Only the preservation-age band matters, and every 1984 date lands in the
        // "from 1 July 1964" band, so the exact day does not change the result.
        dateOfBirth: '1984-01-01',
        currentAge: 42,
        retirementAge: 47,
        salary: 120_000,
        wageGrowth: 0.035,
        superBalance: 250_000,
        // Unset on purpose: it selects the life table, and guessing it would be wrong.
        sex: undefined,
      },
    ],
  },
  assumptions: {
    cpi: 0.025, // RBA target midpoint, per build-plan section 2.7.
    // ASSUMED: share of the outside-super return paid out as taxable distributions.
    investmentIncomeYield: 0.025,
    convertSuperToPensionPhase: true,
    // Tax brackets indexed. Age Pension rates and super caps are indexed in law, so
    // those are not really a choice - see the Assumptions type for the difference.
    indexation: { agePension: true, taxBrackets: true, superCaps: true },
    returns: {
      cash: 0.035,
      investments: 0.065,
      superAccumulation: 0.075, // "Growth" option, per build-plan section 2.3 defaults.
      primaryResidence: 0.04,
    },
    planToAge: 95,
    health: {
      includeHealthCosts: true,
      outOfPocketMultiplier: 1,
      // ASSUMED: health costs index a point above CPI. The AIHW does not publish a single
      // out-of-pocket deflator, so this is a modelling choice, not a sourced figure.
      healthInflation: 0.035,
      privateHealthInsurancePremium: 0,
      privateHealthInsuranceInflation: 0.0345, // sourced: 10-year industry average
    },
    agedCare: {
      enabled: false,
      fromAge: 85,
      years: 3,
      annualAccommodationCost: 40_000,
      payFullMeansTestedContributions: true,
    },
  },
  events: [
    {
      kind: 'downsize',
      personId: 'you',
      atAge: 47,
      newHomeValue: 600_000,
      sellingCostRate: 0.025,
      proceedsTo: 'investments',
    },
  ],
};
