import { describe, expect, it } from 'vitest';
import { loadRuleset } from '../src/loadRuleset';
import { assertUsable, unsourcedValues } from '../src/rules';

const ruleset = loadRuleset('au-2026-07');

describe('FY2026-27 ruleset', () => {
  it('carries the values the Phase 1 engine depends on, all sourced', () => {
    expect(() => assertUsable(ruleset)).not.toThrow();
  });

  it('matches the published ATO figures for 2026-27', () => {
    expect(ruleset.super.guaranteeRate.value).toBe(0.12);
    expect(ruleset.super.concessionalCap.value).toBe(32_500);
    expect(ruleset.super.maximumContributionBaseAnnual.value).toBe(270_830);
    expect(ruleset.super.downsizerContribution.minimumAge.value).toBe(55);
    expect(ruleset.super.downsizerContribution.capPerPerson.value).toBe(300_000);
  });

  it('the maximum contribution base is the cap divided by the SG rate, rounded down to $10', () => {
    const { concessionalCap, guaranteeRate, maximumContributionBaseAnnual } = ruleset.super;
    const derived = Math.floor(concessionalCap.value / guaranteeRate.value / 10) * 10;
    expect(derived).toBe(maximumContributionBaseAnnual.value);
  });

  it('every super value the engine reads is sourced', () => {
    expect(unsourcedValues(ruleset.super)).toEqual([]);
  });

  it('names exactly the values that are assumed rather than sourced', () => {
    // These are the only places a figure is not taken straight from a primary source.
    // If this list grows, something was filled in without provenance.
    expect([
      ...unsourcedValues(ruleset.incomeTax, 'incomeTax'),
      ...unsourcedValues(ruleset.agePension, 'agePension'),
    ]).toEqual([
      'incomeTax.medicareLevyLowIncomeThresholds (assumed)',
      'agePension.fortnightsPerYear (assumed)',
    ]);
  });

  it('carries the Age Pension figures Services Australia publishes', () => {
    expect(ruleset.agePension.eligibilityAge.value).toBe(67);
    expect(ruleset.agePension.maxRateFortnight.value.single.total).toBe(1200.9);
    expect(ruleset.agePension.assetsTest.value.fullPensionLimit.singleHomeowner).toBe(333_000);
    expect(ruleset.agePension.deeming.value.threshold.single).toBe(66_800);
  });

  it('the assets taper independently reproduces the published cut-off point', () => {
    // (cut-off - full-pension limit) / 1000 x $3/fn x 26 should equal the annual max rate.
    const at = ruleset.agePension.assetsTest.value;
    const fy = ruleset.agePension.fortnightsPerYear.value;
    const span = at.cutOff.singleHomeowner - at.fullPensionLimit.singleHomeowner;
    const taperedAway = (span / 1000) * at.taperPerThousandPerFortnight * fy;
    const maxRate = ruleset.agePension.maxRateFortnight.value.single.total * fy;
    expect(taperedAway).toBeCloseTo(maxRate, -2); // agree to within ~$16 a year
  });
});
