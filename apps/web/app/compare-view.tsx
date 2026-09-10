'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  earliestRetirementAgeDeterministic,
  monteCarlo,
  project,
  toRealRow,
  type HealthCostCurve,
  type LifeTables,
  type MonteCarloResult,
  type ProjectionResult,
  type Ruleset,
} from '@retirement/engine';
import { defaults, loadSaved, toScenario, type FormInputs } from './inputs';
import { InputsPanel } from './inputs-panel';
import { afterPaint } from './after-paint';
import { money } from './format';

interface Side {
  name: string;
  form: FormInputs;
}

const MAX_SIDES = 4;
const MIN_SIDES = 2;

/**
 * Grid classes per scenario count.
 *
 * Written out rather than built from a template, because Tailwind scans the source for
 * class names and would not find one assembled at runtime.
 */
/**
 * Total simulated paths across all scenarios, split between them.
 *
 * Fixed as a total rather than per scenario, so adding a fourth plan does not double the
 * wait. Fewer runs each is a fair trade here: every scenario is driven by the SAME seed,
 * so they face identical sampled futures and the comparison between them is far more
 * precise than the absolute probabilities are. Use the front page for a 5,000-path
 * reading of a single plan.
 */
const TOTAL_RUNS = 3000;
const runsPerScenario = (n: number) => Math.max(500, Math.floor(TOTAL_RUNS / n));

const SUMMARY_GRID: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'md:grid-cols-2 xl:grid-cols-4',
};

/** Human labels for the fields worth diffing. Anything absent is not shown. */
const FIELD_LABELS: Partial<Record<keyof FormInputs, string>> = {
  currentAge: 'Age now',
  retirementAge: 'Stop work at',
  planToAge: 'Plan to age',
  netMonthlyPay: 'Salary in your account / month',
  employerSuperMonthly: 'Employer super / month',
  personalSuperMonthly: 'Super you put in / month',
  wageGrowth: 'Wage growth',
  annualSavings: 'Saved each year',
  cash: 'Cash',
  investments: 'Investments',
  superBalance: 'Super',
  primaryResidence: 'Home value',
  retirementSpending: 'Spending in retirement',
  hasMortgage: 'Mortgage',
  mortgageBalance: 'Amount owing',
  mortgageRate: 'Loan rate',
  mortgageYears: 'Years remaining',
  offsetBalance: 'Offset balance',
  downsize: 'Downsize',
  downsizeAge: 'Downsize at',
  downsizeNewHomeValue: 'Replacement home',
  partTimeIncome: 'Part-time income',
  partTimeYears: 'Part-time years',
  hasPartner: 'Partner',
  partnerCurrentAge: "Partner's age now",
  partnerRetirementAge: 'Partner stops work at',
  partnerNetMonthlyPay: "Partner's salary / month",
  partnerEmployerSuperMonthly: "Partner's employer super / month",
  partnerPersonalSuperMonthly: "Partner puts in / month",
  partnerSuperBalance: 'Partner super',
  agedCareEnabled: 'Aged care stress test',
  drawdownStrategy: 'Drawdown',
  glidePath: 'Glide path',
  cpi: 'Inflation',
  returnInvestments: 'Return — investments',
  returnSuper: 'Return — super',
  indexTaxBrackets: 'Index tax brackets',
};

const PERCENT_FIELDS = new Set<keyof FormInputs>([
  'wageGrowth',
  'mortgageRate',
  'cpi',
  'returnInvestments',
  'returnSuper',
]);
const MONEY_FIELDS = new Set<keyof FormInputs>([
  'netMonthlyPay',
  'employerSuperMonthly',
  'personalSuperMonthly',
  'salary',
  'partnerNetMonthlyPay',
  'partnerEmployerSuperMonthly',
  'partnerPersonalSuperMonthly',
  'annualSavings',
  'voluntarySuperContribution',
  'cash',
  'investments',
  'superBalance',
  'primaryResidence',
  'retirementSpending',
  'mortgageBalance',
  'offsetBalance',
  'downsizeNewHomeValue',
  'partTimeIncome',
  'partnerSalary',
  'partnerSuperBalance',
]);

function show(key: keyof FormInputs, v: FormInputs[keyof FormInputs]): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (PERCENT_FIELDS.has(key)) return `${(v * 100).toFixed(2)}%`;
    if (MONEY_FIELDS.has(key)) return money(v);
    return String(v);
  }
  return String(v);
}

