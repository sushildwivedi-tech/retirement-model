import { describe, expect, it } from 'vitest';
import {
  grossIncomeTax,
  lito,
  sapto,
  personalIncomeTax,
  medicareLevyFor,
  netFromGross,
  grossFromNet,
} from '../src/tax';
import { loadRuleset } from '../src/loadRuleset';

const ruleset = loadRuleset('au-2026-07');

describe('resident income tax scale 2026-27', () => {
  it.each([
    [0, 0],
    [18_200, 0],
    [18_201, 0.15], // 15c on the first dollar over the threshold
    [45_000, 4_020], // 26,800 x 15c
    [60_000, 8_520], // 4,020 + 15,000 x 30c
    [135_000, 31_020], // 4,020 + 90,000 x 30c
    [190_000, 51_370], // 31,020 + 55,000 x 37c
    [250_000, 78_370], // 51,370 + 60,000 x 45c
  ])('taxable income %i -> gross tax %i', (income, expected) => {
    expect(grossIncomeTax(income, ruleset)).toBeCloseTo(expected, 2);
  });

  it('matches the bracket boundaries the ATO publishes', () => {
    // Each bracket's `base` must equal the tax accumulated at its lower bound.
    const brackets = ruleset.incomeTax.brackets.value;
    for (const b of brackets.slice(1)) {
      expect(grossIncomeTax(b.over, ruleset)).toBeCloseTo(b.base, 2);
    }
  });
});

describe('low income tax offset', () => {
  it.each([
    [30_000, 700],
    [37_500, 700],
    [40_000, 575], // 700 - 2,500 x 5c
    [45_000, 325], // 700 - 7,500 x 5c
    [50_000, 250], // 325 - 5,000 x 1.5c
    [66_667, 0],
    [80_000, 0],
  ])('taxable income %i -> LITO %i', (income, expected) => {
    expect(lito(income, ruleset)).toBeCloseTo(expected, 2);
  });
});

describe('SAPTO', () => {
  it('is nil for someone who does not qualify for the Age Pension', () => {
    expect(sapto(20_000, ruleset, { eligible: false })).toBe(0);
  });

  it('reproduces the ATO worked example for Vanh (couple, rebate income $32,590)', () => {
    // ATO: 32,590 - 30,994 = 1,596; 1,596 x 0.125 = 199.50; 1,602 - 199.50 = 1,402.50.
    const v = sapto(32_590, ruleset, { eligible: true, status: 'couplePartnerEach' });
    expect(v).toBeCloseTo(1_402.5, 2);
  });

  it('reproduces the ATO worked example for Mai (rebate income below the shade-out)', () => {
    expect(sapto(26_780, ruleset, { eligible: true, status: 'couplePartnerEach' })).toBeCloseTo(1_602, 2);
  });

  it.each([
    [30_000, 2_230], // below the single shade-out threshold
    [34_919, 2_230],
    [52_759, 0], // at the cut-out
    [60_000, 0],
  ])('single rebate income %i -> SAPTO %i', (income, expected) => {
    expect(sapto(income, ruleset, { eligible: true, status: 'single' })).toBeCloseTo(expected, 0);
  });

  it('tapers to exactly zero at the published cut-out threshold', () => {
    const s = ruleset.incomeTax.seniorsAndPensionersTaxOffset.value;
    const derived =
      s.single.shadeOutThreshold + s.single.maxOffset / s.taperRate;
    expect(derived).toBeCloseTo(s.single.cutOutThreshold, 0);
  });
});

describe('personal income tax end to end', () => {
  it('adds the Medicare levy after offsets, not before', () => {
    const r = personalIncomeTax(60_000, ruleset, { saptoEligible: false });
    expect(r.gross).toBeCloseTo(8_520, 2);
    expect(r.lowIncomeTaxOffset).toBeCloseTo(100, 2); // 325 - 15,000 x 1.5c
    expect(r.medicareLevy).toBeCloseTo(1_200, 2);
    expect(r.payable).toBeCloseTo(8_520 - 100 + 1_200, 2);
  });

  it('never returns negative tax when offsets exceed the liability', () => {
    const r = personalIncomeTax(25_000, ruleset, { saptoEligible: true, saptoStatus: 'single' });
    expect(r.gross).toBeCloseTo(1_020, 2);
    // LITO 700 + SAPTO 2,230 exceed the 1,020 liability, so income tax floors at zero.
    // 25,000 is below the SAPTO Medicare threshold of 44,268, so the levy is nil too.
    expect(r.payable).toBe(0);
  });

  it('is zero below the tax-free threshold', () => {
    expect(personalIncomeTax(18_200, ruleset).payable).toBe(0);
  });
});

