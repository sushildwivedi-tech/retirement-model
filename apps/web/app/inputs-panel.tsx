'use client';

import { useEffect, useRef, useState } from 'react';
import {
  superGuaranteeOn,
  takeHome,
  type DrawdownStrategy,
  type Ruleset,
} from '@retirement/engine';
import { applyFieldRules, takeHomeAnnual, PROVISIONAL, type FormInputs } from './inputs';
import { money, pct } from './format';

type Role = 'you' | 'assumption' | 'calculated';

type Field = {
  key: keyof FormInputs;
  label: string;
  kind: 'money' | 'percent' | 'age' | 'year';
  /** Defaults to 'you'. */
  role?: Role;
  /**
   * A figure the model works out from this field, shown underneath it and coloured as
   * calculated. Not an input: there is nowhere to type it. Return '' for nothing to say.
   */
  derived?: (f: FormInputs, ruleset: Ruleset) => string;
};
type Group = {
  title: string;
  fields: Field[];
  /**
   * A yes/no decision this section controls. Rendered at the top of the section, with
   * the fields appearing only once it is Yes - so a choice and the numbers it needs
   * always live together, rather than the switch being somewhere else entirely.
   */
  toggle?: 'hasPartner' | 'downsize' | 'agedCareEnabled' | 'hasMortgage' | 'ownsHome';
  /** Only render this section when that boolean is already on. */
  requires?: 'hasPartner' | 'ownsHome';
  /** Only render this section when that boolean is OFF - the other half of a choice. */
  requiresNot?: 'ownsHome';
  /** One line under the title explaining what the decision means. */
  help?: string;
  /**
   * 'basic' sections are always on screen. Everything else lives behind one disclosure,
   * because fifty-one inputs in sixteen sections is not a form, it is a tax return.
   */
  tier?: 'basic' | 'refine';
};

/**
 * What sacrificing costs in the hand, and whether the cap will take it.
 *
 * Sacrifice comes out before tax, so a $10,000 contribution costs well under $10,000 of
 * take-home - the gap is the point of doing it. Worth stating plainly, because the field
 * above it is the one number in the form that buys something for less than it says.
 */
function sacrificeNote(
  gross: number,
  wanted: number,
  employerMonthly: number,
  ruleset: Ruleset,
): string {
  if (!(gross > 0) || !(wanted > 0)) return '';
  const employerSuper = employerMonthly * 12;
  const p = takeHome(gross, ruleset, { salarySacrifice: wanted, employerSuper });
  const cost = takeHome(gross, ruleset, { employerSuper }).net - p.net;
  const costs = `costs ${money(Math.round(cost))} of take-home`;
  return p.salarySacrificeRefused > 1
    ? `Only ${money(Math.round(p.salarySacrifice))} fits under the cap — ${costs}`
    : `Before tax, so it ${costs}`;
}

/**
 * What the employer's contribution is, in the terms a payslip would put it - and whether
 * it is the legislated minimum or more than that.
 */
function employerNote(gross: number, monthly: number, ruleset: Ruleset): string {
  if (!(gross > 0)) return '';
  const minimum = superGuaranteeOn(gross, ruleset);
  const rate = ruleset.super.guaranteeRate.value;
  const annual = monthly * 12;
  if (annual < minimum - 12) {
    return `Below the ${pct(rate)} minimum — the model uses ${money(Math.round(minimum / 12))}`;
  }
  // No pronoun: the same note sits under the partner's field.
  if (annual <= minimum + 12) return `${pct(rate)} of salary — the legislated minimum`;
  return `${pct(annual / gross)} of salary — above the ${pct(rate)} minimum`;
}

