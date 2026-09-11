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

/**
 * Human labels for the fields. Every input is diffed whether or not it is named here -
 * see `differences` - and this only supplies a better name than the key.
 */
export const FIELD_LABELS: Partial<Record<keyof FormInputs, string>> = {
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
  ownsHome: 'Owns their home',
  primaryResidence: 'Home value',
  rentPerWeek: 'Rent / week',
  personalAssets: 'Contents and car',
  livingCostsMonthly: 'Spending now / month',
  insurancePremiumInSuper: 'Insurance from super',
  feeRateSuper: 'Fees — super',
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
  partnerWageGrowth: "Partner's wage growth",
  partnerInsurancePremiumInSuper: "Partner's insurance from super",
  partnerAfterTaxContribution: "Partner's after-tax into super",
  partnerUnusedConcessionalCapCarriedForward: "Partner's unused cap carried forward",
  partnerPartTimeIncome: "Partner's part-time income",
  partnerPartTimeYears: "Partner's part-time years",
  afterTaxContribution: 'After-tax into super',
  unusedConcessionalCapCarriedForward: 'Unused cap carried forward',
  healthInsuranceMonthly: 'Health insurance / month',
  firstDeathAge: 'First death at age',
  agedCareFromAge: 'Enters aged care at',
  agedCareYears: 'Years in aged care',
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
  'partnerWageGrowth',
  'feeRateSuper',
  'feeRateInvestments',
  'investmentIncomeYield',
  'healthInflation',
  'outOfPocketMultiplier',
  'returnCash',
  'returnHome',
  'sellingCostRate',
  'spendingStepDownOnFirstDeath',
  'phaseSlowGoMultiplier',
  'phaseNoGoMultiplier',
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
  'rentPerWeek',
  'personalAssets',
  'livingCostsMonthly',
  'insurancePremiumInSuper',
  'retirementSpending',
  'mortgageBalance',
  'offsetBalance',
  'downsizeNewHomeValue',
  'partTimeIncome',
  'partnerSalary',
  'partnerSuperBalance',
  'partnerInsurancePremiumInSuper',
  'partnerAfterTaxContribution',
  'partnerUnusedConcessionalCapCarriedForward',
  'partnerPartTimeIncome',
  'afterTaxContribution',
  'unusedConcessionalCapCarriedForward',
  'healthInsuranceMonthly',
  'agedCareAccommodation',
]);

/**
 * Fields that are a second view of another field rather than a difference of their own.
 * Listing them twice would be noise: birth year moves with age, and the gross salary and
 * the annual sacrifice are both worked out from figures that are already in the table.
 */
export const HIDDEN_FROM_DIFF = new Set<keyof FormInputs>([
  'birthYear',
  'partnerBirthYear',
  'salary',
  'partnerSalary',
  'voluntarySuperContribution',
  'partnerVoluntarySuperContribution',
  'privateHealthInsurancePremium',
  'annualSavings',
  'startYear',
]);

