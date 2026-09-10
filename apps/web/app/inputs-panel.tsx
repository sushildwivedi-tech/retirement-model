'use client';

import type { DrawdownStrategy } from '@retirement/engine';
import { PROVISIONAL, type FormInputs } from './inputs';

type Role = 'you' | 'assumption';

type Field = {
  key: keyof FormInputs;
  label: string;
  kind: 'money' | 'percent' | 'age' | 'year';
  /** Defaults to 'you'. */
  role?: Role;
};
type Group = {
  title: string;
  fields: Field[];
  /**
   * A yes/no decision this section controls. Rendered at the top of the section, with
   * the fields appearing only once it is Yes - so a choice and the numbers it needs
   * always live together, rather than the switch being somewhere else entirely.
   */
  toggle?: 'hasPartner' | 'downsize' | 'agedCareEnabled' | 'hasMortgage';
  /** Only render this section when that boolean is already on. */
  requires?: 'hasPartner';
  /** One line under the title explaining what the decision means. */
  help?: string;
};

const GROUPS: Group[] = [
  {
    title: 'Do you have a partner?',
    toggle: 'hasPartner',
    help: 'A couple is assessed jointly for the Age Pension but taxed separately, and each person has their own super and preservation age.',
    fields: [
      { key: 'partnerCurrentAge', label: 'Age now', kind: 'age' },
      { key: 'partnerBirthYear', label: 'Birth year', kind: 'year' },
      { key: 'partnerRetirementAge', label: 'Stops work at', kind: 'age' },
      { key: 'partnerSalary', label: 'Gross salary', kind: 'money' },
      { key: 'partnerWageGrowth', label: 'Wage growth', kind: 'percent', role: 'assumption' },
    ],
  },
  {
    title: 'Partner — super',
    requires: 'hasPartner',
    fields: [
      { key: 'partnerSuperBalance', label: 'Super balance', kind: 'money' },
      { key: 'partnerVoluntarySuperContribution', label: 'Extra contributions / yr', kind: 'money' },
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
    fields: [
      { key: 'currentAge', label: 'Age now', kind: 'age' },
      { key: 'birthYear', label: 'Birth year', kind: 'year' },
      { key: 'retirementAge', label: 'Stop full-time work at', kind: 'age' },
      { key: 'planToAge', label: 'Plan to age', kind: 'age' },
    ],
  },
  {
    title: 'Income and saving (while working)',
    fields: [
      { key: 'salary', label: 'Gross salary', kind: 'money' },
      { key: 'wageGrowth', label: 'Wage growth', kind: 'percent', role: 'assumption' },
      { key: 'annualSavings', label: 'Saved outside super each year', kind: 'money' },
      { key: 'voluntarySuperContribution', label: 'Extra super contributions', kind: 'money' },
    ],
  },
  {
    title: 'What you have',
    fields: [
      { key: 'cash', label: 'Cash', kind: 'money' },
      { key: 'investments', label: 'Shares / ETFs outside super', kind: 'money' },
      { key: 'superBalance', label: 'Super', kind: 'money' },
      { key: 'primaryResidence', label: 'Home value', kind: 'money' },
    ],
  },
  {
    title: 'Spending in retirement',
    fields: [{ key: 'retirementSpending', label: 'Spending each year', kind: 'money' }],
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
      { key: 'privateHealthInsurancePremium', label: 'Health insurance / yr', kind: 'money' },
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
      { key: 'investmentIncomeYield', label: 'Of which paid as income', kind: 'percent', role: 'assumption' },
      { key: 'returnCash', label: 'Return — cash', kind: 'percent', role: 'assumption' },
      { key: 'returnInvestments', label: 'Return — investments', kind: 'percent', role: 'assumption' },
      { key: 'returnSuper', label: 'Return — super', kind: 'percent', role: 'assumption' },
      { key: 'returnHome', label: 'Growth — home', kind: 'percent', role: 'assumption' },
    ],
  },
];

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
}: {
  form: FormInputs;
  setForm: (update: (f: FormInputs) => FormInputs) => void;
  /** Called after any edit, so callers can clear results computed from stale inputs. */
  onChange: () => void;
}) {
  const set = (key: keyof FormInputs, raw: string, kind: Field['kind']) => {
    const n = Number(raw.replace(/[^0-9.\-]/g, ''));
    setForm((f) => ({ ...f, [key]: kind === 'percent' ? n / 100 : n }));
    onChange();
  };
  const clearResults = onChange;
  return (
    <>
          {GROUPS.filter((g) => !g.requires || form[g.requires]).map((g) => {
            const on = g.toggle ? (form[g.toggle] as boolean) : true;
            return (
            <fieldset
              key={g.title}
              className={`rounded-lg border p-3 ${
                g.toggle && !on ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'
              }`}
            >
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.title}
              </legend>
              {g.toggle && (
                <div
                  className="mb-2 inline-flex overflow-hidden rounded border border-slate-300"
                  role="group"
                >
                  {([
                    ['No', false],
                    ['Yes', true],
                  ] as const).map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on === value}
                      onClick={() => {
                        setForm((f) => ({ ...f, [g.toggle as string]: value }));
                        clearResults();
                      }}
                      className={`px-3 py-1 text-sm ${
                        on === value
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {g.help && <p className="mb-2 text-xs text-slate-600">{g.help}</p>}
              <div className={`space-y-2 ${g.toggle && !on ? 'hidden' : ''}`}>
                {g.fields.map((f) => {
                  const v = form[f.key] as number;
                  return (
                    <label key={String(f.key)} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-slate-700">
                        {f.label}
                        {PROVISIONAL.includes(f.key) && (
                          <span
                            className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800"
                            title="Not yet confirmed — a placeholder from the build plan"
                          >
                            assumed
                          </span>
                        )}
                      </span>
                      <input
                        className={`w-28 rounded border px-2 py-1 text-right tabular-nums ${
                          f.role === 'assumption'
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-slate-300 bg-white'
                        }`}
                        title={
                          f.role === 'assumption'
                            ? 'A modelling assumption you can change — not a fact about you, and not sourced.'
                            : 'Your own figure.'
                        }
                        value={f.kind === 'percent' ? (v * 100).toFixed(2) : String(v)}
                        onChange={(e) => set(f.key, e.target.value, f.kind)}
                      />
                    </label>
                  );
                })}
              </div>
            </fieldset>
            );
          })}

          <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Modelling settings
          </div>
          <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Index thresholds to CPI
            </legend>
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
                  <span className="text-slate-700">{label}</span>
                  {key === 'indexTaxBrackets' && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">
                      your choice
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <span className="font-medium">Drawdown</span>
            <select
              className="ml-auto rounded border border-slate-300 px-2 py-1"
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
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
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
          <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Gender (life tables)
            </legend>
            <label className="flex items-center gap-2 py-1 text-sm">
              <span className="text-slate-700">You</span>
              <select
                className="ml-auto rounded border border-slate-300 px-2 py-1"
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
                <span className="text-slate-700">Partner</span>
                <select
                  className="ml-auto rounded border border-slate-300 px-2 py-1"
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
    </>
  );
}