describe('Medicare levy low-income reduction', () => {
  it('is nil at or below the lower threshold', () => {
    expect(medicareLevyFor(28_011, ruleset, false)).toBe(0);
    expect(medicareLevyFor(20_000, ruleset, false)).toBe(0);
  });

  it('shades in at 10c per dollar between the thresholds', () => {
    expect(medicareLevyFor(30_000, ruleset, false)).toBeCloseTo((30_000 - 28_011) * 0.1, 2);
  });

  it('reaches exactly the full 2% at the upper threshold - the two rules meet', () => {
    // This is why the 10% shade-in rate can be trusted: it is the only rate that makes
    // the reduction land exactly on the full levy at the upper threshold.
    const th = ruleset.incomeTax.medicareLevyLowIncomeThresholds.value;
    const shadeIn = (th.single.upper - th.single.lower) * th.shadeInRate;
    // Within 6c - the published thresholds are rounded to whole dollars.
    expect(shadeIn).toBeCloseTo(th.single.upper * ruleset.incomeTax.medicareLevyRate.value, 0);
  });

  it('is the full 2% above the upper threshold', () => {
    expect(medicareLevyFor(60_000, ruleset, false)).toBeCloseTo(1_200, 2);
  });

  it('uses the much higher SAPTO thresholds for a pensioner', () => {
    // A retiree on 40k pays no levy; the same income without SAPTO would attract it.
    expect(medicareLevyFor(40_000, ruleset, true)).toBe(0);
    expect(medicareLevyFor(40_000, ruleset, false)).toBeCloseTo(800, 2);
  });
});

describe('net pay and its inverse', () => {
  it('takes the tax payable off the gross', () => {
    const gross = 120_000;
    expect(netFromGross(gross, ruleset)).toBeCloseTo(
      gross - personalIncomeTax(gross, ruleset).payable,
      6,
    );
  });

  it('pays no tax below the tax-free threshold, so net is gross', () => {
    expect(netFromGross(18_000, ruleset)).toBeCloseTo(18_000, 6);
    expect(grossFromNet(18_000, ruleset)).toBeCloseTo(18_000, 2);
  });

  it.each([1, 15_000, 25_000, 45_000, 60_000, 90_000, 120_000, 190_000, 400_000])(
    'round-trips a gross salary of %i through net and back',
    (gross) => {
      expect(grossFromNet(netFromGross(gross, ruleset), ruleset)).toBeCloseTo(gross, 1);
    },
  );

  it('round-trips across the LITO tapers and the Medicare shade-in, where the kinks are', () => {
    // The awkward band: LITO tapering out, the levy shading in, and the first bracket
    // boundary all fall between 18k and 50k. A hand-rolled inverse tends to break here.
    for (let gross = 18_000; gross <= 50_000; gross += 250) {
      expect(grossFromNet(netFromGross(gross, ruleset), ruleset)).toBeCloseTo(gross, 1);
    }
  });

  it('is monotonic: more in the hand always means more gross', () => {
    let last = -1;
    for (let net = 1_000; net <= 300_000; net += 1_000) {
      const g = grossFromNet(net, ruleset);
      expect(g).toBeGreaterThan(last);
      last = g;
    }
  });

  it('never returns a gross below the net asked for', () => {
    for (const net of [500, 5_000, 30_000, 100_000, 250_000]) {
      expect(grossFromNet(net, ruleset)).toBeGreaterThanOrEqual(net - 0.01);
    }
  });

  it('treats nothing, and nonsense, as nothing', () => {
    expect(grossFromNet(0, ruleset)).toBe(0);
    expect(grossFromNet(-5_000, ruleset)).toBe(0);
    expect(grossFromNet(Number.NaN, ruleset)).toBe(0);
    expect(netFromGross(0, ruleset)).toBe(0);
    expect(netFromGross(-100, ruleset)).toBe(0);
  });

  it('accounts for SAPTO when the person qualifies, so the same net needs less gross', () => {
    const net = 30_000;
    expect(grossFromNet(net, ruleset, { saptoEligible: true })).toBeLessThan(
      grossFromNet(net, ruleset),
    );
  });
});
