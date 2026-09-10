import { describe, expect, it } from 'vitest';
import { defaults, mergeInputs, syncAgeAndBirthYear, type FormInputs } from '../app/inputs';

const withField = (over: Partial<FormInputs>): FormInputs => ({ ...defaults, ...over });

describe('age and birth year stay consistent', () => {
  it('the shipped defaults already agree', () => {
    expect(defaults.startYear - defaults.currentAge).toBe(defaults.birthYear);
  });

  it('changing your age moves your birth year', () => {
    const out = syncAgeAndBirthYear(withField({ currentAge: 55 }), 'currentAge');
    expect(out.birthYear).toBe(defaults.startYear - 55);
  });

  it('changing your birth year moves your age', () => {
    const out = syncAgeAndBirthYear(withField({ birthYear: 1990 }), 'birthYear');
    expect(out.currentAge).toBe(defaults.startYear - 1990);
  });

  it('does the same for a partner, independently of you', () => {
    const out = syncAgeAndBirthYear(withField({ partnerCurrentAge: 47 }), 'partnerCurrentAge');
    expect(out.partnerBirthYear).toBe(defaults.startYear - 47);
    expect(out.currentAge).toBe(defaults.currentAge);
    expect(out.birthYear).toBe(defaults.birthYear);
  });

  it('moving the plan start year keeps ages and shifts birth years', () => {
    const out = syncAgeAndBirthYear(withField({ startYear: 2030 }), 'startYear');
    expect(out.currentAge).toBe(defaults.currentAge);
    expect(out.birthYear).toBe(2030 - defaults.currentAge);
  });

  it('leaves everything alone when some other field changes', () => {
    const before = withField({ salary: 200_000 });
    const after = syncAgeAndBirthYear(before, 'salary');
    expect(after).toEqual(before);
  });

  it('ignores a birth year that is not a real year', () => {
    // Mid-typing an input can be empty, which reads as 0.
    const out = syncAgeAndBirthYear(withField({ birthYear: 0 }), 'birthYear');
    expect(out.currentAge).toBe(defaults.currentAge);
  });

  it('round-trips: setting an age then its birth year returns the same age', () => {
    const a = syncAgeAndBirthYear(withField({ currentAge: 61 }), 'currentAge');
    const b = syncAgeAndBirthYear({ ...a, birthYear: a.birthYear }, 'birthYear');
    expect(b.currentAge).toBe(61);
  });
});

describe('merging a saved or imported scenario', () => {
  it('keeps known numeric fields', () => {
    expect(mergeInputs({ salary: 175_000 }).salary).toBe(175_000);
  });

  it('drops fields of the wrong type rather than trusting the file', () => {
    expect(mergeInputs({ salary: 'lots' as unknown as number }).salary).toBe(defaults.salary);
  });

  it('ignores keys it does not know', () => {
    const out = mergeInputs({ nonsense: 1 } as unknown as Partial<FormInputs>);
    expect(out).toEqual(defaults);
  });

  it('rejects a non-finite number', () => {
    expect(mergeInputs({ currentAge: NaN }).currentAge).toBe(defaults.currentAge);
  });
});