const GROUPS: Group[] = [
  {
    title: 'Do you have a partner?',
    tier: 'basic',
    toggle: 'hasPartner',
    help: 'A couple is assessed jointly for the Age Pension but taxed separately, and each person has their own super and preservation age.',
    fields: [
      { key: 'partnerCurrentAge', label: "Partner's age now", kind: 'age' },
      { key: 'partnerBirthYear', label: "Partner's birth year", kind: 'year' },
      { key: 'partnerRetirementAge', label: 'Partner stops work at', kind: 'age' },
      {
        key: 'partnerNetMonthlyPay',
        label: "Partner's salary in their account / month",
        kind: 'money',
        derived: (f) => (f.partnerSalary > 0 ? `${money(f.partnerSalary)} gross a year` : ''),
      },
    ],
  },
  {
    // Basic, like your own super: answering "yes" to a partner has to bring their
    // details with it. Hiding half of them behind a disclosure meant a couple could
    // enter the partner's pay and never be shown where their balance goes.
    title: "Partner's super",
    tier: 'basic',
    requires: 'hasPartner',
    help: 'The same three payslip figures, for them.',
    fields: [
      { key: 'partnerSuperBalance', label: 'Super balance', kind: 'money' },
      {
        key: 'partnerEmployerSuperMonthly',
        label: 'From their employer / month',
        kind: 'money',
        derived: (f, r) => employerNote(f.partnerSalary, f.partnerEmployerSuperMonthly, r),
      },
      {
        key: 'partnerPersonalSuperMonthly',
        label: 'They put in / month',
        kind: 'money',
        derived: (f, r) =>
          sacrificeNote(
            f.partnerSalary,
            f.partnerVoluntarySuperContribution,
            f.partnerEmployerSuperMonthly,
            r,
          ),
      },
    ],
  },
  {
    title: "Partner's super — the extras",
    requires: 'hasPartner',
    help: 'Money going in beyond their payslip, and what their fund takes out.',
    fields: [
      {
        key: 'partnerAfterTaxContribution',
        label: 'After-tax into super / yr',
        kind: 'money',
      },
      {
        key: 'partnerUnusedConcessionalCapCarriedForward',
        label: 'Unused cap carried forward',
        kind: 'money',
      },
      {
        key: 'partnerInsurancePremiumInSuper',
        label: 'Insurance from super / yr',
        kind: 'money',
      },
      {
        key: 'partnerWageGrowth',
        label: "Partner's wage growth",
        kind: 'percent',
        role: 'assumption',
      },
    ],
  },
  {
    title: 'Partner — part-time work and death',
    requires: 'hasPartner',
    fields: [
      { key: 'partnerPartTimeIncome', label: 'Part-time earns / yr', kind: 'money' },
      { key: 'partnerPartTimeYears', label: 'For how many years', kind: 'age' },
      { key: 'firstDeathAge', label: 'Dies at age (0 = never)', kind: 'age' },
      { key: 'spendingStepDownOnFirstDeath', label: 'Spending after', kind: 'percent', role: 'assumption' },
    ],
  },
  {
    title: 'You',
    tier: 'basic',
    help: 'Age and birth year move together, and you cannot stop work before today. Birth year is what sets your preservation age — when super becomes accessible.',
    fields: [
      { key: 'currentAge', label: 'Age now', kind: 'age' },
      { key: 'birthYear', label: 'Birth year', kind: 'year' },
      { key: 'retirementAge', label: 'Stop full-time work at', kind: 'age' },
      { key: 'planToAge', label: 'Plan to age', kind: 'age' },
    ],
  },
  {
    title: 'Income and saving (while working)',
    tier: 'basic',
    help: 'The three figures off your payslip, plus what it costs you to live. What you save is the difference — so a pay rise, a bigger sacrifice or a leaner month all move it the way they would in life.',
    fields: [
      {
        key: 'netMonthlyPay',
        label: 'Salary in your account / month',
        kind: 'money',
        derived: (f) => (f.salary > 0 ? `${money(f.salary)} gross a year` : ''),
      },
      {
        key: 'employerSuperMonthly',
        label: 'Super from your employer / month',
        kind: 'money',
        derived: (f, r) => employerNote(f.salary, f.employerSuperMonthly, r),
      },
      {
        key: 'personalSuperMonthly',
        label: 'Super you put in / month',
        kind: 'money',
        derived: (f, r) =>
          sacrificeNote(f.salary, f.voluntarySuperContribution, f.employerSuperMonthly, r),
      },
      {
        key: 'livingCostsMonthly',
        label: 'What you spend / month',
        kind: 'money',
        derived: (f) =>
          f.hasMortgage ? 'Not counting the mortgage — that is charged separately' : '',
      },
      {
        key: 'annualSavings',
        label: 'Saved outside super each year',
        kind: 'money',
        role: 'calculated',
        derived: (f) =>
          f.annualSavings < 0
            ? `You spend ${money(-f.annualSavings)} a year more than you earn`
            : `${money(takeHomeAnnual(f))} in, ${money(f.livingCostsMonthly * 12)} out`,
      },
    ],
  },
  {
    title: 'What you have',
    tier: 'basic',
    fields: [
      { key: 'cash', label: 'Cash', kind: 'money' },
      { key: 'investments', label: 'Shares / ETFs outside super', kind: 'money' },
      { key: 'superBalance', label: 'Super', kind: 'money' },
      {
        key: 'personalAssets',
        label: 'Contents, car and effects',
        kind: 'money',
        derived: () =>
          'Counted by the assets test at what it would fetch, never deemed',
      },
    ],
  },
  {
    title: 'Do you own your home?',
    tier: 'basic',
    toggle: 'ownsHome',
    help: 'A home is exempt from the assets test but a renter gets higher asset limits, and Rent Assistance on top of the pension.',
    fields: [{ key: 'primaryResidence', label: 'Home value', kind: 'money' }],
  },
  {
    title: 'Renting',
    tier: 'basic',
    requiresNot: 'ownsHome',
    help: 'Rent is a cost in every year, working or retired. Rent Assistance pays 75c for every dollar of rent above a threshold once the Age Pension starts.',
    fields: [
      {
        key: 'rentPerWeek',
        label: 'Rent / week',
        kind: 'money',
        derived: (f) => `${money(f.rentPerWeek * 52)} a year`,
      },
    ],
  },
  {
    title: 'Spending in retirement',
    tier: 'basic',
    fields: [{ key: 'retirementSpending', label: 'Spending each year', kind: 'money' }],
  },
  {
    title: 'Super — the extras',
    help: 'Money going in beyond the payslip, and what the fund takes out.',
    fields: [
      {
        key: 'afterTaxContribution',
        label: 'After-tax into super / yr',
        kind: 'money',
        derived: (f) =>
          f.afterTaxContribution > 0
            ? 'From savings, already taxed — the fund takes nothing off it'
            : '',
      },
      {
        key: 'unusedConcessionalCapCarriedForward',
        label: 'Unused cap carried forward',
        kind: 'money',
        derived: (f) =>
          f.unusedConcessionalCapCarriedForward > 0
            ? 'myGov reports this. Usable while your balance is under $500,000'
            : '',
      },
      {
        key: 'insurancePremiumInSuper',
        label: 'Insurance paid from super / yr',
        kind: 'money',
        derived: (f) =>
          f.insurancePremiumInSuper > 0 ? 'Stops when you stop work, as default cover does' : '',
      },
    ],
  },
  {
    title: 'Do you have a mortgage?',
    toggle: 'hasMortgage',
    help: 'Repayments are treated as spending that stops when the loan does. Money in an offset account cuts the interest charged, pound for pound, and is still yours.',
    fields: [
      { key: 'mortgageBalance', label: 'Amount owing', kind: 'money' },
      { key: 'mortgageRate', label: 'Interest rate', kind: 'percent' },
      { key: 'mortgageYears', label: 'Years remaining', kind: 'age' },
      { key: 'offsetBalance', label: 'Offset account balance', kind: 'money' },
    ],
  },
  {
    title: 'Will you downsize the home?',
    toggle: 'downsize',
    requires: 'ownsHome',
    help: 'Selling the family home for something smaller frees the equity — and from age 55 lets you put some of it into super.',
    fields: [
      { key: 'downsizeAge', label: 'Downsize at age', kind: 'age' },
      { key: 'downsizeNewHomeValue', label: 'Replacement home', kind: 'money' },
      { key: 'sellingCostRate', label: 'Selling costs', kind: 'percent', role: 'assumption' },
    ],
  },
  {
    title: 'Will you work part-time in retirement?',
    help: 'Leave the amount at zero for none. Counts against the Age Pension income test, but the Work Bonus offsets some of it.',
    fields: [
      { key: 'partTimeIncome', label: 'You earn / yr', kind: 'money' },
      { key: 'partTimeYears', label: 'For how many years', kind: 'age' },
    ],
  },
  {
    title: 'Stress test: residential aged care',
    toggle: 'agedCareEnabled',
    help: 'Assume a spell in residential care, at the published fees. Deliberately a stress test, not a likelihood.',
    fields: [
      { key: 'agedCareFromAge', label: 'Enters care at', kind: 'age' },
      { key: 'agedCareYears', label: 'For how many years', kind: 'age' },
      { key: 'agedCareAccommodation', label: 'Room cost / yr', kind: 'money' },
    ],
  },
  {
    title: 'Health costs',
    fields: [
      {
        key: 'healthInsuranceMonthly',
        label: 'Health insurance / month',
        kind: 'money',
        derived: (f) =>
          f.privateHealthInsurancePremium > 0
            ? `${money(f.privateHealthInsurancePremium)} a year`
            : '',
      },
      { key: 'outOfPocketMultiplier', label: 'Out-of-pocket vs average', kind: 'percent', role: 'assumption' },
      { key: 'healthInflation', label: 'Health inflation', kind: 'percent', role: 'assumption' },
    ],
  },
  {
    title: 'Spending phases',
    fields: [
      { key: 'phaseGoGoTo', label: 'Slow-go from age', kind: 'age', role: 'assumption' },
      { key: 'phaseSlowGoMultiplier', label: 'Slow-go spend', kind: 'percent', role: 'assumption' },
      { key: 'phaseNoGoFrom', label: 'No-go from age', kind: 'age', role: 'assumption' },
      { key: 'phaseNoGoMultiplier', label: 'No-go spend', kind: 'percent', role: 'assumption' },
    ],
  },
  {
    title: 'Assumptions',
    fields: [
      { key: 'cpi', label: 'Inflation (CPI)', kind: 'percent', role: 'assumption' },
      { key: 'wageGrowth', label: 'Wage growth', kind: 'percent', role: 'assumption' },
      { key: 'feeRateSuper', label: 'Fees — super', kind: 'percent', role: 'assumption' },
      {
        key: 'feeRateInvestments',
        label: 'Fees — outside super',
        kind: 'percent',
        role: 'assumption',
      },
      { key: 'investmentIncomeYield', label: 'Of which paid as income', kind: 'percent', role: 'assumption' },
      { key: 'returnCash', label: 'Return — cash', kind: 'percent', role: 'assumption' },
      { key: 'returnInvestments', label: 'Return — investments', kind: 'percent', role: 'assumption' },
      { key: 'returnSuper', label: 'Return — super', kind: 'percent', role: 'assumption' },
      { key: 'returnHome', label: 'Growth — home', kind: 'percent', role: 'assumption' },
    ],
  },
];