/** `partnerPartTimeYears` -> `Partner part time years`, for anything without a label. */
export function humanise(key: string): string {
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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
  /*
   * Every input, not a hand-kept list of them.
   *
   * This used to walk FIELD_LABELS, which meant a field nobody had thought to label was
   * invisible here - twenty-seven of them, including four whose non-partner twin was
   * listed. Two plans differing only in the partner's part-time work were reported as
   * identical while their outcomes differed, which is the worst thing a panel headed
   * "What is different" can do. Now the labels only supply a nicer name.
   */
  const differences = useMemo(
    () =>
      (Object.keys(sides[0].form) as Array<keyof FormInputs>)
        .filter((k) => !HIDDEN_FROM_DIFF.has(k))
        .filter((k) => sides.some((s2) => s2.form[k] !== sides[0].form[k]))
        .map((k) => ({
          key: k,
          label: FIELD_LABELS[k] ?? humanise(k),
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
    if (!r.ok) return <p className="text-sm text-bad">{r.error}</p>;
    const p: ProjectionResult = r.projection;
    const last = p.rows.at(-1);
    const liquid = last ? toRealRow(last).balances.total - toRealRow(last).balances.primaryResidence : 0;
    const rows: Array<[string, string]> = [
      [
        // Named for what it is. The front page's headline is the simulated figure; four
        // scenarios' worth of goal-seek would not be worth the wait here, so this stays
        // the central path and says so.
        'Could retire at (central path)',
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
      <dl className="text-sm">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-3 border-b border-rule-soft py-1.5 last:border-0"
          >
            <dt className="text-ink-mute">{k}</dt>
            <dd className="figure text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <>
      <div className="app-bar">
        <div className="app-bar-inner">
          <span className="brand">Retirement model</span>
          <nav className="seg">
            <Link href="/" className="seg-item">
              When can you retire?
            </Link>
            <Link href="/detail" className="seg-item">
              The detail
            </Link>
            <span className="seg-item seg-item-on">Compare</span>
          </nav>
          <span className="stamp ml-auto hidden sm:inline">{ruleset.id}</span>
        </div>
      </div>

      <main className="page">
      <header className="mb-5">
        <h1 className="font-display text-[1.6rem] font-semibold tracking-tight">
          Compare {['', 'one plan', 'two plans', 'three plans', 'four plans'][sides.length] ?? `${sides.length} plans`}
        </h1>
        <p className="lede mt-1">
          Every scenario starts from your saved plan. Change any of them and the outcomes update.
        </p>
      </header>

      <div className={`mb-4 grid gap-4 ${SUMMARY_GRID[sides.length] ?? 'lg:grid-cols-2'}`}>
        {sides.map((side, i) => (
          <div key={i} className="card card-calc">
            <div className="mb-3 flex items-center gap-1.5">
              <input
                className="input w-full !text-left font-semibold"
                value={side.name}
                onChange={(e) => rename(i, e.target.value)}
              />
              <button
                title="Duplicate this scenario"
                disabled={sides.length >= MAX_SIDES}
                onClick={() => duplicateSide(i)}
                className="btn btn-sm"
              >
                Copy
              </button>
              <button
                title="Remove this scenario"
                disabled={sides.length <= MIN_SIDES}
                onClick={() => removeSide(i)}
                className="btn btn-sm"
              >
                ✕
              </button>
            </div>
            {summary(results[i], i)}
          </div>
        ))}
      </div>

      <div className="card-quiet mb-4 flex flex-wrap items-center gap-2.5">
        <button
          disabled={busy}
          onClick={runAll}
          className="btn btn-primary"
        >
          Run {runsPerScenario(sides.length).toLocaleString()} simulations on each
        </button>
        <button
          disabled={sides.length >= MAX_SIDES}
          onClick={addSide}
          className="btn"
        >
          Add a scenario
        </button>
        <button
          onClick={() => {
            setSides((prev) => prev.map((s2, j) => (j === 0 ? s2 : { ...s2, form: prev[0].form })));
            clearRuns();
          }}
          className="btn"
        >
          Reset all to match {sides[0].name}
        </button>
        {busy ? (
          <span className="chip chip-assume gap-2 !text-[11px]">
            <span className="spinner" />
            Running {(runsPerScenario(sides.length) * sides.length).toLocaleString()}{' '}
            simulations across {sides.length} scenarios… this takes several seconds and the
            page will not respond until it finishes.
          </span>
        ) : (
          <span className="help mb-0">
            {runsPerScenario(sides.length).toLocaleString()} paths each, every scenario facing
            the same sampled futures — so a difference between them is the plan, not luck.
          </span>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-rule bg-surface p-4">
        <h2 className="section-title mb-2">What is different</h2>
        {differences.length === 0 ? (
          <p className="lede">
            {sides.length === 2 ? 'The two plans are identical.' : 'All the plans are identical.'}{' '}
            Change something below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="text-left">Input</th>
                  {sides.map((side, i) => (
                    <th key={i} className="text-right">
                      {side.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {differences.map((d) => (
                  <tr key={String(d.key)}>
                    <td className="text-ink-soft">{d.label}</td>
                    {d.values.map((v, i) => (
                      <td
                        key={i}
                        className={`text-right ${
                          // Anything that differs from the first column is the change
                          // being tested, so it is the thing worth the reader's eye.
                          i > 0 && v !== d.values[0] ? 'font-medium text-calc' : 'text-ink-soft'
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

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="eyebrow">Editing</span>
          {/* One form at a time: four full input panels side by side would not fit on
              any realistic screen, and the comparison above is what needs to be side by
              side, not the editing. */}
          {sides.map((side, i) => (
            <button
              key={i}
              onClick={() => setEditing(i)}
              className={`btn btn-sm ${editing === i ? 'btn-on' : ''}`}
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

      <p className="help pb-8 pt-6">
        General information only, not personal financial advice. Editing here does not change
        your saved plan.
      </p>
      </main>
    </>
  );
}
