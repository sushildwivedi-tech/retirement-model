'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  compareScenarios,
  earliestRetirementAge,
  maxSustainableSpend,
  monteCarlo,
  project,
  toCsv,
  toRealRow,
  type GoalSeekResult,
  type MonteCarloResult,
  type HealthCostCurve,
  type LifeTables,
  type Ruleset,
  type YearRow,
} from '@retirement/engine';
import {
  clearSaved,
  defaults,
  loadSaved,
  mergeInputs,
  PARTNER_ID,
  PRIMARY_ID,
  PROVISIONAL,
  save,
  toScenario,
  type FormInputs,
} from './inputs';
import type { DrawdownStrategy } from '@retirement/engine';
import { money, pct } from './format';
import BalanceChart from './balance-chart';
import HealthChart from './health-chart';
import FanChart from './fan-chart';

/**
 * Where a number comes from. The UI colour-codes this, because a figure the user typed
 * and a figure taken from the ATO are not the same kind of thing and should not look
 * alike. Anything sourced from public data or produced by the model is NOT an input.
 */
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
  partnerOnly?: boolean;
  agedCareOnly?: boolean;
  downsizeOnly?: boolean;
};

const GROUPS: Group[] = [
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
    title: 'Aged care stress test',
    agedCareOnly: true,
    fields: [
      { key: 'agedCareFromAge', label: 'Enters care at', kind: 'age' },
      { key: 'agedCareYears', label: 'For how many years', kind: 'age' },
      { key: 'agedCareAccommodation', label: 'Room cost / yr', kind: 'money' },
    ],
  },
  {
    title: 'Part-time work in retirement',
    fields: [
      { key: 'partTimeIncome', label: 'You earn / yr', kind: 'money' },
      { key: 'partTimeYears', label: 'For how many years', kind: 'age' },
    ],
  },
  {
    title: 'Partner',
    partnerOnly: true,
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
    partnerOnly: true,
    fields: [
      { key: 'partnerSuperBalance', label: 'Super balance', kind: 'money' },
      { key: 'partnerVoluntarySuperContribution', label: 'Extra contributions / yr', kind: 'money' },
    ],
  },
  {
    title: 'Partner — retirement & death',
    partnerOnly: true,
    fields: [
      { key: 'partnerPartTimeIncome', label: 'Part-time earns / yr', kind: 'money' },
      { key: 'partnerPartTimeYears', label: 'For how many years', kind: 'age' },
      { key: 'firstDeathAge', label: 'Dies at age (0 = never)', kind: 'age' },
      { key: 'spendingStepDownOnFirstDeath', label: 'Spending after', kind: 'percent', role: 'assumption' },
    ],
  },
  {
    title: 'Downsize',
    downsizeOnly: true,
    fields: [
      { key: 'downsizeAge', label: 'Downsize at age', kind: 'age' },
      { key: 'downsizeNewHomeValue', label: 'Replacement home', kind: 'money' },
      { key: 'sellingCostRate', label: 'Selling costs', kind: 'percent', role: 'assumption' },
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

export default function Planner({
  ruleset,
  lifeTables,
  healthCostCurve,
}: {
  ruleset: Ruleset;
  lifeTables: LifeTables;
  healthCostCurve: HealthCostCurve;
}) {
  // Starts from the illustrative example. Anything the visitor types is theirs, kept in
  // their own browser - the first render must match the server's, so the saved values are
  // picked up in an effect rather than during render.
  const [form, setForm] = useState<FormInputs>(defaults);
  const [usingSaved, setUsingSaved] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setForm(saved);
      setUsingSaved(true);
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    // Don't claim to have saved anything while the form is still the untouched example.
    const pristine = JSON.stringify(form) === JSON.stringify(defaults);
    if (pristine && !usingSaved) return;
    save(form);
    setUsingSaved(true);
  }, [form, usingSaved]);
  const [real, setReal] = useState(true);
  // Monte Carlo and the solvers take seconds, so they run on demand rather than on every
  // keystroke. Results are cleared whenever an input changes so a stale probability is
  // never shown against edited inputs.
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [spendSolve, setSpendSolve] = useState<GoalSeekResult<number> | null>(null);
  const [ageSolve, setAgeSolve] = useState<GoalSeekResult<number> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(85);

  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        value: project(
          toScenario(form, {
            phiInflation: ruleset.privateHealthInsurance.premiumGrowthRate.value,
          }),
          ruleset,
          { lifeTables, healthCostCurve },
        ),
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [form, ruleset, lifeTables, healthCostCurve]);

  if (!result.ok) {
    return <main className="p-8 text-red-700">Could not run the projection: {result.error}</main>;
  }

  const r = result.value;
  const rows: YearRow[] = real ? r.rows.map(toRealRow) : r.rows;
  const at = (age: number) => rows.find((x) => x.ages[PRIMARY_ID] === age);
  // Each person has their own bridge between retiring and reaching preservation age.
  const bridge = r.bridge.find((b) => b.personId === PRIMARY_ID) ?? r.bridge[0];
  const partnerBridge = r.bridge.find((b) => b.personId === PARTNER_ID);
  // The year the household first cannot fund its target from its own assets. The Age
  // Pension does not stop there, so the dashboard says what life actually looks like after.
  const depleted = rows.find((x) => x.shortfall > 0) ?? null;

  const set = (key: keyof FormInputs, raw: string, kind: Field['kind']) => {
    const n = Number(raw.replace(/[^0-9.\-]/g, ''));
    setForm((f) => ({ ...f, [key]: kind === 'percent' ? n / 100 : n }));
    setMc(null);
    setSpendSolve(null);
    setAgeSolve(null);
  };

  const [importError, setImportError] = useState<string | null>(null);

  const clearResults = () => {
    setMc(null);
    setSpendSolve(null);
    setAgeSolve(null);
  };

  const exportInputs = () => {
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'retirement-scenario.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importInputs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<FormInputs>;
      // mergeInputs keeps only known keys of the right type, so a stale or hand-edited
      // file cannot put an unexpected shape into the form.
      setForm(mergeInputs(parsed));
      clearResults();
      setImportError(null);
    } catch {
      setImportError('That file could not be read as a saved scenario.');
    }
  };

  const resetInputs = () => {
    clearSaved();
    setForm(defaults);
    setUsingSaved(false);
    clearResults();
  };

  // Yield to the browser so the "working…" state paints before the main thread blocks.
  const run = (label: string, work: () => void) => {
    setBusy(label);
    setTimeout(() => {
      try {
        work();
      } finally {
        setBusy(null);
      }
    }, 20);
  };

  // --- Planning levers -------------------------------------------------------------
  // Each is a concrete change to the plan, evaluated deterministically. One projection
  // is well under a millisecond, so the whole table recomputes on every edit.
  const levers = useMemo(() => {
    const phi = { phiInflation: ruleset.privateHealthInsurance.premiumGrowthRate.value };
    const candidates: Array<{ label: string; detail: string; change: Partial<FormInputs> }> = [
      {
        label: 'Work two more years',
        detail: `Retire at ${form.retirementAge + 2} instead of ${form.retirementAge}`,
        change: { retirementAge: form.retirementAge + 2 },
      },
      {
        label: 'Work five more years',
        detail: `Retire at ${form.retirementAge + 5}. Also shortens the bridge to super.`,
        change: { retirementAge: form.retirementAge + 5 },
      },
      {
        label: 'Spend $5,000 less a year',
        detail: `${money(form.retirementSpending - 5000)} instead of ${money(form.retirementSpending)}`,
        change: { retirementSpending: Math.max(0, form.retirementSpending - 5000) },
      },
      {
        label: 'Spend $10,000 less a year',
        detail: `${money(form.retirementSpending - 10000)} a year in retirement`,
        change: { retirementSpending: Math.max(0, form.retirementSpending - 10000) },
      },
      {
        label: 'Save $10,000 more a year',
        detail: 'Outside super, while still working',
        change: { annualSavings: form.annualSavings + 10000 },
      },
      {
        label: 'Salary sacrifice $10,000 a year',
        detail: 'Into super — taxed at 15% going in, not your marginal rate',
        change: { voluntarySuperContribution: form.voluntarySuperContribution + 10000 },
      },
      {
        label: 'Part-time work for 5 years',
        detail: '$30,000 a year from the day you stop full-time work',
        change: { partTimeIncome: 30000, partTimeYears: 5 },
      },
      {
        label: 'Hold a 3-year cash buffer',
        detail: 'Spend from cash and refill in good years — the sequence-risk defence',
        change: { drawdownStrategy: 'cashBuffer', cashBufferYears: 3 },
      },
      {
        label: 'Draw super first after 60',
        detail: 'Leaves outside-super assets, which are taxable, intact for longer',
        change: { drawdownStrategy: 'superFirst' },
      },
      {
        label: 'Glide to defensive with age',
        detail: 'Balanced from 55, Conservative from 65 — narrows the bad tail',
        change: { glidePath: true },
      },
    ];
    const downsizerAge = ruleset.super.downsizerContribution.minimumAge.value;
    const downsizerCap = ruleset.super.downsizerContribution.capPerPerson.value;
    if (!form.downsize && form.primaryResidence > 0) {
      // A plausible move rather than a prescription: a home two thirds the value.
      const replacement = Math.round((form.primaryResidence * 2) / 3 / 10_000) * 10_000;
      // Two timings, because they trade off against each other and the model can settle
      // it: downsizing at retirement frees the equity when the bridge needs it, but
      // before 55 it forfeits the downsizer contribution entirely.
      if (form.retirementAge < downsizerAge) {
        candidates.push({
          label: `Downsize at ${form.retirementAge}, when you stop work`,
          detail: `Move to a ${money(replacement)} home. Frees the equity exactly when the bridge needs it${
            form.retirementAge < downsizerAge
              ? `, but forfeits the downsizer contribution — that needs age ${downsizerAge}`
              : ''
          }`,
          change: {
            downsize: true,
            downsizeAge: form.retirementAge,
            downsizeNewHomeValue: replacement,
          },
        });
      }
      candidates.push({
        label: `Downsize at ${downsizerAge}`,
        detail: `Move to a ${money(replacement)} home. Old enough for the downsizer contribution — up to ${money(downsizerCap)} into super`,
        change: { downsize: true, downsizeAge: downsizerAge, downsizeNewHomeValue: replacement },
      });
    }
    if (form.downsize && form.downsizeAge > form.retirementAge) {
      // Equity released after the money has already run out is no help at all. Moving the
      // move earlier trades the downsizer contribution for liquidity when it is needed.
      candidates.push({
        label: `Downsize at ${form.retirementAge} instead of ${form.downsizeAge}`,
        detail:
          form.retirementAge < downsizerAge
            ? `Frees the equity when you stop work rather than ${form.downsizeAge - form.retirementAge} years later, though before ${downsizerAge} it forfeits the downsizer contribution`
            : 'Frees the equity when you stop work rather than later',
        change: { downsizeAge: form.retirementAge },
      });
    }
    if (form.downsize && form.downsizeAge < downsizerAge) {
      candidates.push({
        label: `Downsize at ${downsizerAge} instead`,
        detail: `Unlocks the downsizer contribution — up to ${money(downsizerCap)} into super, which you forfeit downsizing at ${form.downsizeAge}`,
        change: { downsizeAge: downsizerAge },
      });
    }
    const compared = compareScenarios(
      toScenario(form, phi),
      candidates.map((c) => ({
        label: c.label,
        scenario: toScenario({ ...form, ...c.change }, phi),
      })),
      ruleset,
      { lifeTables, healthCostCurve },
    );
    return candidates
      .map((c, i) => ({ ...c, outcome: compared.outcomes[i] }))
      .sort((a, b) => {
        // Anything that removes the failure outright ranks above anything that only
        // delays it; among those, more left at the end means more margin. Note this
        // ranks by OUTCOME, not by how much the change costs you - see the caveat below.
        const fixed = (o: (typeof compared.outcomes)[number]) => (o.runsOutAge === null ? 1 : 0);
        if (fixed(a.outcome) !== fixed(b.outcome)) return fixed(b.outcome) - fixed(a.outcome);
        if (fixed(a.outcome) === 1) return b.outcome.estateReal - a.outcome.estateReal;
        return (b.outcome.deltaYears ?? 0) - (a.outcome.deltaYears ?? 0);
      });
  }, [form, ruleset, lifeTables, healthCostCurve]);

  // Everything the model takes from published sources rather than from the user. Shown
  // read-only so it is obvious which numbers are facts and which are the user's.
  const ap = ruleset.agePension;
  const fy = ap.fortnightsPerYear.value;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const sourcedFacts = [
    { label: 'Super guarantee', value: pct(ruleset.super.guaranteeRate.value), source: 'ATO' },
    {
      label: 'Concessional cap',
      value: money(ruleset.super.concessionalCap.value),
      source: 'ATO',
    },
    {
      label: 'Transfer balance cap',
      value: money(ruleset.super.generalTransferBalanceCap.value),
      source: 'ATO',
    },
    {
      label: 'Super contributions tax',
      value: pct(ruleset.super.contributionsTaxConcessional.value),
      source: 'ATO',
    },
    {
      label: 'Super earnings tax (accumulation)',
      value: pct(ruleset.super.earningsTaxAccumulation.value),
      source: 'ATO — nil in pension phase',
    },
    {
      label: 'Preservation age',
      value: '60',
      source: 'ATO — for anyone born from 1 July 1964',
    },
    {
      label: 'Downsizer contribution',
      value: `${money(ruleset.super.downsizerContribution.capPerPerson.value)} from age ${ruleset.super.downsizerContribution.minimumAge.value}`,
      source: 'ATO',
    },
    { label: 'Medicare levy', value: pct(ruleset.incomeTax.medicareLevyRate.value), source: 'ATO' },
    {
      label: 'CGT discount',
      value: pct(ruleset.capitalGains.discountRate.value),
      source: 'ATO — assets held over 12 months',
    },
    { label: 'Age Pension age', value: String(ap.eligibilityAge.value), source: 'Services Australia' },
    {
      label: 'Age Pension (single, max)',
      value: `${money(ap.maxRateFortnight.value.single.total * fy)}/yr`,
      source: `Services Australia — rates from ${ap.rateEffectiveDate.value}`,
    },
    {
      label: 'Age Pension (couple, max)',
      value: `${money(ap.maxRateFortnight.value.coupleCombined.total * fy)}/yr`,
      source: 'Services Australia — combined',
    },
    {
      label: 'Assets test free area (single, homeowner)',
      value: money(ap.assetsTest.value.fullPensionLimit.singleHomeowner),
      source: 'Services Australia',
    },
    {
      label: 'Deeming rates',
      value: `${pct(ap.deeming.value.lowerRate)} / ${pct(ap.deeming.value.upperRate)}`,
      source: `Services Australia — above ${money(ap.deeming.value.threshold.single)} for a single`,
    },
    {
      label: 'Work Bonus',
      value: `${money(ap.workBonus.value.creditPerFortnight)}/fortnight`,
      source: 'Services Australia',
    },
    {
      label: 'Aged care basic daily fee',
      value: `${money(ruleset.agedCare.basicDailyFeePerDay.value * 365)}/yr`,
      source: 'My Aged Care — 85% of the basic Age Pension',
    },
    {
      label: 'Health insurance premium growth',
      value: pct(ruleset.privateHealthInsurance.premiumGrowthRate.value),
      source: 'Dept of Health — 10-year industry average',
    },
    {
      label: 'Health cost curve',
      value: `${healthCostCurve.bands.length} age bands`,
      source: 'AIHW spending over ABS population',
    },
    {
      label: 'Life tables',
      value: `${lifeTables.tables.female.length} ages, by sex`,
      source: 'Australian Government Actuary 2020–22',
    },
  ];

  const scenario = toScenario(form, {
    phiInflation: ruleset.privateHealthInsurance.premiumGrowthRate.value,
  });
  const ds = { lifeTables, healthCostCurve };
  const conf = confidence / 100;

  const download = () => {
    const blob = new Blob([toCsv(r, real)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projection-${real ? 'real' : 'nominal'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className="mx-auto max-w-[1400px] p-6 text-slate-900">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Retirement model</h1>
        <p className="text-sm text-slate-600">
          Australian tax, super, Age Pension, health and longevity — with simulation. Rules:{' '}
          {r.ruleset}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What the colours mean
            </div>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-slate-300 bg-white" />
                Your own figures — edit freely
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-amber-300 bg-amber-50" />
                Assumptions — editable, but a modelling choice, not a fact
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-sky-300 bg-sky-50" />
                Public data — sourced, so not editable
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-indigo-300 bg-indigo-50" />
                Calculated by the model
              </li>
            </ul>
          </div>

          <details className="rounded-lg border border-sky-300 bg-sky-50 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Public data used ({sourcedFacts.length} figures)
            </summary>
            <p className="mt-1 text-xs text-slate-600">
              Fetched from the source named against each, on {ruleset.retrievedAt}. These are
              not inputs — change them by updating the ruleset, not the form.
            </p>
            <dl className="mt-2 space-y-2">
              {sourcedFacts.map((fact) => (
                <div key={fact.label} className="text-xs">
                  <dt className="flex justify-between gap-2">
                    <span className="text-slate-700">{fact.label}</span>
                    <span className="font-medium tabular-nums">{fact.value}</span>
                  </dt>
                  <dd className="text-[11px] text-slate-500">{fact.source}</dd>
                </div>
              ))}
            </dl>
          </details>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="font-medium">Your details</div>
            <p className="mt-1 text-xs text-slate-600">
              {usingSaved
                ? 'Saved in this browser only. Nothing is sent anywhere — there is no server to send it to.'
                : 'These are illustrative example figures. Edit anything and it becomes yours, saved in this browser only.'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={exportInputs}
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
              >
                Export
              </button>
              <label className="cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                Import
                <input type="file" accept="application/json" className="hidden" onChange={importInputs} />
              </label>
              <button
                onClick={resetInputs}
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
              >
                Reset to example
              </button>
            </div>
            {importError && <p className="mt-2 text-xs text-red-700">{importError}</p>}
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <input
              type="checkbox"
              checked={form.hasPartner}
              onChange={(e) => {
                setForm((f) => ({ ...f, hasPartner: e.target.checked }));
                clearResults();
              }}
            />
            <span className="font-medium">Model a partner</span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <input
              type="checkbox"
              checked={form.downsize}
              onChange={(e) => {
                setForm((f) => ({ ...f, downsize: e.target.checked }));
                clearResults();
              }}
            />
            <span className="font-medium">Downsize the home</span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <input
              type="checkbox"
              checked={form.agedCareEnabled}
              onChange={(e) => {
                setForm((f) => ({ ...f, agedCareEnabled: e.target.checked }));
                clearResults();
              }}
            />
            <span className="font-medium">Aged care stress test</span>
          </label>
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
                    setMc(null);
                    setSpendSolve(null);
                    setAgeSolve(null);
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
                setMc(null);
                setSpendSolve(null);
                setAgeSolve(null);
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
              Sex (life tables)
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
          {GROUPS.filter(
            (g) =>
              (!g.partnerOnly || form.hasPartner) &&
              (!g.agedCareOnly || form.agedCareEnabled) &&
              (!g.downsizeOnly || form.downsize),
          ).map((g) => (
            <fieldset key={g.title} className="rounded-lg border border-slate-200 bg-white p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.title}
              </legend>
              <div className="space-y-2">
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
          ))}
        </aside>

        <section className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card
              label="Own money runs out at"
              value={r.moneyRunsOutAge === null ? 'Never' : `Age ${r.moneyRunsOutAge}`}
              tone={r.moneyRunsOutAge === null ? 'good' : 'bad'}
              note={
                r.moneyRunsOutYear
                  ? `in ${r.moneyRunsOutYear} — the Age Pension continues`
                  : `lasts to age ${form.planToAge}`
              }
            />
            <Card
              label="Then living on"
              value={depleted ? `${money(depleted.agePension)}/yr` : '—'}
              tone={depleted ? 'bad' : 'neutral'}
              note={
                depleted
                  ? `Age Pension only — ${Math.round((depleted.agePension / depleted.spending.total) * 100)}% of your ${money(depleted.spending.total)} target`
                  : 'your own assets cover the whole plan'
              }
            />
            <Card
              label="Bridge to super access"
              value={bridge ? `${bridge.years} years` : 'None'}
              tone={bridge && bridge.shortfall > 0 ? 'bad' : 'neutral'}
              note={
                bridge
                  ? `age ${bridge.startAge} → ${bridge.endAge}, unfunded ${money(bridge.shortfall)}` +
                    (partnerBridge
                      ? `; partner ${partnerBridge.startAge} → ${partnerBridge.endAge}`
                      : '')
                  : 'super is accessible at retirement'
              }
            />
            <Card
              label={`Accessible at ${form.retirementAge}`}
              value={money(at(form.retirementAge)?.balances.accessible ?? 0)}
              tone="neutral"
              note={real ? "today's dollars" : 'future dollars'}
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Balances over time</h2>
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setReal(!real)}
                  className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                >
                  {real ? "Today's dollars" : 'Future dollars'}
                </button>
                <button onClick={download} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                  Export CSV
                </button>
              </div>
            </div>
            <BalanceChart rows={rows} personId={PRIMARY_ID} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-semibold">What you spend, and on what</h2>
              <span className="text-xs text-slate-500">
                {real ? "today's dollars" : 'future dollars'}
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-600">
              Baseline spending steps down through the go-go, slow-go and no-go phases while
              health costs climb with age. The green line is the Age Pension.
            </p>
            <HealthChart rows={rows} personId={PRIMARY_ID} />
          </div>

          {r.longevity.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold">Longevity (Australian Life Tables 2020–22)</h2>
              <ul className="space-y-1 text-slate-700">
                {r.longevity.map((l) => (
                  <li key={l.personId}>
                    <span className="font-medium">
                      {l.personId === PRIMARY_ID ? 'You' : 'Partner'}
                    </span>{' '}
                    — life expectancy {l.lifeExpectancyAge}, but 10% reach{' '}
                    <span className="font-medium">{l.ninetiethPercentileAge}</span>. Chance of
                    still being alive at {form.planToAge}:{' '}
                    <span className="font-medium">{Math.round(l.survivalToPlanEnd * 100)}%</span>.
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Period tables: they hold today&apos;s mortality fixed and ignore future
                improvement, so they understate lifespan — the direction that makes money look
                like it lasts.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-indigo-200 bg-white p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-semibold">What would move the needle</h2>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                calculated
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-600">
              Each row re-runs the whole projection with one change, against your current plan
              {r.moneyRunsOutAge === null
                ? ', which already lasts the full plan.'
                : `, which runs out at ${r.moneyRunsOutAge}.`}{' '}
              Best first. Apply takes the change into your inputs.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Change</th>
                    <th className="px-2 py-1 text-right font-medium">Money lasts to</th>
                    <th className="px-2 py-1 text-right font-medium">Difference</th>
                    <th className="px-2 py-1 text-right font-medium">Left at {form.planToAge}</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {levers.map((l) => {
                    const o = l.outcome;
                    const better = o.fixesIt || (o.deltaYears ?? 0) > 0;
                    return (
                      <tr key={l.label} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-800">{l.label}</div>
                          <div className="text-xs text-slate-600">{l.detail}</div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {o.runsOutAge === null ? (
                            <span className="font-medium text-emerald-700">never runs out</span>
                          ) : (
                            `age ${o.runsOutAge}`
                          )}
                        </td>
                        <td
                          className={`px-2 py-2 text-right font-medium tabular-nums ${
                            better ? 'text-emerald-700' : (o.deltaYears ?? 0) < 0 ? 'text-red-700' : 'text-slate-400'
                          }`}
                        >
                          {o.fixesIt
                            ? 'fixes it'
                            : o.deltaYears === null
                              ? '—'
                              : o.deltaYears > 0
                                ? `+${o.deltaYears} yrs`
                                : o.deltaYears === 0
                                  ? 'no change'
                                  : `${o.deltaYears} yrs`}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                          {money(o.estateReal)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={() => {
                              setForm((f) => ({ ...f, ...l.change }));
                              clearResults();
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            Apply
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Ranked by outcome, not by what the change costs you — working five more years
              and spending $10,000 less are not equivalent sacrifices, and only you can weigh
              them. These are also single deterministic paths, so they compare like with like
              but say nothing about risk; run the simulations below for that.
            </p>
          </div>

          <div className="rounded-lg border border-indigo-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">How confident can you be?</h2>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                calculated
              </span>
              <label className="flex items-center gap-1 text-sm">
                Target confidence
                <input
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                  value={confidence}
                  onChange={(e) => {
                    setConfidence(Number(e.target.value.replace(/[^0-9]/g, '')) || 0);
                    setSpendSolve(null);
                    setAgeSolve(null);
                  }}
                />
                %
              </label>
              <button
                disabled={busy !== null}
                onClick={() =>
                  run('simulating', () =>
                    setMc(monteCarlo(scenario, ruleset, ds, { runs: 5000, seed: 42 })),
                  )
                }
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Run 5,000 simulations
              </button>
              <button
                disabled={busy !== null}
                onClick={() =>
                  run('solving spend', () =>
                    setSpendSolve(
                      maxSustainableSpend(scenario, ruleset, ds, {
                        confidence: conf,
                        searchRuns: 600,
                        runs: 2000,
                        seed: 42,
                      }),
                    ),
                  )
                }
                className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Max sustainable spend
              </button>
              <button
                disabled={busy !== null}
                onClick={() =>
                  run('solving age', () =>
                    setAgeSolve(
                      earliestRetirementAge(scenario, ruleset, ds, {
                        confidence: conf,
                        searchRuns: 600,
                        runs: 2000,
                        seed: 42,
                      }),
                    ),
                  )
                }
                className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Earliest retirement age
              </button>
              {busy ? (
                <span className="text-sm text-slate-600">{busy}… the page will pause</span>
              ) : (
                <span className="text-xs text-slate-500">
                  Runs in this browser — takes a few seconds and pauses the page while it works.
                </span>
              )}
            </div>

            {(spendSolve || ageSolve) && (
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                {spendSolve && (
                  <SolveCard
                    label={`Most you can spend at ${confidence}% confidence`}
                    value={spendSolve.value === null ? 'No amount works' : `${money(spendSolve.value)}/yr`}
                    result={spendSolve}
                  />
                )}
                {ageSolve && (
                  <SolveCard
                    label={`Earliest you can retire at ${confidence}% confidence`}
                    value={ageSolve.value === null ? 'Not within the plan' : `Age ${ageSolve.value}`}
                    result={ageSolve}
                  />
                )}
              </div>
            )}

            {mc ? (
              <>
                <div className="mb-3 flex items-baseline gap-3">
                  <span className="text-3xl font-semibold">
                    {(mc.successProbability * 100).toFixed(0)}%
                  </span>
                  <span className="text-sm text-slate-600">
                    of {mc.runs.toLocaleString()} simulated futures never ran out
                    {mc.medianFailureAge !== null && (
                      <> — the ones that did ran out at a median age of {mc.medianFailureAge}</>
                    )}
                    . ({(mc.elapsedMs / 1000).toFixed(1)}s)
                  </span>
                </div>
                <FanChart fan={mc.fan} />
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                  {mc.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                The projection above is a single path. Run the simulations to see the spread of
                outcomes and a probability of success.
              </p>
            )}
          </div>

          <Panel title="Not modelled yet — these numbers are incomplete" tone="warn" items={r.notModelled} />
          {r.warnings.length > 0 && <Panel title="Assumptions and flags" tone="info" items={r.warnings} />}

          <div className="rounded-lg border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 p-3 font-semibold">
              Projection ({real ? "today's dollars" : 'future dollars'})
            </h2>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-right text-sm tabular-nums">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    {[
                      'Year',
                      form.hasPartner ? 'Ages' : 'Age',
                      'Salary',
                      'Age Pension',
                      'Tax',
                      'Spend',
                      'Drawdown',
                      'Cash',
                      'Investments',
                      'Super (accum)',
                      'Super (pension)',
                      'Home',
                      'Accessible',
                      'Short',
                    ].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.planYear}
                      className={`border-t border-slate-100 ${row.shortfall > 0 ? 'bg-red-50' : ''} ${
                        form.hasPartner && !row.alive.includes(PARTNER_ID) ? 'text-slate-500' : ''
                      }`}
                      title={row.events.join(' ')}
                    >
                      <td className="px-2 py-1 text-left">{row.calendarYear}</td>
                      <td className="px-2 py-1">
                        {row.ages[PRIMARY_ID]}
                        {form.hasPartner && (
                          <span className="text-slate-400">/{row.ages[PARTNER_ID]}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">{money(row.income.salary)}</td>
                      <td
                        className="px-2 py-1 text-emerald-700"
                        title={
                          row.agePension > 0
                            ? `Cut back by the ${row.agePensionDetail.bindingTest} test. Deemed income ${money(row.agePensionDetail.deemedIncome)} against a full rate of ${money(row.agePensionDetail.maxRate)}.`
                            : 'No entitlement this year'
                        }
                      >
                        {money(row.agePension)}
                      </td>
                      <td
                        className="px-2 py-1"
                        title={`Personal ${money(row.tax.personal)}, super earnings ${money(row.tax.superEarnings)}, contributions ${money(row.tax.superContributions)}`}
                      >
                        {money(row.tax.total)}
                      </td>
                      <td className="px-2 py-1">{money(row.spending.total)}</td>
                      <td className="px-2 py-1">{money(row.drawdown.total)}</td>
                      <td className="px-2 py-1">{money(row.balances.cash)}</td>
                      <td className="px-2 py-1">{money(row.balances.investments)}</td>
                      <td className="px-2 py-1">{money(row.balances.superAccumulation)}</td>
                      <td className="px-2 py-1">{money(row.balances.superPension)}</td>
                      <td className="px-2 py-1 text-slate-400">{money(row.balances.primaryResidence)}</td>
                      <td className="px-2 py-1 font-medium">{money(row.balances.accessible)}</td>
                      <td className="px-2 py-1 text-red-700">{row.shortfall > 0 ? money(row.shortfall) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="pb-8 text-xs text-slate-500">
            General information only, not personal financial advice. Super guarantee {pct(ruleset.super.guaranteeRate.value)},
            concessional cap {money(ruleset.super.concessionalCap.value)} and preservation age come from{' '}
            <a className="underline" href={ruleset.super.guaranteeRate.url ?? '#'}>
              the ATO
            </a>
            , effective {ruleset.effectiveDate}, retrieved {ruleset.retrievedAt}.
          </p>
        </section>
      </div>
    </main>
  );
}

function SolveCard({
  label,
  value,
  result,
}: {
  label: string;
  value: string;
  result: GoalSeekResult<number>;
}) {
  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-slate-600">
        measured at {(result.achievedProbability * 100).toFixed(1)}% over{' '}
        {result.verifyRuns.toLocaleString()} runs ({(result.elapsedMs / 1000).toFixed(1)}s)
      </div>
      {result.notes.map((n) => (
        <p key={n} className="mt-1 text-xs text-amber-800">
          {n}
        </p>
      ))}
    </div>
  );
}

function Card({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'good' | 'bad' | 'neutral' }) {
  const ring =
    tone === 'bad'
      ? 'border-red-300 bg-red-50'
      : tone === 'good'
        ? 'border-emerald-300 bg-emerald-50'
        : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-lg border p-4 ${ring}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-slate-600">{note}</div>
    </div>
  );
}

function Panel({ title, items, tone }: { title: string; items: string[]; tone: 'warn' | 'info' }) {
  const c = tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-sky-300 bg-sky-50';
  return (
    <details open className={`rounded-lg border p-4 ${c}`}>
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </details>
  );
}