/** Every field key the form renders, so a test can check none has gone missing. */
export const FIELD_KEYS: Array<keyof FormInputs> = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

/**
 * Every input the model takes, plus the modelling settings.
 *
 * Shared by the planner sidebar and the side-by-side comparison, so the two can never
 * drift apart - a field added here appears in both, and a scenario being compared is
 * edited with exactly the same controls as the plan itself.
 */
export function InputsPanel({
  form,
  setForm,
  onChange,
  ruleset,
}: {
  form: FormInputs;
  setForm: (update: (f: FormInputs) => FormInputs) => void;
  /** Called after any edit, so callers can clear results computed from stale inputs. */
  onChange: () => void;
  /** Needed to turn take-home pay back into the gross salary the model runs on. */
  ruleset: Ruleset;
}) {
  /*
   * Remembered for the visit, like the form itself: opened once, it stays open while you
   * move between pages.
   *
   * Restored in an effect rather than in the useState initialiser. There is no
   * sessionStorage on the server, so an initialiser that reads it returns false during
   * prerender and true in the browser - and React hydrates a <details open> against a
   * <details> that is shut. The form's own values are loaded the same way, and for the
   * same reason: the first client render has to match the server's.
   */
  const [refineOpen, setRefineOpen] = useState(false);
  const refineHydrated = useRef(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem('retirement-model:refine') === 'open') setRefineOpen(true);
    } catch {
      /* private windows throw; opening from shut is a fine place to start */
    }
    refineHydrated.current = true;
  }, []);
  useEffect(() => {
    // Not before the value above has been restored, or the first paint would overwrite a
    // stored "open" with the shut it started at.
    if (!refineHydrated.current) return;
    try {
      window.sessionStorage.setItem('retirement-model:refine', refineOpen ? 'open' : 'shut');
    } catch {
      /* private windows throw; losing the preference is not fatal */
    }
  }, [refineOpen]);
  const set = (key: keyof FormInputs, raw: string, kind: Field['kind']) => {
    const n = Number(raw.replace(/[^0-9.\-]/g, ''));
    setForm((f) =>
      // Age, birth year and the retirement age constrain each other, as do take-home pay
      // and gross salary; everything else is independent. See applyFieldRules.
      applyFieldRules({ ...f, [key]: kind === 'percent' ? n / 100 : n }, key, ruleset),
    );
    onChange();
  };
  const clearResults = onChange;

  const visible = GROUPS.filter(
    (g) => (!g.requires || form[g.requires]) && (!g.requiresNot || !form[g.requiresNot]),
  );
  const basic = visible.filter((g) => g.tier === 'basic');
  const refined = visible.filter((g) => g.tier !== 'basic');
  // What is switched on behind the closed disclosure, named so it is never silently
  // active. A choice you cannot see is a choice you did not make.
  const active = [
    form.hasMortgage ? `mortgage ${money(form.mortgageBalance)}` : null,
    form.downsize ? `downsizing at ${form.downsizeAge}` : null,
    form.agedCareEnabled ? 'aged care stress test' : null,
    form.partTimeIncome > 0 ? `part-time ${money(form.partTimeIncome)}/yr` : null,
    form.privateHealthInsurancePremium > 0 ? 'health insurance' : null,
  ].filter((x): x is string => x !== null);

  const renderGroup = (g: Group) => {
            const on = g.toggle ? (form[g.toggle] as boolean) : true;
            return (
            <fieldset key={g.title} className={`group ${g.toggle && !on ? 'group-off' : ''}`}>
              <legend className="legend">{g.title}</legend>
              {g.toggle && (
                <div className="toggle mb-2" role="group">
                  {([
                    ['No', false],
                    ['Yes', true],
                  ] as const).map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on === value}
                      onClick={() => {
                        // Through the rules: answering "yes" to a partner adds their pay
                        // to the household, which changes what the household saves.
                        setForm((f) =>
                          applyFieldRules(
                            { ...f, [g.toggle as string]: value },
                            g.toggle as keyof FormInputs,
                            ruleset,
                          ),
                        );
                        clearResults();
                      }}
                      className={`toggle-item ${on === value ? 'toggle-item-on' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {g.help && <p className="help">{g.help}</p>}
              {/* Not rendered at all when the answer is No. Hiding them with CSS left
                  real inputs in the page: focusable, tabbable, and easy to fill in by
                  mistake when they sit above the fields they look like. */}
              {(!g.toggle || on) && (
              <div className="space-y-2">
                {g.fields.map((f) => {
                  const v = form[f.key] as number;
                  return (
                    <div key={String(f.key)}>
                    <label className="field">
                      <span className="field-label">
                        {f.label}
                        {PROVISIONAL.includes(f.key) && (
                          <span
                            className="chip chip-assume ml-1.5"
                            title="Not yet confirmed — a placeholder from the build plan"
                          >
                            assumed
                          </span>
                        )}
                      </span>
                      {f.role === 'calculated' ? (
                        <span
                          className="input input-calc"
                          title="Worked out by the model from what you typed — not an input."
                        >
                          {v.toLocaleString()}
                        </span>
                      ) : (
                        <input
                          className={`input ${f.role === 'assumption' ? 'input-assume' : ''}`}
                          title={
                            f.role === 'assumption'
                              ? 'A modelling assumption you can change — not a fact about you, and not sourced.'
                              : 'Your own figure.'
                          }
                          value={f.kind === 'percent' ? (v * 100).toFixed(2) : String(v)}
                          onChange={(e) => set(f.key, e.target.value, f.kind)}
                        />
                      )}
                    </label>
                    {/* Calculated, so it is shown rather than offered as an input -
                        indigo, matching the legend. Nothing typed, nothing to work out. */}
                    {f.derived && f.derived(form, ruleset) !== '' && (
                      <div className="derived">
                        <span title="Worked out by the model from what you typed — not an input.">
                          {f.derived(form, ruleset)}
                        </span>
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
              )}
            </fieldset>
            );
  };

  return (
    <>
          <div className="form-panel">{basic.map((g) => renderGroup(g))}</div>

          <details
            className="card-quiet !px-0 !py-0 overflow-hidden"
            open={refineOpen}
            onToggle={(e) => setRefineOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="details-summary px-4 py-3 text-sm font-medium">
              Refine the model
              <span className="ml-1 text-xs font-normal text-ink-mute">
                {refined.length} more {refined.length === 1 ? 'section' : 'sections'}
              </span>
              {!refineOpen && active.length > 0 && (
                <span className="chip chip-assume ml-auto">
                  {active.join(' · ')}
                </span>
              )}
            </summary>
            <div className="border-t border-rule-soft">
              <div className="form-panel !rounded-none !border-0 !shadow-none">
                {refined.map((g) => renderGroup(g))}
              </div>
              <div className="space-y-3 border-t border-rule-soft bg-paper p-3">

          <div className="legend pt-2">Modelling settings</div>
          <fieldset className="group">
            <legend className="legend">Index thresholds to CPI</legend>
            {(
              [
                ['indexTaxBrackets', 'Tax brackets, LITO, SAPTO', 'Not indexed in law — this is a judgement call about future policy, and the largest lever in the model.'],
                ['indexAgePension', 'Age Pension rates & limits', 'Indexed in law. Turning this off models something that does not happen.'],
                ['indexSuperCaps', 'Super caps', 'Indexed to AWOTE in law.'],
              ] as const
            ).map(([key, label, why]) => (
              <label key={key} className="flex items-start gap-2 py-1 text-sm" title={why}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form[key]}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, [key]: e.target.checked }));
                    clearResults();
                  }}
                />
                <span>
                  <span className="text-ink-soft">{label}</span>
                  {key === 'indexTaxBrackets' && (
                    <span className="chip chip-assume ml-1.5">
                      your choice
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="group flex items-center gap-2 text-sm">
            <span className="font-medium">Drawdown</span>
            <select
              className="select ml-auto min-w-0 max-w-[60%]"
              value={form.drawdownStrategy}
              onChange={(e) => {
                setForm((f) => ({ ...f, drawdownStrategy: e.target.value as DrawdownStrategy }));
                clearResults();
              }}
            >
              <option value="outsideSuperFirst">Outside super first</option>
              <option value="superFirst">Super first</option>
              <option value="proportional">Proportional</option>
              <option value="cashBuffer">Cash buffer</option>
            </select>
          </label>
          <label className="group flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.glidePath}
              onChange={(e) => {
                setForm((f) => ({ ...f, glidePath: e.target.checked }));
                clearResults();
              }}
            />
            <span className="font-medium">Glide to defensive with age</span>
          </label>
          <label
            className="group flex items-start gap-2 text-sm"
            title="A compulsory minimum pension payment you did not need is deemed and taxed while it sits in cash. Putting it back stops both, while you are under 75 and have non-concessional cap room."
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={form.recontributeExcessDrawdown}
              onChange={(e) => {
                setForm((f) => ({ ...f, recontributeExcessDrawdown: e.target.checked }));
                clearResults();
              }}
            />
            <span>
              <span className="font-medium">Recontribute unneeded drawdowns</span>
              <span className="block text-xs text-ink-mute">
                Minimum pension payments you did not spend go back into super, under 75
              </span>
            </span>
          </label>
          <fieldset className="group">
            <legend className="legend">
              Gender (life tables)
            </legend>
            <label className="flex items-center gap-2 py-1 text-sm">
              <span className="text-ink-soft">You</span>
              <select
                className="select ml-auto min-w-0 max-w-[60%]"
                value={form.sex}
                onChange={(e) => {
                  setForm((f) => ({ ...f, sex: e.target.value as FormInputs['sex'] }));
                  clearResults();
                }}
              >
                <option value="unspecified">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
            {form.hasPartner && (
              <label className="flex items-center gap-2 py-1 text-sm">
                <span className="text-ink-soft">Partner</span>
                <select
                  className="select ml-auto min-w-0 max-w-[60%]"
                  value={form.partnerSex}
                  onChange={(e) => {
                    setForm((f) => ({
                      ...f,
                      partnerSex: e.target.value as FormInputs['partnerSex'],
                    }));
                    clearResults();
                  }}
                >
                  <option value="unspecified">Not set</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </label>
            )}
          </fieldset>
              </div>
            </div>
          </details>
    </>
  );
}