export default function CompareView({
  ruleset,
  lifeTables,
  healthCostCurve,
}: {
  ruleset: Ruleset;
  lifeTables: LifeTables;
  healthCostCurve: HealthCostCurve;
}) {
  // Every scenario starts as a copy of your saved plan, so the first thing you see is
  // identical columns and every difference after that is one you made.
  const [sides, setSides] = useState<Side[]>([
    { name: 'Your plan', form: defaults },
    { name: 'Alternative', form: defaults },
  ]);
  const [mc, setMc] = useState<Array<MonteCarloResult | null>>([null, null]);
  const [busy, setBusy] = useState(false);
  /** Which scenario the input form below is editing. Four forms side by side would not fit. */
  const [editing, setEditing] = useState(0);

  useEffect(() => {
    const saved = loadSaved(ruleset);
    if (saved) {
      setSides([
        { name: 'Your plan', form: saved },
        { name: 'Alternative', form: saved },
      ]);
    }
    // The ruleset is fixed for the life of the page (a server component reads it once),
    // and this must run on mount only - re-running it would overwrite whatever has been
    // typed since with the stored copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ds = useMemo(() => ({ lifeTables, healthCostCurve }), [lifeTables, healthCostCurve]);
  const phi = ruleset.privateHealthInsurance.premiumGrowthRate.value;

  const results = useMemo(
    () =>
      sides.map((side) => {
        try {
          const scenario = toScenario(side.form, { phiInflation: phi });
          return {
            ok: true as const,
            projection: project(scenario, ruleset, ds),
            retire: earliestRetirementAgeDeterministic(scenario, ruleset, ds),
          };
        } catch (e) {
          return { ok: false as const, error: (e as Error).message };
        }
      }),
    [sides, ruleset, ds, phi],
  );

  // Only the fields that actually differ, so four columns stay readable.
  const differences = useMemo(
    () =>
      (Object.keys(FIELD_LABELS) as Array<keyof FormInputs>)
        .filter((k) => sides.some((s2) => s2.form[k] !== sides[0].form[k]))
        .map((k) => ({
          key: k,
          label: FIELD_LABELS[k]!,
          values: sides.map((s2) => show(k, s2.form[k])),
        })),
    [sides],
  );

  const setSide = (i: number, update: (f: FormInputs) => FormInputs) =>
    setSides((prev) => prev.map((s2, j) => (j === i ? { ...s2, form: update(s2.form) } : s2)));

  const rename = (i: number, name: string) =>
    setSides((prev) => prev.map((s2, j) => (j === i ? { ...s2, name } : s2)));

  const clearRuns = () => setMc(sides.map(() => null));

  const addSide = () => {
    if (sides.length >= MAX_SIDES) return;
    setSides((prev) => [
      ...prev,
      { name: `Alternative ${prev.length}`, form: prev[prev.length - 1].form },
    ]);
    setMc((prev) => [...prev, null]);
  };

  const removeSide = (i: number) => {
    if (sides.length <= MIN_SIDES) return;
    setSides((prev) => prev.filter((_, j) => j !== i));
    setMc((prev) => prev.filter((_, j) => j !== i));
    setEditing((e) => (e >= i && e > 0 ? e - 1 : e));
  };

  const duplicateSide = (i: number) => {
    if (sides.length >= MAX_SIDES) return;
    setSides((prev) => [
      ...prev.slice(0, i + 1),
      { name: `${prev[i].name} copy`, form: prev[i].form },
      ...prev.slice(i + 1),
    ]);
    setMc((prev) => [...prev.slice(0, i + 1), null, ...prev.slice(i + 1)]);
  };

  const runAll = () => {
    setBusy(true);
    // Let the "running" message paint before the main thread locks up.
    afterPaint(() => {
      try {
        setMc(
          sides.map((side) =>
            // The same seed for every scenario, so each faces identical sampled futures
            // and any gap between the columns is the plan, not the luck of the draw.
            monteCarlo(toScenario(side.form, { phiInflation: phi }), ruleset, ds, {
              runs: runsPerScenario(sides.length),
              seed: 42,
            }),
          ),
        );
      } finally {
        setBusy(false);
      }
    });
  };

  const summary = (r: (typeof results)[number], i: number) => {
    if (!r.ok) return <p className="text-sm text-red-700">{r.error}</p>;
    const p: ProjectionResult = r.projection;
    const last = p.rows.at(-1);
    const liquid = last ? toRealRow(last).balances.total - toRealRow(last).balances.primaryResidence : 0;
    const rows: Array<[string, string]> = [
      [
        'Could retire at',
        r.retire.age === null
          ? 'no age works'
          : r.retire.people.map((x) => `${x.name} ${x.age}`).join(', '),
      ],
      ['Money lasts to', p.moneyRunsOutAge === null ? 'never runs out' : `age ${p.moneyRunsOutAge}`],
      ['Savings left at the end', money(liquid)],
      [
        'Bridge to super',
        p.bridge.length === 0 ? 'none' : `${p.bridge[0].years} years`,
      ],
      ['Loan cleared', p.mortgagePaidOffAge === null ? '—' : `age ${p.mortgagePaidOffAge}`],
      ['Interest paid', p.totalMortgageInterest > 0 ? money(p.totalMortgageInterest) : '—'],
      [
        'Success probability',
        mc[i] ? `${(mc[i]!.successProbability * 100).toFixed(0)}%` : 'not run',
      ],
    ];
    return (
      <dl className="space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1">
            <dt className="text-slate-600">{k}</dt>
            <dd className="text-right font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <main className="mx-auto max-w-[1400px] p-6 text-slate-900">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">
          Compare {['', 'one plan', 'two plans', 'three plans', 'four plans'][sides.length] ?? `${sides.length} plans`}
        </h1>
        <p className="text-sm text-slate-600">
          Both start from your saved plan. Change either side and the outcomes update.
        </p>
      </header>

      <nav className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
        <Link href="/" className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-50">
          When can you retire?
        </Link>
        <Link href="/detail" className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-50">
          The detail
        </Link>
        <span className="rounded bg-slate-900 px-3 py-1.5 text-white">Compare</span>
      </nav>

      <div className={`mb-4 grid gap-4 ${SUMMARY_GRID[sides.length] ?? 'lg:grid-cols-2'}`}>
        {sides.map((side, i) => (
          <div key={i} className="rounded-lg border border-indigo-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-1">
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-semibold"
                value={side.name}
                onChange={(e) => rename(i, e.target.value)}
              />
              <button
                title="Duplicate this scenario"
                disabled={sides.length >= MAX_SIDES}
                onClick={() => duplicateSide(i)}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              >
                Copy
              </button>
              <button
                title="Remove this scenario"
                disabled={sides.length <= MIN_SIDES}
                onClick={() => removeSide(i)}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              >
                ✕
              </button>
            </div>
            {summary(results[i], i)}
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <button
          disabled={busy}
          onClick={runAll}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Run {runsPerScenario(sides.length).toLocaleString()} simulations on each
        </button>
        <button
          disabled={sides.length >= MAX_SIDES}
          onClick={addSide}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
        >
          Add a scenario
        </button>
        <button
          onClick={() => {
            setSides((prev) => prev.map((s2, j) => (j === 0 ? s2 : { ...s2, form: prev[0].form })));
            clearRuns();
          }}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Reset all to match {sides[0].name}
        </button>
        {busy ? (
          <span className="flex items-center gap-2 rounded bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-700 border-t-transparent" />
            Running {(runsPerScenario(sides.length) * sides.length).toLocaleString()}{' '}
            simulations across {sides.length} scenarios… this takes several seconds and the
            page will not respond until it finishes.
          </span>
        ) : (
          <span className="text-xs text-slate-500">
            {runsPerScenario(sides.length).toLocaleString()} paths each, every scenario facing
            the same sampled futures — so a difference between them is the plan, not luck.
          </span>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">What is different</h2>
        {differences.length === 0 ? (
          <p className="text-sm text-slate-600">
            {sides.length === 2 ? 'The two plans are identical.' : 'All the plans are identical.'}{' '}
            Change something below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Input</th>
                  {sides.map((side, i) => (
                    <th key={i} className="px-2 py-1 text-right font-medium">
                      {side.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {differences.map((d) => (
                  <tr key={String(d.key)} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-700">{d.label}</td>
                    {d.values.map((v, i) => (
                      <td
                        key={i}
                        className={`px-2 py-1 text-right tabular-nums ${
                          // Anything that differs from the first column is the change
                          // being tested, so it is the thing worth the reader's eye.
                          i > 0 && v !== d.values[0]
                            ? 'font-medium text-indigo-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Editing</span>
          {/* One form at a time: four full input panels side by side would not fit on
              any realistic screen, and the comparison above is what needs to be side by
              side, not the editing. */}
          {sides.map((side, i) => (
            <button
              key={i}
              onClick={() => setEditing(i)}
              className={`rounded px-3 py-1.5 text-sm ${
                editing === i
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {side.name}
            </button>
          ))}
        </div>
        <div className="space-y-5">
          <InputsPanel
            key={editing}
            form={sides[editing].form}
            setForm={(update) => setSide(editing, update)}
            onChange={clearRuns}
            ruleset={ruleset}
          />
        </div>
      </div>

      <p className="pb-8 pt-6 text-xs text-slate-500">
        General information only, not personal financial advice. Editing here does not change
        your saved plan.
      </p>
    </main>
  );
}
