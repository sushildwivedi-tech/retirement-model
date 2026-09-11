import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { netFromGross, superGuaranteeOn, takeHome, type Ruleset } from '@retirement/engine';
import { FIELD_KEYS } from '../app/inputs-panel';
import {
  defaults,
  mergeInputs,
  applyFieldRules,
  grossSalaryFor,
  netMonthlyFor,
  toScenario,
  savingsFor,
  takeHomeAnnual,
  withChange,
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

describe('salary sacrifice comes out before the take-home figure', () => {
  const sacrificing = (over: Partial<FormInputs>) =>
    withField({ salary: 120_000, netMonthlyPay: netMonthlyFor(120_000, ruleset), ...over });

  it('lowers take-home without touching the salary, because that is what it does', () => {
    const before = sacrificing({});
    const out = rules(
      { ...before, voluntarySuperContribution: 10_000 },
      'voluntarySuperContribution',
    );
    expect(out.salary).toBe(120_000);
    expect(out.netMonthlyPay).toBeLessThan(before.netMonthlyPay);
  });

  it('costs less in the hand than it puts into super', () => {
    const before = sacrificing({});
    const out = rules(
      { ...before, voluntarySuperContribution: 10_000 },
      'voluntarySuperContribution',
    );
    const cost = (before.netMonthlyPay - out.netMonthlyPay) * 12;
    expect(cost).toBeLessThan(10_000);
    expect(cost).toBeGreaterThan(5_000);
  });

  it('needs a higher salary to reach the same take-home', () => {
    const plain = rules(withField({ netMonthlyPay: 7_000 }), 'netMonthlyPay');
    const with10k = rules(
      withField({ netMonthlyPay: 7_000, voluntarySuperContribution: 10_000 }),
      'netMonthlyPay',
    );
    expect(with10k.salary).toBeGreaterThan(plain.salary);
    // It fits under the cap at this salary, so it is simply added on top.
    expect(with10k.salary).toBe(plain.salary + 10_000);
  });

  it('holds the take-home the user typed when the sacrifice is entered afterwards', () => {
    // The gross moves, not the take-home: they told us what reaches the bank.
    const typed = rules(withField({ netMonthlyPay: 7_000 }), 'netMonthlyPay');
    const then = rules({ ...typed, voluntarySuperContribution: 12_000 }, 'netMonthlyPay');
    expect(then.netMonthlyPay).toBe(7_000);
    expect(takeHome(then.salary, ruleset, { salarySacrifice: 12_000 }).net / 12).toBeCloseTo(
      7_000,
      0,
    );
  });

  it('round-trips through the gross and back with a sacrifice in the way', () => {
    let f = rules(withField({ voluntarySuperContribution: 15_000, netMonthlyPay: 6_500 }), 'netMonthlyPay');
    for (let i = 0; i < 5; i++) {
      f = rules({ ...f, salary: f.salary }, 'salary');
      f = rules({ ...f, netMonthlyPay: f.netMonthlyPay }, 'netMonthlyPay');
    }
    expect(f.netMonthlyPay).toBe(6_500);
  });

  it('will not pretend a sacrifice the concessional cap refuses reduces your tax', () => {
    // At $120,000 the guarantee already uses most of the cap, so a $30,000 sacrifice is
    // trimmed - and only the part that fits comes off taxable income.
    const out = rules(
      sacrificing({ voluntarySuperContribution: 30_000 }),
      'voluntarySuperContribution',
    );
    const p = takeHome(120_000, ruleset, { salarySacrifice: 30_000 });
    expect(p.salarySacrificeRefused).toBeGreaterThan(0);
    expect(out.netMonthlyPay).toBe(Math.round(p.net / 12));
  });

  it('does the same for a partner, without touching yours', () => {
    const before = withField({ hasPartner: true });
    const out = rules(
      { ...before, partnerVoluntarySuperContribution: 8_000 },
      'partnerVoluntarySuperContribution',
    );
    expect(out.partnerSalary).toBe(defaults.partnerSalary);
    expect(out.partnerNetMonthlyPay).toBeLessThan(defaults.partnerNetMonthlyPay);
    expect(out.netMonthlyPay).toBe(defaults.netMonthlyPay);
  });

  it('is accounted for when a scenario file is imported', () => {
    const out = mergeInputs({ salary: 120_000, voluntarySuperContribution: 10_000 }, ruleset);
    expect(out.netMonthlyPay).toBe(netMonthlyFor(120_000, ruleset, { salarySacrifice: 10_000 }));
    expect(out.netMonthlyPay).toBeLessThan(netMonthlyFor(120_000, ruleset));
  });
});

describe('the three payslip lines', () => {
  const sgOn = (gross: number) => Math.round(superGuaranteeOn(gross, ruleset) / 12);

  it('ships an employer contribution that is exactly the legislated minimum', () => {
    expect(defaults.employerSuperMonthly).toBe(sgOn(defaults.salary));
    expect(defaults.partnerEmployerSuperMonthly).toBe(sgOn(defaults.partnerSalary));
  });

  it('moves the employer contribution when the pay changes, staying on the minimum', () => {
    const out = rules(withField({ netMonthlyPay: 9_000 }), 'netMonthlyPay');
    expect(out.employerSuperMonthly).toBe(sgOn(out.salary));
    expect(out.employerSuperMonthly).toBeGreaterThan(defaults.employerSuperMonthly);
  });

  it('keeps an employer paying above the minimum on their rate when pay changes', () => {
    // 15.4%, as much of the public service pays.
    const generous = rules(
      withField({ employerSuperMonthly: Math.round((120_000 * 0.154) / 12) }),
      'employerSuperMonthly',
    );
    const raised = rules({ ...generous, netMonthlyPay: 9_000 }, 'netMonthlyPay');
    expect((raised.employerSuperMonthly * 12) / raised.salary).toBeCloseTo(0.154, 3);
    expect(raised.employerSuperMonthly).toBeGreaterThan(sgOn(raised.salary));
  });

  it('does not let employer super change take-home, since it is paid on top', () => {
    const before = withField({});
    const after = rules(
      { ...before, employerSuperMonthly: Math.round((120_000 * 0.154) / 12) },
      'employerSuperMonthly',
    );
    expect(after.netMonthlyPay).toBe(before.netMonthlyPay);
    expect(after.salary).toBe(before.salary);
  });

  it('does let it change take-home when it squeezes a sacrifice against the cap', () => {
    // The cap covers both, so a bigger employer contribution leaves less room to
    // sacrifice into. The part that no longer fits is not lost - it stays in your pay and
    // is taxed there, so take-home goes *up* while less reaches super.
    const sacrificing = rules(withField({ personalSuperMonthly: 1_500 }), 'personalSuperMonthly');
    const generous = rules(
      { ...sacrificing, employerSuperMonthly: Math.round((120_000 * 0.154) / 12) },
      'employerSuperMonthly',
    );
    expect(generous.netMonthlyPay).toBeGreaterThan(sacrificing.netMonthlyPay);
    const refused = takeHome(120_000, ruleset, {
      salarySacrifice: 18_000,
      employerSuper: 120_000 * 0.154,
    }).salarySacrificeRefused;
    expect(refused).toBeGreaterThan(0);
  });

  it('leaves a figure below the minimum as typed, for the engine to lift', () => {
    // Not clamped in the form: the field says what it is, and the note under it says the
    // model will use the legislated minimum instead.
    const out = rules(withField({ employerSuperMonthly: 100 }), 'employerSuperMonthly');
    expect(out.employerSuperMonthly).toBe(100);
  });

  it('carries what you put in yourself through as the annual figure the engine wants', () => {
    const out = rules(withField({ personalSuperMonthly: 800 }), 'personalSuperMonthly');
    expect(out.voluntarySuperContribution).toBe(9_600);
    expect(out.netMonthlyPay).toBeLessThan(defaults.netMonthlyPay);
  });

  it('fills the monthly figure in when a lever sets the annual one', () => {
    const out = rules(
      withField({ voluntarySuperContribution: 12_000 }),
      'voluntarySuperContribution',
    );
    expect(out.personalSuperMonthly).toBe(1_000);
  });

  it('hands the employer contribution to the engine in dollars a year', () => {
    const f = rules(withField({ employerSuperMonthly: 1_540 }), 'employerSuperMonthly');
    const s = toScenario(f, { phiInflation: 0.05 });
    expect(s.household.people[0].employerSuperContribution).toBe(1_540 * 12);
  });

  it('does all of it for a partner too, without touching yours', () => {
    const out = rules(
      withField({ hasPartner: true, partnerNetMonthlyPay: 7_000 }),
      'partnerNetMonthlyPay',
    );
    expect(out.partnerEmployerSuperMonthly).toBe(sgOn(out.partnerSalary));
    expect(out.employerSuperMonthly).toBe(defaults.employerSuperMonthly);
    expect(out.netMonthlyPay).toBe(defaults.netMonthlyPay);
  });

  it('reconciles an imported file that knows only the annual sacrifice', () => {
    const out = mergeInputs({ salary: 150_000, voluntarySuperContribution: 6_000 }, ruleset);
    expect(out.personalSuperMonthly).toBe(500);
    expect(out.employerSuperMonthly).toBe(sgOn(150_000));
    expect(out.netMonthlyPay).toBe(netMonthlyFor(150_000, ruleset, { salarySacrifice: 6_000 }));
  });

  it('believes an imported employer contribution rather than recomputing it', () => {
    const out = mergeInputs({ salary: 120_000, employerSuperMonthly: 1_540 }, ruleset);
    expect(out.employerSuperMonthly).toBe(1_540);
  });
});

describe('what you save is what is left, not what you type', () => {
  it('ships an example whose three figures already agree', () => {
    expect(savingsFor(defaults)).toBe(defaults.annualSavings);
    expect(defaults.annualSavings).toBe(30_000);
  });

  it('moves when the pay moves', () => {
    const richer = rules(withField({ netMonthlyPay: 9_000 }), 'netMonthlyPay');
    expect(richer.annualSavings).toBe(
      Math.round((9_000 - defaults.livingCostsMonthly) * 12),
    );
    expect(richer.annualSavings).toBeGreaterThan(defaults.annualSavings);
  });

  it('moves when the living costs move', () => {
    const leaner = rules(withField({ livingCostsMonthly: 4_000 }), 'livingCostsMonthly');
    expect(leaner.annualSavings).toBe(Math.round((defaults.netMonthlyPay - 4_000) * 12));
  });

  it('charges a salary sacrifice against savings, not against nothing', () => {
    // The whole point of deriving it: the sacrifice lowers take-home, so it lowers what
    // is saved outside super. No separate bookkeeping, and no way for the two to disagree.
    const sacrificing = rules(
      withField({ voluntarySuperContribution: 10_000 }),
      'voluntarySuperContribution',
    );
    const cost = defaults.annualSavings - sacrificing.annualSavings;
    expect(cost).toBeGreaterThan(5_000);
    expect(cost).toBeLessThan(10_000);
    expect(cost).toBe((defaults.netMonthlyPay - sacrificing.netMonthlyPay) * 12);
  });

  it('counts a partner’s pay once they exist', () => {
    const single = withField({});
    const couple = rules({ ...single, hasPartner: true }, 'hasPartner');
    expect(takeHomeAnnual(couple)).toBe(
      (defaults.netMonthlyPay + defaults.partnerNetMonthlyPay) * 12,
    );
    expect(couple.annualSavings).toBe(single.annualSavings + defaults.partnerNetMonthlyPay * 12);
  });

  it('goes negative rather than pretending, when you spend more than you earn', () => {
    const overspending = rules(withField({ livingCostsMonthly: 9_000 }), 'livingCostsMonthly');
    expect(overspending.annualSavings).toBeLessThan(0);
  });

  it('works a living-cost figure backwards out of an older scenario file', () => {
    const out = mergeInputs({ annualSavings: 12_000 }, ruleset);
    expect(out.livingCostsMonthly).toBe(
      Math.round((takeHomeAnnual(defaults) - 12_000) / 12),
    );
    expect(out.annualSavings).toBeCloseTo(12_000, -1);
  });

  it('believes living costs when a file carries both', () => {
    const out = mergeInputs({ annualSavings: 1, livingCostsMonthly: 4_000 }, ruleset);
    expect(out.annualSavings).toBe(Math.round((defaults.netMonthlyPay - 4_000) * 12));
  });
});

describe('a lever change is applied the way it was measured', () => {
  it('carries derived fields with it', () => {
    const after = withChange(defaults, { livingCostsMonthly: 4_257 }, ruleset);
    expect(after.annualSavings).toBe(Math.round((defaults.netMonthlyPay - 4_257) * 12));
  });

  it('carries the take-home cost of a sacrifice lever', () => {
    const after = withChange(defaults, { voluntarySuperContribution: 10_000 }, ruleset);
    expect(after.netMonthlyPay).toBeLessThan(defaults.netMonthlyPay);
    expect(after.annualSavings).toBeLessThan(defaults.annualSavings);
    expect(after.salary).toBe(defaults.salary);
  });
});

describe('every field the form declares actually exists', () => {
  // Wage growth went missing for one commit because an edit replaced the two lines it
  // shared with the old savings field. A list is cheaper than noticing by eye.
  it('offers the fields a plan cannot be built without', () => {
    const required: Array<keyof FormInputs> = [
      'currentAge',
      'retirementAge',
      'netMonthlyPay',
      'employerSuperMonthly',
      'personalSuperMonthly',
      'livingCostsMonthly',
      'annualSavings',
      'wageGrowth',
      'cash',
      'investments',
      'superBalance',
      'primaryResidence',
      'retirementSpending',
      'cpi',
      'returnSuper',
      'feeRateSuper',
    ];
    for (const key of required) expect(FIELD_KEYS).toContain(key);
  });

  it('names only real fields', () => {
    for (const key of FIELD_KEYS) expect(Object.keys(defaults)).toContain(key);
  });
});

describe('a plan name and the folder it lands in', () => {
  it('agree with the server, which is the only reason the client computes it at all', async () => {
    // Two copies of one rule is a bug waiting to happen, so the two are pinned together.
    const client = await import('../app/plans');
    // No extension: this project resolves like a bundler, and next build type-checks
    // test files, where an explicit .ts in an import path is an error.
    const server = await import('../../desktop/plans');
    for (const name of [
      'Our plan',
      'Plan B — 2026!',
      '  ',
      '../../etc/passwd',
      'A'.repeat(80),
      'Ünïcodé plan',
    ]) {
      expect(client.toSlug(name)).toBe(server.toSlug(name));
    }
  });
});

describe('the comparison table shows every difference', () => {
  it('can name every input, so none is silently invisible', async () => {
    // It used to walk a hand-kept label list, and twenty-seven fields were missing from
    // it - four of them partner fields whose non-partner twin was listed. Two plans that
    // differed only in those were reported as identical.
    const { FIELD_LABELS, HIDDEN_FROM_DIFF, humanise } = await import('../app/compare-view');
    for (const key of Object.keys(defaults) as Array<keyof FormInputs>) {
      if (HIDDEN_FROM_DIFF.has(key)) continue;
      const label = FIELD_LABELS[key] ?? humanise(key);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('treats a partner field the same as the field it mirrors', async () => {
    const { FIELD_LABELS, HIDDEN_FROM_DIFF } = await import('../app/compare-view');
    for (const key of Object.keys(defaults) as Array<keyof FormInputs>) {
      if (!key.startsWith('partner') || HIDDEN_FROM_DIFF.has(key)) continue;
      const twin = (key[7].toLowerCase() + key.slice(8)) as keyof FormInputs;
      if (!(twin in defaults) || HIDDEN_FROM_DIFF.has(twin)) continue;
      // If one of a pair is named, so is the other - otherwise the couple's half of a
      // comparison reads as less detailed than yours for no reason.
      expect(Boolean(FIELD_LABELS[key])).toBe(Boolean(FIELD_LABELS[twin]));
    }
  });
});
