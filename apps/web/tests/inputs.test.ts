import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { netFromGross, type Ruleset } from '@retirement/engine';
import {
  defaults,
  mergeInputs,
  applyFieldRules,
  grossSalaryFor,
  netMonthlyFor,
  type FormInputs,
} from '../app/inputs';

/** The same dated ruleset the page loads, so the tax the tests invert is the real scale. */
const ruleset = JSON.parse(
  readFileSync(resolve(__dirname, '../../../rules/au-2026-07.json'), 'utf-8'),
) as Ruleset;

const withField = (over: Partial<FormInputs>): FormInputs => ({ ...defaults, ...over });
const rules = (f: FormInputs, key: keyof FormInputs): FormInputs =>
  applyFieldRules(f, key, ruleset);

describe('you cannot retire in the past', () => {
  it('carries the retirement age up when your age passes it', () => {
    // A 60-year-old "planning to stop at 47" is not a stale field, it is an impossible
    // scenario - and the projection would model them as long since retired.
    const out = rules(withField({ currentAge: 60, retirementAge: 47 }), 'currentAge');
    expect(out.retirementAge).toBe(60);
  });

  it('lifts a retirement age typed below the current age', () => {
    const out = rules(withField({ currentAge: 42, retirementAge: 30 }), 'retirementAge');
    expect(out.retirementAge).toBe(42);
  });

  it('leaves a retirement age in the future alone', () => {
    const out = rules(withField({ currentAge: 42, retirementAge: 55 }), 'currentAge');
    expect(out.retirementAge).toBe(55);
  });

  it('applies when a birth year change is what moved the age', () => {
    const out = rules(withField({ birthYear: 1960, retirementAge: 47 }), 'birthYear');
    expect(out.currentAge).toBe(defaults.startYear - 1960);
    expect(out.retirementAge).toBe(out.currentAge);
  });

  it('does the same for a partner, without touching yours', () => {
    const out = rules(
      withField({ partnerCurrentAge: 62, partnerRetirementAge: 50 }),
      'partnerCurrentAge',
    );
    expect(out.partnerRetirementAge).toBe(62);
    expect(out.retirementAge).toBe(defaults.retirementAge);
  });

  it('does not reach for the retirement age when an unrelated field changes', () => {
    const odd = withField({ currentAge: 60, retirementAge: 47, salary: 1 });
    expect(rules(odd, 'salary').retirementAge).toBe(47);
  });
});

describe('age and birth year stay consistent', () => {
  it('the shipped defaults already agree', () => {
    expect(defaults.startYear - defaults.currentAge).toBe(defaults.birthYear);
  });

  it('changing your age moves your birth year', () => {
    const out = rules(withField({ currentAge: 55 }), 'currentAge');
    expect(out.birthYear).toBe(defaults.startYear - 55);
  });

  it('changing your birth year moves your age', () => {
    const out = rules(withField({ birthYear: 1990 }), 'birthYear');
    expect(out.currentAge).toBe(defaults.startYear - 1990);
  });

  it('does the same for a partner, independently of you', () => {
    const out = rules(withField({ partnerCurrentAge: 47 }), 'partnerCurrentAge');
    expect(out.partnerBirthYear).toBe(defaults.startYear - 47);
    expect(out.currentAge).toBe(defaults.currentAge);
    expect(out.birthYear).toBe(defaults.birthYear);
  });

  it('moving the plan start year keeps ages and shifts birth years', () => {
    const out = rules(withField({ startYear: 2030 }), 'startYear');
    expect(out.currentAge).toBe(defaults.currentAge);
    expect(out.birthYear).toBe(2030 - defaults.currentAge);
  });

  it('leaves everything alone when an unrelated field changes', () => {
    const before = withField({ cash: 200_000 });
    const after = rules(before, 'cash');
    expect(after).toEqual(before);
  });

  it('ignores a birth year that is not a real year', () => {
    // Mid-typing an input can be empty, which reads as 0.
    const out = rules(withField({ birthYear: 0 }), 'birthYear');
    expect(out.currentAge).toBe(defaults.currentAge);
  });

  it('round-trips: setting an age then its birth year returns the same age', () => {
    const a = rules(withField({ currentAge: 61 }), 'currentAge');
    const b = rules({ ...a, birthYear: a.birthYear }, 'birthYear');
    expect(b.currentAge).toBe(61);
  });
});

