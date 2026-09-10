import { describe, expect, it } from 'vitest';
import { takeHome, grossFromTakeHome } from '../src/pay';
import { netFromGross, personalIncomeTax } from '../src/tax';
import { loadRuleset } from '../src/loadRuleset';

const ruleset = loadRuleset('au-2026-07');
const cap = ruleset.super.concessionalCap.value;
const sgRate = ruleset.super.guaranteeRate.value;

describe('take-home pay', () => {
  it('is gross less tax when nothing is sacrificed', () => {
    expect(takeHome(120_000, ruleset).net).toBeCloseTo(netFromGross(120_000, ruleset), 6);
  });

  it('does not deduct the super guarantee, which is paid on top of salary', () => {
    const p = takeHome(120_000, ruleset);
    expect(p.superGuarantee).toBeCloseTo(120_000 * sgRate, 6);
    expect(p.taxableIncome).toBe(120_000);
  });

  it('takes the sacrifice off before tax, so it costs less than it contributes', () => {
    const base = takeHome(120_000, ruleset);
    const with10k = takeHome(120_000, ruleset, { salarySacrifice: 10_000 });
    expect(with10k.taxableIncome).toBe(110_000);
    expect(with10k.salarySacrifice).toBe(10_000);
    const cost = base.net - with10k.net;
    // $10,000 into super costs less than $10,000 in the hand - that is the point of it.
    expect(cost).toBeLessThan(10_000);
    // And the difference is exactly the tax no longer paid on that slice.
    expect(cost).toBeCloseTo(10_000 - (base.tax - with10k.tax), 6);
  });

  it('trims a sacrifice to the room left under the concessional cap', () => {
    const p = takeHome(120_000, ruleset, { salarySacrifice: 30_000 });
    expect(p.salarySacrifice).toBeCloseTo(cap - 120_000 * sgRate, 6);
    expect(p.salarySacrificeRefused).toBeCloseTo(30_000 - p.salarySacrifice, 6);
    // Only what actually goes in comes off taxable income.
    expect(p.taxableIncome).toBeCloseTo(120_000 - p.salarySacrifice, 6);
  });

  it('leaves next to no room once the guarantee alone fills the cap', () => {
    // The maximum contribution base is set so that the guarantee on it is the cap: 12% of
    // $270,830 is $32,499.60 against a $32,500 cap. Above that salary, sacrificing is
    // effectively not available - forty cents of room, not a planning option.
    const p = takeHome(400_000, ruleset, { salarySacrifice: 20_000 });
    expect(p.salarySacrifice).toBeLessThan(1);
    expect(p.salarySacrificeRefused).toBeGreaterThan(19_999);
    expect(p.taxableIncome).toBeCloseTo(400_000, 0);
  });

  it('cannot sacrifice more salary than there is', () => {
    const p = takeHome(20_000, ruleset, { salarySacrifice: 25_000 });
    expect(p.salarySacrifice).toBe(20_000);
    expect(p.taxableIncome).toBe(0);
    expect(p.net).toBe(0);
  });

  it('matches the tax module rather than computing tax its own way', () => {
    const p = takeHome(95_000, ruleset, { salarySacrifice: 5_000 });
    expect(p.tax).toBeCloseTo(personalIncomeTax(90_000, ruleset).payable, 6);
  });

  it('treats nothing, and nonsense, as nothing', () => {
    expect(takeHome(0, ruleset).net).toBe(0);
    expect(takeHome(-1, ruleset).net).toBe(0);
    expect(takeHome(100_000, ruleset, { salarySacrifice: -5_000 }).salarySacrifice).toBe(0);
    expect(takeHome(Number.NaN, ruleset).net).toBe(0);
  });
});

describe('the gross behind a take-home figure', () => {
  it.each([0, 5_000, 15_000, 30_000, 60_000])(
    'round-trips a $120,000 salary sacrificing %i',
    (sacrifice) => {
      const net = takeHome(120_000, ruleset, { salarySacrifice: sacrifice }).net;
      expect(grossFromTakeHome(net, ruleset, { salarySacrifice: sacrifice })).toBeCloseTo(
        120_000,
        1,
      );
    },
  );

  it.each([60_000, 95_000, 150_000, 250_000, 400_000])(
    'round-trips a gross of %i with a sacrifice big enough to be trimmed',
    (gross) => {
      const opts = { salarySacrifice: 40_000 };
      const net = takeHome(gross, ruleset, opts).net;
      expect(grossFromTakeHome(net, ruleset, opts)).toBeCloseTo(gross, 1);
    },
  );

  it('needs a higher gross for the same take-home once you sacrifice', () => {
    const net = 90_000;
    expect(grossFromTakeHome(net, ruleset, { salarySacrifice: 10_000 })).toBeGreaterThan(
      grossFromTakeHome(net, ruleset),
    );
  });

  it('adds the sacrifice straight on top while it fits under the cap', () => {
    const net = 70_000;
    const plain = grossFromTakeHome(net, ruleset);
    expect(grossFromTakeHome(net, ruleset, { salarySacrifice: 8_000 })).toBeCloseTo(
      plain + 8_000,
      1,
    );
  });

  it('stops adding it on once the cap refuses the rest', () => {
    // A sacrifice the cap cannot take does not raise the salary needed any further.
    const net = 80_000;
    const a = grossFromTakeHome(net, ruleset, { salarySacrifice: 60_000 });
    const b = grossFromTakeHome(net, ruleset, { salarySacrifice: 90_000 });
    expect(b).toBeCloseTo(a, 1);
  });

  it('is monotonic in the take-home asked for', () => {
    let last = -1;
    for (let net = 5_000; net <= 250_000; net += 2_500) {
      const g = grossFromTakeHome(net, ruleset, { salarySacrifice: 20_000 });
      expect(g).toBeGreaterThan(last);
      last = g;
    }
  });

  it('treats nothing as nothing', () => {
    expect(grossFromTakeHome(0, ruleset, { salarySacrifice: 10_000 })).toBe(0);
    expect(grossFromTakeHome(-1, ruleset)).toBe(0);
  });
});
