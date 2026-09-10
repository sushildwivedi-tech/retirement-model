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
import { money } from './format';

interface Side {
  name: string;
  form: FormInputs;
}

/** Human labels for the fields worth diffing. Anything absent is not shown. */
const FIELD_LABELS: Partial<Record<keyof FormInputs, string>> = {
  currentAge: 'Age now',
  retirementAge: 'Stop work at',
  planToAge: 'Plan to age',
  salary: 'Salary',
  wageGrowth: 'Wage growth',
  annualSavings: 'Saved each year',
  voluntarySuperContribution: 'Extra super',
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
  partnerCurrentAge: 'Partner age now',
  partnerRetirementAge: 'Partner stops at',
  partnerSalary: 'Partner salary',
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
  'salary',
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
  // A starts from your saved plan; B starts as a copy of it, so the first thing you see
  // is two identical columns and every difference after that is one you made.
  const [sides, setSides] = useState<[Side, Side]>([
    { name: 'Your plan', form: defaults },
    { name: 'Alternative', form: defaults },
  ]);
  const [mc, setMc] = useState<[MonteCarloResult | null, MonteCarloResult | null]>([null, null]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setSides([
        { name: 'Your plan', form: saved },
        { name: 'Alternative', form: saved },
      ]);
    }
  }, []);

  const ds = useMemo(() => ({ lifeTables, healthCostCurve }), [lifeTables, healthCostCurve]);
  const phi = ruleset.privateHealthInsurance.premiumGrowthRate.value;

  const results = useMemo(
    () =>
      sides.map((s) => {
        try {
          const scenario = toScenario(s.form, { phiInflation: phi });
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

  const differences = useMemo(() => {
    const [a, b] = sides;
    return (Object.keys(FIELD_LABELS) as Array<keyof FormInputs>)
      .filter((k) => a.form[k] !== b.form[k])
      .map((k) => ({ key: k, label: FIELD_LABELS[k]!, a: show(k, a.form[k]), b: show(k, b.form[k]) }));
  }, [sides]);

  const setSide = (i: 0 | 1, update: (f: FormInputs) => FormInputs) =>
    setSides((prev) => {
      const next: [Side, Side] = [prev[0], prev[1]];
      next[i] = { ...next[i], form: update(next[i].form) };
      return next;
    });

  const runBoth = () => {
    setBusy(true);
    setTimeout(() => {
      try {
        setMc([
          monteCarlo(toScenario(sides[0].form, { phiInflation: phi }), ruleset, ds, { runs: 2000, seed: 42 }),
          // Same seed for both, so the two columns face the same sampled futures and any
          // difference between them is the plan, not the draw.
          monteCarlo(toScenario(sides[1].form, { phiInflation: phi }), ruleset, ds, { runs: 2000, seed: 42 }),
        ]);
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const summary = (r: (typeof results)[number], side: Side, i: 0 | 1) => {
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
        <h1 className="text-2xl font-semibold">Compare two plans</h1>
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

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {sides.map((side, i) => (
          <div key={i} className="rounded-lg border border-indigo-200 bg-white p-4">
            <input
              className="mb-2 w-full rounded border border-slate-300 px-2 py-1 font-semibold"
              value={side.name}
              onChange={(e) =>
                setSides((prev) => {
                  const next: [Side, Side] = [prev[0], prev[1]];
                  next[i as 0 | 1] = { ...next[i as 0 | 1], name: e.target.value };
                  return next;
                })
              }
            />
            {summary(results[i], side, i as 0 | 1)}
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <button
          disabled={busy}
          onClick={runBoth}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Run 2,000 simulations on both
        </button>
        <button
          onClick={() => {
            setSides((prev) => [prev[0], { ...prev[1], form: prev[0].form }]);
            setMc([null, null]);
          }}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Reset right to match left
        </button>
        {busy ? (
          <span className="text-sm text-slate-600">simulating… the page will pause</span>
        ) : (
          <span className="text-xs text-slate-500">
            Both sides face the same sampled futures, so any difference is the plan, not luck.
          </span>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">What is different</h2>
        {differences.length === 0 ? (
          <p className="text-sm text-slate-600">
            The two plans are identical. Change something on either side below.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Input</th>
                <th className="px-2 py-1 text-right font-medium">{sides[0].name}</th>
                <th className="px-2 py-1 text-right font-medium">{sides[1].name}</th>
              </tr>
            </thead>
            <tbody>
              {differences.map((d) => (
                <tr key={String(d.key)} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-700">{d.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.a}</td>
                  <td className="px-2 py-1 text-right font-medium tabular-nums text-indigo-700">
                    {d.b}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {sides.map((side, i) => (
          <div key={i} className="space-y-5">
            <div className="rounded bg-slate-100 px-3 py-2 text-sm font-medium">{side.name}</div>
            <InputsPanel
              form={side.form}
              setForm={(update) => setSide(i as 0 | 1, update)}
              onChange={() => setMc([null, null])}
            />
          </div>
        ))}
      </div>

      <p className="pb-8 pt-6 text-xs text-slate-500">
        General information only, not personal financial advice. Editing here does not change
        your saved plan.
      </p>
    </main>
  );
}