describe('merging a saved or imported scenario', () => {
  it('keeps known numeric fields', () => {
    expect(mergeInputs({ salary: 175_000 }, ruleset).salary).toBe(175_000);
  });

  it('drops fields of the wrong type rather than trusting the file', () => {
    expect(mergeInputs({ salary: 'lots' as unknown as number }, ruleset).salary).toBe(defaults.salary);
  });

  it('ignores keys it does not know', () => {
    const out = mergeInputs({ nonsense: 1 } as unknown as Partial<FormInputs>, ruleset);
    expect(out).toEqual(defaults);
  });

  it('rejects a non-finite number', () => {
    expect(mergeInputs({ currentAge: NaN }, ruleset).currentAge).toBe(defaults.currentAge);
  });
});

describe('pay is entered as take-home and the gross is calculated', () => {
  it('solves the gross salary from a monthly take-home figure', () => {
    const out = rules(withField({ netMonthlyPay: 7_000 }), 'netMonthlyPay');
    // Whatever the scale says, the defining property: that gross leaves 7,000 a month.
    expect(netFromGross(out.salary, ruleset) / 12).toBeCloseTo(7_000, 0);
  });

  it('pushes the other way when a gross salary arrives from an import or a lever', () => {
    const out = rules(withField({ salary: 150_000 }), 'salary');
    expect(out.netMonthlyPay).toBe(netMonthlyFor(150_000, ruleset));
    expect(out.salary).toBe(150_000);
  });

  it('round-trips without drifting, so editing back and forth is stable', () => {
    let f = rules(withField({ netMonthlyPay: 6_250 }), 'netMonthlyPay');
    for (let i = 0; i < 5; i++) {
      f = rules({ ...f, salary: f.salary }, 'salary');
      f = rules({ ...f, netMonthlyPay: f.netMonthlyPay }, 'netMonthlyPay');
    }
    expect(f.netMonthlyPay).toBe(6_250);
  });

  it('treats an empty field as no pay rather than as a tax puzzle', () => {
    // Mid-typing, an input reads as 0.
    expect(rules(withField({ netMonthlyPay: 0 }), 'netMonthlyPay').salary).toBe(0);
    expect(rules(withField({ netMonthlyPay: -100 }), 'netMonthlyPay').salary).toBe(0);
  });

  it('does the same for a partner, without touching yours', () => {
    const out = rules(withField({ partnerNetMonthlyPay: 4_000 }), 'partnerNetMonthlyPay');
    expect(netFromGross(out.partnerSalary, ruleset) / 12).toBeCloseTo(4_000, 0);
    expect(out.salary).toBe(defaults.salary);
    expect(out.netMonthlyPay).toBe(defaults.netMonthlyPay);
  });

  it('ships defaults that already agree, so nothing jumps on first paint', () => {
    expect(grossSalaryFor(defaults.netMonthlyPay, ruleset)).toBe(defaults.salary);
    expect(netMonthlyFor(defaults.salary, ruleset)).toBe(defaults.netMonthlyPay);
    expect(grossSalaryFor(defaults.partnerNetMonthlyPay, ruleset)).toBe(defaults.partnerSalary);
    expect(netMonthlyFor(defaults.partnerSalary, ruleset)).toBe(defaults.partnerNetMonthlyPay);
    expect(defaults.healthInsuranceMonthly * 12).toBe(defaults.privateHealthInsurancePremium);
  });
});

describe('health insurance is entered monthly', () => {
  it('multiplies the monthly premium up to the annual figure the model uses', () => {
    const out = rules(withField({ healthInsuranceMonthly: 220 }), 'healthInsuranceMonthly');
    expect(out.privateHealthInsurancePremium).toBe(2_640);
  });

  it('divides an annual premium down when one arrives from an import', () => {
    const out = rules(
      withField({ privateHealthInsurancePremium: 3_600 }),
      'privateHealthInsurancePremium',
    );
    expect(out.healthInsuranceMonthly).toBe(300);
  });
});

describe('an imported file with only one side of a derived pair', () => {
  it('works out the take-home when the file has only a gross salary', () => {
    const out = mergeInputs({ salary: 175_000 }, ruleset);
    expect(out.netMonthlyPay).toBe(netMonthlyFor(175_000, ruleset));
  });

  it('works out the gross when the file has only a take-home figure', () => {
    const out = mergeInputs({ netMonthlyPay: 8_000 }, ruleset);
    expect(out.salary).toBe(grossSalaryFor(8_000, ruleset));
  });

  it('believes the typed figure when a hand-edited file disagrees with itself', () => {
    const out = mergeInputs({ netMonthlyPay: 8_000, salary: 1 }, ruleset);
    expect(out.salary).toBe(grossSalaryFor(8_000, ruleset));
  });

  it('does the same for health insurance', () => {
    expect(
      mergeInputs({ privateHealthInsurancePremium: 2_400 }, ruleset).healthInsuranceMonthly,
    ).toBe(200);
    expect(
      mergeInputs({ healthInsuranceMonthly: 150 }, ruleset).privateHealthInsurancePremium,
    ).toBe(1_800);
  });
});
