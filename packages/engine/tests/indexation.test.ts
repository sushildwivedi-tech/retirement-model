import { describe, expect, it } from 'vitest';
import { indexRuleset, INDEX_ALL } from '../src/indexation';
import { loadRuleset } from '../src/loadRuleset';
import { agePension } from '../src/agePension';
import { grossIncomeTax } from '../src/tax';

const ruleset = loadRuleset('au-2026-07');

describe('indexRuleset', () => {
  it('is the identity at a factor of 1', () => {
    expect(indexRuleset(ruleset, 1)).toBe(ruleset);
  });

  it('is the identity when nothing is selected', () => {
    expect(
      indexRuleset(ruleset, 2, { agePension: false, taxBrackets: false, superCaps: false }),
    ).toBe(ruleset);
  });

  it('indexes each group independently', () => {
    // The three groups are separate because they are different kinds of claim: Age Pension
    // and super caps are indexed in legislation, tax brackets are not.
    const taxOnly = indexRuleset(ruleset, 2, { agePension: false, taxBrackets: true, superCaps: false });
    expect(taxOnly.incomeTax.brackets.value[1].upTo).toBe(90_000);
    expect(taxOnly.agePension.maxRateFortnight.value.single.total).toBe(1200.9);
    expect(taxOnly.super.concessionalCap.value).toBe(32_500);

    const pensionOnly = indexRuleset(ruleset, 2, { agePension: true, taxBrackets: false, superCaps: false });
    expect(pensionOnly.agePension.maxRateFortnight.value.single.total).toBeCloseTo(2401.8, 2);
    expect(pensionOnly.incomeTax.brackets.value[1].upTo).toBe(45_000);

    const superOnly = indexRuleset(ruleset, 2, { agePension: false, taxBrackets: false, superCaps: true });
    expect(superOnly.super.concessionalCap.value).toBe(65_000);
    expect(superOnly.super.generalTransferBalanceCap.value).toBe(4_200_000);
    expect(superOnly.agePension.deeming.value.threshold.single).toBe(66_800);
  });

  it('scales dollar amounts', () => {
    const r = indexRuleset(ruleset, 2);
    expect(r.agePension.maxRateFortnight.value.single.total).toBeCloseTo(1200.9 * 2, 2);
    expect(r.agePension.assetsTest.value.fullPensionLimit.singleHomeowner).toBe(666_000);
    expect(r.agePension.deeming.value.threshold.single).toBe(133_600);
    expect(r.incomeTax.brackets.value[1].upTo).toBe(90_000);
    expect(r.super.generalTransferBalanceCap.value).toBe(4_200_000);
  });

  it('leaves every rate and taper alone', () => {
    const r = indexRuleset(ruleset, 2);
    expect(r.incomeTax.medicareLevyRate.value).toBe(ruleset.incomeTax.medicareLevyRate.value);
    expect(r.incomeTax.brackets.value.map((b) => b.rate)).toEqual(
      ruleset.incomeTax.brackets.value.map((b) => b.rate),
    );
    expect(r.agePension.deeming.value.lowerRate).toBe(0.0125);
    expect(r.agePension.deeming.value.upperRate).toBe(0.0325);
    expect(r.agePension.incomeTest.value.taperPerDollar.single).toBe(0.5);
    expect(r.agePension.assetsTest.value.taperPerThousandPerFortnight).toBe(3);
    expect(r.super.guaranteeRate.value).toBe(0.12);
    expect(r.super.earningsTaxAccumulation.value).toBe(0.15);
  });

  it('keeps provenance attached after indexing', () => {
    const r = indexRuleset(ruleset, 1.5);
    expect(r.agePension.maxRateFortnight.status).toBe('sourced');
    expect(r.agePension.maxRateFortnight.url).toBe(ruleset.agePension.maxRateFortnight.url);
  });

  it('keeps the whole system self-consistent in real terms', () => {
    // Doubling every dollar amount and every dollar of input must double the outputs.
    const r2 = indexRuleset(ruleset, 2, INDEX_ALL);
    expect(grossIncomeTax(120_000, r2)).toBeCloseTo(grossIncomeTax(60_000, ruleset) * 2, 2);

    const arg = {
      people: [{ id: 'a', age: 70, employmentIncome: 0, workBonusBalance: 0 }],
      partnered: false,
      homeOwner: true,
      financialAssets: 500_000,
      assessableAssets: 500_000,
      otherAssessableIncome: 0,
    };
    const a1 = agePension(arg, ruleset);
    const a2 = agePension(
      { ...arg, financialAssets: 1_000_000, assessableAssets: 1_000_000 },
      r2,
    );
    expect(a2.entitlement).toBeCloseTo(a1.entitlement * 2, 2);
  });

  it('the assets cut-off point still reproduces itself after indexing', () => {
    const r = indexRuleset(ruleset, 1.8);
    const at = r.agePension.assetsTest.value;
    const fy = r.agePension.fortnightsPerYear.value;
    const taperedAway =
      ((at.cutOff.singleHomeowner - at.fullPensionLimit.singleHomeowner) / 1000) *
      at.taperPerThousandPerFortnight *
      fy;
    // The $3 taper is a fixed dollar amount and is deliberately NOT indexed, but the
    // system stays consistent anyway: the gap between the limit and the cut-off is
    // maxRate/3 x 1000, so when the rate indexes the gap indexes with it. The two sides
    // agree to within the rounding already present in the published cut-off ($200).
    const maxRate = r.agePension.maxRateFortnight.value.single.total * fy;
    expect(taperedAway).toBeCloseTo(maxRate, -2);
    expect(Math.abs(taperedAway - maxRate)).toBeLessThan(200 * 1.8 * 0.003 * fy + 1);
  });
});
