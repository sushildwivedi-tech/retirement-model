'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  compareScenarios,
  earliestRetirementAgeDeterministic,
  personalIncomeTax,
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
  withChange,
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
import { InputsPanel } from './inputs-panel';
import { PlansBar } from './plans-bar';
import { useSolver, useBackgroundAge } from './use-solver';
import { money, pct } from './format';
import BalanceChart from './balance-chart';
import HealthChart from './health-chart';
import FanChart from './fan-chart';

/**
 * Where a number comes from. The UI colour-codes this, because a figure the user typed
 * and a figure taken from the ATO are not the same kind of thing and should not look
 * alike. Anything sourced from public data or produced by the model is NOT an input.
 */

export default function Planner({
  ruleset,
  lifeTables,
  healthCostCurve,
  view,
}: {
  ruleset: Ruleset;
  lifeTables: LifeTables;
  healthCostCurve: HealthCostCurve;
  /** 'answer' leads with when you can retire; 'detail' shows the workings. */
  view: 'answer' | 'detail';
}) {
  // Starts from the illustrative example. Anything the visitor types is theirs, kept in
  // their own browser - the first render must match the server's, so the saved values are
  // picked up in an effect rather than during render.
  const [form, setForm] = useState<FormInputs>(defaults);
  const [usingSaved, setUsingSaved] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    const saved = loadSaved(ruleset);
    if (saved) {
      setForm(saved);
      setUsingSaved(true);
    }
    hydrated.current = true;
    // The ruleset is fixed for the life of the page (a server component reads it once),
    // and this must run on mount only - re-running it would overwrite whatever has been
    // typed since with the stored copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // The home is off the chart by default: it is usually the biggest number in the
  // household and the least spendable, and stacking it hid the run-out year entirely.
  const [showHome, setShowHome] = useState(false);
  // Monte Carlo and the solvers take seconds, so they run on demand rather than on every
  // keystroke. Results are cleared whenever an input changes so a stale probability is
  // never shown against edited inputs.
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [spendSolve, setSpendSolve] = useState<GoalSeekResult<number> | null>(null);
  const [ageSolve, setAgeSolve] = useState<GoalSeekResult<number> | null>(null);
  // Monte Carlo and the solvers run in a worker, so the page keeps responding while they
  // do. `busy` is whichever job is in flight, or null.
  const { send, busy } = useSolver();
  const [confidence, setConfidence] = useState(85);
  const conf = confidence / 100;
  const ds = useMemo(() => ({ lifeTables, healthCostCurve }), [lifeTables, healthCostCurve]);
  const scenario = useMemo(
    () =>
      toScenario(form, {
        phiInflation: ruleset.privateHealthInsurance.premiumGrowthRate.value,
      }),
    [form, ruleset],
  );

  /**
   * The headline, solved in the background at a lower run count so it arrives in about
   * half a second, then left alone until the next edit. The button below still runs the
   * full 5,000 paths for the fan chart and the verified probability.
   *
   * Above the early return below, deliberately: a hook that sometimes does not run is a
   * hook-order bug, and this one has both state and an effect.
   */
  const confidenceAge = useBackgroundAge(
    JSON.stringify([scenario, conf]),
    async () => {
      const reply = await send(
        {
          kind: 'earliestAge',
          scenario,
          ruleset,
          datasets: ds,
          confidence: conf,
          // Lower than the button's counts on purpose: this refreshes after every edit,
          // and it is seeded, so the same inputs always give the same answer rather than
          // jittering. The button re-measures at 2,000 when an exact figure is wanted.
          searchRuns: 250,
          runs: 600,
        },
        'headline',
      );
      return reply.kind === 'earliestAge' ? reply.result : null;
    },
    view === 'answer',
  );

  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        value: project(scenario, ruleset, ds),
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [scenario, ruleset, ds]);

  if (!result.ok) {
    return <main className="p-8 text-bad">Could not run the projection: {result.error}</main>;
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
  // Accumulation-phase super belonging to someone under Age Pension age is exempt from
  // both tests. It is the largest lever a couple with an age gap has and is invisible
  // unless said out loud, so the first year it applies is surfaced.
  // The card is worth knowing about: it goes to the self-funded retiree who gets no
  // pension, which is exactly the household that assumes it qualifies for nothing.
  const card = (() => {
    const row = r.rows.find((x) => x.seniorsHealthCard);
    return row ? { age: row.ages[PRIMARY_ID] } : null;
  })();
  const exemption = (() => {
    const row = r.rows.find(
      (x) => x.agePensionDetail.exemptSuper > 0 && x.agePension > 0,
    );
    if (!row) return null;
    const pensionAge = ruleset.agePension.eligibilityAge.value;
    const younger = Object.entries(row.ages).find(([, age]) => age < pensionAge);
    if (!younger) return null;
    return {
      amount: real ? row.agePensionDetail.exemptSuper / row.cpiIndex : row.agePensionDetail.exemptSuper,
      who: younger[0] === PRIMARY_ID ? 'You' : 'Your partner',
      age: younger[1],
    };
  })();

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
      setForm(mergeInputs(parsed, ruleset));
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


  // --- Planning levers -------------------------------------------------------------
  // Each is a concrete change to the plan, evaluated deterministically. One projection
  // is well under a millisecond, so the whole table recomputes on every edit.
  const levers = useMemo(() => {
    const phi = { phiInflation: ruleset.privateHealthInsurance.premiumGrowthRate.value };
    // Marginal rate on the next dollar of investment income, including the Medicare levy.
    const step = 100;
    const marginalRate = Math.max(
      0,
      (personalIncomeTax(form.salary + step, ruleset).payable -
        personalIncomeTax(form.salary, ruleset).payable) /
        step,
    );
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
        label: 'Spend $10,000 a year less now',
        detail: `${money(form.livingCostsMonthly - 833)} a month instead of ${money(form.livingCostsMonthly)}, so $10,000 more is saved`,
        change: { livingCostsMonthly: Math.max(0, form.livingCostsMonthly - 833) },
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
    // Offset versus invest. The loan rate is earned tax-free and with certainty; an
    // investment return is neither. The arithmetic goes in the row text, and the model
    // settles the outcome.
    if (form.hasMortgage && form.mortgageBalance > 0) {
      const marginal = marginalRate;
      const afterTaxInvest =
        form.investmentIncomeYield * (1 - marginal) +
        Math.max(0, form.returnInvestments - form.investmentIncomeYield) *
          (1 - marginal * (1 - ruleset.capitalGains.discountRate.value));
      const rates =
        `Your loan costs ${(form.mortgageRate * 100).toFixed(2)}% tax-free and certain; ` +
        `investing returns about ${(afterTaxInvest * 100).toFixed(2)}% after tax at your ` +
        `${(marginal * 100).toFixed(0)}% marginal rate, and is not certain.`;
      if (form.offsetBalance > 0) {
        candidates.push({
          label: `Move the ${money(form.offsetBalance)} offset into investments`,
          detail: rates,
          change: {
            offsetBalance: 0,
            investments: form.investments + form.offsetBalance,
          },
        });
      }
      if (form.investments > 0) {
        candidates.push({
          label: `Move ${money(form.investments)} of investments into the offset`,
          detail: rates,
          change: {
            offsetBalance: form.offsetBalance + form.investments,
            investments: 0,
          },
        });
      }
    }

    const downsizerAge = ruleset.super.downsizerContribution.minimumAge.value;
    const downsizerCap = ruleset.super.downsizerContribution.capPerPerson.value;
    if (form.ownsHome && !form.downsize && form.primaryResidence > 0) {
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
    if (form.ownsHome && form.downsize && form.downsizeAge > form.retirementAge) {
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
    if (form.ownsHome && form.downsize && form.downsizeAge < downsizerAge) {
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
        // Through the field rules, exactly as Apply will: a lever that changes living
        // costs or a sacrifice moves what the household saves, and evaluating the raw
        // spread would advertise an outcome the Apply button does not deliver.
        scenario: toScenario(withChange(form, c.change, ruleset), phi),
      })),
      ruleset,
      { lifeTables, healthCostCurve },
    );
    return candidates
      .map((c, i) => {
        const outcome = compared.outcomes[i];
        // The run-out age barely separates offset choices - a mortgage of any size moves
        // it either way - so say what actually differs: interest paid and payoff year.
        const isOffsetMove = /offset/i.test(c.label);
        if (!isOffsetMove) return { ...c, outcome, differenceOverride: undefined as string | undefined };
        const interestDelta = outcome.mortgageInterestPaid - compared.baseline.mortgageInterestPaid;
        const yearsDelta =
          outcome.mortgagePaidOffAge !== null && compared.baseline.mortgagePaidOffAge !== null
            ? outcome.mortgagePaidOffAge - compared.baseline.mortgagePaidOffAge
            : null;
        const parts: string[] = [];
        if (Math.abs(interestDelta) >= 1) {
          parts.push(
            interestDelta > 0
              ? `Costs ${money(interestDelta)} more interest`
              : `Saves ${money(-interestDelta)} of interest`,
          );
        }
        if (yearsDelta !== null && yearsDelta !== 0) {
          parts.push(
            yearsDelta > 0
              ? `clears the loan ${yearsDelta} ${yearsDelta === 1 ? 'year' : 'years'} later`
              : `clears it ${-yearsDelta} ${-yearsDelta === 1 ? 'year' : 'years'} sooner`,
          );
        }
        const found = parts.length > 0 ? `${parts.join(' and ')}. ` : '';
        // Moving money between the offset and investments barely shifts the year the money
        // runs out, so the years column would read "no change" and bury a real saving. Let
        // these rows report their difference in the unit that actually applies.
        const differenceOverride: string | undefined =
          (outcome.deltaYears === 0 || outcome.deltaYears === null) && Math.abs(interestDelta) >= 1
            ? interestDelta < 0
              ? `${money(-interestDelta)} less interest`
              : `${money(interestDelta)} more interest`
            : undefined;
        return { ...c, detail: found + c.detail, outcome, differenceOverride };
      })
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
      label: 'Rent Assistance (single, max)',
      value: `${money(ap.rentAssistance.value.single.maxPaymentFortnight * ap.fortnightsPerYear.value)}/yr`,
      source: 'Services Australia',
    },
    {
      label: 'Seniors Health Card limit (single)',
      value: money(ruleset.seniorsHealthCard.value.incomeLimitSingle),
      source: 'Services Australia',
    },
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

  // The headline. Deterministic on purpose: it is a binary search over a handful of
  // projections, so it updates as you type, where the Monte Carlo answer takes seconds.
  const canRetireAt = useMemo(
    () =>
      earliestRetirementAgeDeterministic(scenario, ruleset, {
        lifeTables,
        healthCostCurve,
      }),
    [scenario, ruleset, lifeTables, healthCostCurve],
  );

  /**
   * What the big number says. The confidence-based age when the simulation has produced
   * one, and the central-path age until then - which is honest as long as the line
   * underneath says which of the two is on screen.
   */
  const headlineAge = confidenceAge?.value ?? canRetireAt.age;
  // A couple's two ages move together, so the partner's follows the same gap.
  const partnerGap =
    canRetireAt.people.length > 1 ? canRetireAt.people[1].age - canRetireAt.people[0].age : 0;


  // The widest swing any lever produces, so the bars in the table share one scale.
  const worstBestYears = Math.max(
    1,
    ...levers.map((l) => Math.abs(l.outcome.deltaYears ?? 0)),
  );

  const download = () => {
    const blob = new Blob([toCsv(r, real)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projection-${real ? 'real' : 'nominal'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      {/* The bar carries identity, provenance and navigation, so the content column can
          start with the answer rather than with furniture. */}
      <div className="app-bar">
        <div className="app-bar-inner">
          <span className="brand">Retirement model</span>
          <nav className="seg">
            <Link href="/" className={`seg-item ${view === 'answer' ? 'seg-item-on' : ''}`}>
              When can you retire?
            </Link>
            <Link href="/detail" className={`seg-item ${view === 'detail' ? 'seg-item-on' : ''}`}>
              The detail
            </Link>
            <Link href="/compare" className="seg-item">
              Compare
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <PlansBar
              form={form}
              setForm={(next) => setForm(next)}
              onLoad={clearResults}
              ruleset={ruleset}
            />
            <span className="stamp hidden lg:inline">{r.ruleset}</span>
          </div>
        </div>
      </div>

      <main className="page">
      <div className="layout">
        <aside className="sidebar min-w-0 space-y-4">
          {/* A visible statement of WHOSE numbers these are. Without it, a browser copy
              kept from an earlier visit looks indistinguishable from the example, and
              there is no obvious way back. */}
          {usingSaved && (
            <div className="rounded-lg border border-good-line bg-good-bg p-3 text-sm">
              <div className="font-medium text-good">Showing your figures</div>
              <p className="mt-1 text-xs text-good/80">
                Kept while this tab is open, and shared across all three pages. Opening the
                app again starts from the example — use Export below to keep a scenario.
              </p>
              <button
                onClick={resetInputs}
                className="mt-2 rounded border border-good-line bg-surface px-2 py-1 text-xs hover:bg-good-bg"
              >
                Start again from the example
              </button>
            </div>
          )}
          <InputsPanel form={form} setForm={setForm} onChange={clearResults} ruleset={ruleset} />
          <div className="card-quiet text-sm">
            <div className="font-medium">Your details</div>
            <p className="mt-1 text-xs text-ink-mute">
              {usingSaved
                ? 'Kept for this visit only, in this tab. Nothing is sent anywhere — there is no server to send it to.'
                : 'These are illustrative example figures. Edit anything and it becomes yours, for as long as this tab is open.'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={exportInputs}
                className="btn btn-sm"
              >
                Export
              </button>
              <label className="btn btn-sm cursor-pointer">
                Import
                <input type="file" accept="application/json" className="hidden" onChange={importInputs} />
              </label>
              <button
                onClick={resetInputs}
                className="btn btn-sm"
              >
                Reset to example
              </button>
            </div>
            {importError && <p className="mt-2 text-xs text-bad">{importError}</p>}
          </div>
          <details className="card-quiet">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-mute">
              What the colours mean
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-ink-soft">
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-rule bg-surface" />
                Your own figures — edit freely
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-assume-line bg-assume-bg" />
                Assumptions — editable, but a modelling choice, not a fact
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-source-line bg-source-bg" />
                Public data — sourced, so not editable
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded border border-calc-line bg-calc-bg" />
                Calculated by the model
              </li>
            </ul>
          </details>

          <details className="rounded-lg border border-source-line bg-source-bg p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Public data used ({sourcedFacts.length} figures)
            </summary>
            <p className="mt-1 text-xs text-ink-mute">
              Fetched from the source named against each, on {ruleset.retrievedAt}. These are
              not inputs — change them by updating the ruleset, not the form.
            </p>
            <dl className="mt-2 space-y-2">
              {sourcedFacts.map((fact) => (
                <div key={fact.label} className="text-xs">
                  <dt className="flex justify-between gap-2">
                    <span className="text-ink-soft">{fact.label}</span>
                    <span className="font-medium tabular-nums">{fact.value}</span>
                  </dt>
                  <dd className="text-[11px] text-ink-mute">{fact.source}</dd>
                </div>
              ))}
            </dl>
          </details>

        </aside>

        {/* min-w-0: without it the grid column takes its width from the widest child -
            the fourteen-column year table - and the whole page scrolls sideways. */}
        <section className="content min-w-0 space-y-5">
          {view === 'answer' && (
            <div
              className={`hero ${
                canRetireAt.age === null
                  ? 'hero-bad'
                  : canRetireAt.plannedAgeWorks
                    ? 'hero-good'
                    : 'hero-warn'
              }`}
            >
              <div className="eyebrow">
                On these numbers, spending {money(form.retirementSpending)} a year
              </div>
              <div className="hero-number mt-2">
                {headlineAge === null ? (
                  'No age works'
                ) : canRetireAt.people.length === 1 ? (
                  `You could retire at ${headlineAge}`
                ) : (
                  // Two people of different ages retiring together do not retire at the
                  // same age, so a couple gets both numbers rather than one.
                  <>
                    You could retire at {headlineAge},
                    <br />
                    your partner at {headlineAge + partnerGap}
                  </>
                )}
              </div>
              {/* Which number this is, and what the other one says. The confidence figure
                  is always the later of the two, and it is the one people should carry
                  away - so it leads, and the central path is demoted to a caveat. */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {confidenceAge?.value != null ? (
                  <>
                    <span className="chip chip-calc">
                      at {Math.round((confidenceAge.achievedProbability ?? conf) * 100)}% confidence
                    </span>
                    {canRetireAt.age !== null && canRetireAt.age !== confidenceAge.value && (
                      <span className="muted">
                        {canRetireAt.age} if returns land on the central path every year
                      </span>
                    )}
                  </>
                ) : busy?.label === 'headline' ? (
                  <span className="muted flex items-center gap-2">
                    <span className="spinner" />
                    Simulating for a {confidence}% confident answer — showing the central path
                    meanwhile
                  </span>
                ) : (
                  <span className="muted">
                    Central path — the simulation below gives the confident answer
                  </span>
                )}
              </div>
              <p className="lede mt-3">
                {canRetireAt.age === null ? (
                  <>
                    Even working to {form.planToAge} does not fund this level of spending. Lower
                    the spend, or check the figures on the left.
                  </>
                ) : canRetireAt.plannedAgeWorks ? (
                  <>
                    {canRetireAt.people.length === 1
                      ? `You are planning to stop at ${canRetireAt.plannedAge}, and that works`
                      : `You are planning to stop at ${canRetireAt.people
                          .map((p) => p.plannedAge)
                          .join(' and ')}, and that works`}{' '}
                    — the money lasts to {form.planToAge}
                    {canRetireAt.yearsFromPlan !== null && canRetireAt.yearsFromPlan < 0 && (
                      <>
                        , and you could go {-canRetireAt.yearsFromPlan}{' '}
                        {-canRetireAt.yearsFromPlan === 1 ? 'year' : 'years'} sooner
                      </>
                    )}
                    .
                  </>
                ) : (
                  <>
                    {canRetireAt.people.length === 1
                      ? `You are planning to stop at ${canRetireAt.plannedAge}, which is `
                      : `You are planning to stop at ${canRetireAt.people
                          .map((p) => p.plannedAge)
                          .join(' and ')}, which is `}
                    <span className="font-medium">
                      {canRetireAt.yearsFromPlan} {canRetireAt.yearsFromPlan === 1 ? 'year' : 'years'}
                    </span>{' '}
                    too early — on this plan the money runs out at {r.moneyRunsOutAge}.{' '}
                    {canRetireAt.people.length > 1 && 'Both would need to work that much longer. '}
                    The table below shows what would close that gap.
                  </>
                )}
              </p>
              <p className="help mt-4 mb-0">
                {confidenceAge?.value != null
                  ? `The age that works most of the time, from ${confidenceAge.verifyRuns.toLocaleString()} simulated futures. The central-path age assumes returns land on the average every single year, which they will not — that is why it is the lower of the two.`
                  : 'The central path assumes returns land on the average every year, which they will not. The simulated answer is on its way and will be later.'}
              </p>
            </div>
          )}
          {view === 'detail' && (
            <>
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
                value={
                  !depleted
                    ? '—'
                    : depleted.agePension > 0
                      ? `${money(depleted.agePension)}/yr`
                      : 'Nothing'
                }
                tone={depleted ? 'bad' : 'neutral'}
                note={
                  !depleted
                    ? 'your own assets cover the whole plan'
                    : depleted.agePension > 0
                      ? `Age Pension only — ${Math.round((depleted.agePension / depleted.spending.total) * 100)}% of your ${money(depleted.spending.total)} target`
                      : // Running out before Age Pension age is a different, worse problem: there
                        // is no safety net yet, so saying "Age Pension only" would imply a floor
                        // that does not exist until ${ruleset.agePension.eligibilityAge.value}.
                        `no income at all — the Age Pension does not start until ${ruleset.agePension.eligibilityAge.value}`
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

            {card && (
              <div className="rounded-lg border border-good-line bg-good-bg p-4 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="font-semibold text-good">
                    Commonwealth Seniors Health Card from age {card.age}
                  </h2>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-good">
                    calculated
                  </span>
                </div>
                <p className="mt-1 text-good/80">
                  Of pension age, no pension payable, and income under{' '}
                  {money(ruleset.seniorsHealthCard.value.incomeLimitSingle)} single (
                  {money(ruleset.seniorsHealthCard.value.incomeLimitCoupleCombined)} for a couple).
                  Cheaper medicines and concessions — no dollar value is put on it here, because
                  that would be a guess.
                </p>
              </div>
            )}

            {exemption && (
              <div className="rounded-lg border border-calc-line bg-calc-bg p-4 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="font-semibold text-calc">
                    {money(exemption.amount)} of super is invisible to the Age Pension tests
                  </h2>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-calc">
                    calculated
                  </span>
                </div>
                <p className="mt-1 text-calc/80">
                  Money in accumulation phase is not assessed until the person holding it reaches
                  Age Pension age. {exemption.who} {exemption.who === 'Your partner' ? 'is' : 'are'}{' '}
                  {exemption.age}, so this balance is exempt from both the income and assets tests
                  until age {ruleset.agePension.eligibilityAge.value} — worth checking before you
                  move money between the two of you, or start a pension with it.
                </p>
              </div>
            )}

            <div className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="section-title">Balances over time</h2>
                {/* wraps: three buttons plus a heading do not fit a narrow phone in one row */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    onClick={() => setReal(!real)}
                    className="btn btn-sm"
                  >
                    {real ? "Today's dollars" : 'Future dollars'}
                  </button>
                  {form.ownsHome && (
                    <button
                      onClick={() => setShowHome(!showHome)}
                      aria-pressed={showHome}
                      className={`rounded border px-2 py-1 ${
                        showHome
                          ? 'border-rule bg-ink text-white'
                          : 'border-rule hover:bg-sunk'
                      }`}
                    >
                      {showHome ? 'Hide home' : 'Show home'}
                    </button>
                  )}
                  <button onClick={download} className="btn btn-sm">
                    Export CSV
                  </button>
                </div>
              </div>
              <BalanceChart
                rows={rows}
                personId={PRIMARY_ID}
                showHome={showHome}
                retirementAge={form.retirementAge}
                pensionAge={ruleset.agePension.eligibilityAge.value}
              />
            </div>

            <div className="card">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="section-title">What you spend, and on what</h2>
                <span className="text-xs text-ink-mute">
                  {real ? "today's dollars" : 'future dollars'}
                </span>
              </div>
              <p className="help mt-0">
                Baseline spending steps down through the go-go, slow-go and no-go phases while
                health costs climb with age. The green line is the Age Pension.
              </p>
              <HealthChart rows={rows} personId={PRIMARY_ID} />
            </div>

            {r.longevity.length > 0 && (
              <div className="rounded-lg border border-rule bg-surface p-4 text-sm">
                <h2 className="mb-2 font-semibold">Longevity (Australian Life Tables 2020–22)</h2>
                <ul className="space-y-1 text-ink-soft">
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
                <p className="mt-2 text-xs text-ink-mute">
                  Period tables: they hold today&apos;s mortality fixed and ignore future
                  improvement, so they understate lifespan — the direction that makes money look
                  like it lasts.
                </p>
              </div>
            )}
            </>
          )}

          {view === 'answer' && (
            <>
            <div className="band">
              <div className="band-head">
                <h2 className="section-title">How confident can you be?</h2>
                <span className="chip chip-calc">
                  calculated
                </span>
                <label className="flex items-center gap-1 text-sm">
                  Target confidence
                  <input
                    className="w-16 rounded border border-rule px-2 py-1 text-right tabular-nums"
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
                  disabled={busy !== null && busy.label !== 'headline'}
                  onClick={async () => {
                    const reply = await send(
                      { kind: 'simulate', scenario, ruleset, datasets: ds, runs: 5000 },
                      'simulating',
                    );
                    if (reply.kind === 'simulate') setMc(reply.result);
                  }}
                  className="btn btn-primary"
                >
                  Run 5,000 simulations
                </button>
                <button
                  disabled={busy !== null && busy.label !== 'headline'}
                  onClick={async () => {
                    const reply = await send(
                      {
                        kind: 'maxSpend',
                        scenario,
                        ruleset,
                        datasets: ds,
                        confidence: conf,
                        searchRuns: 600,
                        runs: 2000,
                      },
                      'solving spend',
                    );
                    if (reply.kind === 'maxSpend') setSpendSolve(reply.result);
                  }}
                  className="btn"
                >
                  Max sustainable spend
                </button>
                <button
                  disabled={busy !== null && busy.label !== 'headline'}
                  onClick={async () => {
                    const reply = await send(
                      {
                        kind: 'earliestAge',
                        scenario,
                        ruleset,
                        datasets: ds,
                        confidence: conf,
                        searchRuns: 600,
                        runs: 2000,
                      },
                      'solving age',
                    );
                    if (reply.kind === 'earliestAge') setAgeSolve(reply.result);
                  }}
                  className="btn"
                >
                  Earliest retirement age
                </button>
                {busy && busy.label !== 'headline' ? (
                  <span className="flex items-center gap-2 rounded bg-assume-bg px-3 py-1.5 text-sm font-medium text-assume">
                    <span className="spinner" />
                    {busy.label === 'simulating'
                      ? 'Running 5,000 simulations'
                      : busy.label === 'solving spend'
                        ? 'Searching for the highest sustainable spend'
                        : 'Searching for the earliest retirement age'}
                    … you can keep editing while it runs.
                  </span>
                ) : (
                  <span className="text-xs text-ink-mute">
                    Runs in a background thread in this browser — the page keeps working while it does.
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
                    <span className="text-sm text-ink-mute">
                      of {mc.runs.toLocaleString()} simulated futures never ran out
                      {mc.medianFailureAge !== null && (
                        <> — the ones that did ran out at a median age of {mc.medianFailureAge}</>
                      )}
                      . ({(mc.elapsedMs / 1000).toFixed(1)}s)
                    </span>
                  </div>
                  <FanChart fan={mc.fan} />
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-mute">
                    {mc.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-ink-mute">
                  The projection above is a single path. Run the simulations to see the spread of
                  outcomes and a probability of success.
                </p>
              )}
            </div>

            <div className="band">
              <div className="band-head">
                <h2 className="section-title">What would move the needle</h2>
                <span className="chip chip-calc">
                  calculated
                </span>
              </div>
              <p className="help mt-0">
                Each row re-runs the whole projection with one change, against your current plan
                {r.moneyRunsOutAge === null
                  ? ', which already lasts the full plan.'
                  : `, which runs out at ${r.moneyRunsOutAge}.`}{' '}
                Best first. Apply takes the change into your inputs.
              </p>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead className="text-xs uppercase text-ink-mute">
                    <tr>
                      <th className="text-left">Change</th>
                      <th className="text-right">Money lasts to</th>
                      <th className="text-right">Difference</th>
                      <th className="text-right">
                        Savings left at {form.planToAge}
                      </th>
                      <th className="" />
                    </tr>
                  </thead>
                  <tbody>
                    {levers.map((l) => {
                      const o = l.outcome;
                      const better = o.fixesIt || (o.deltaYears ?? 0) > 0;
                      return (
                        <tr key={l.label} className="border-t border-rule-soft align-top">
                          <td className="px-2 py-2">
                            <div className="font-medium text-ink">{l.label}</div>
                            <div className="text-xs text-ink-mute">{l.detail}</div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {o.runsOutAge === null ? (
                              <span className="font-medium text-good">never runs out</span>
                            ) : (
                              `age ${o.runsOutAge}`
                            )}
                          </td>
                          <td
                            className={`px-2 py-2 text-right font-medium tabular-nums ${
                              l.differenceOverride
                                ? l.differenceOverride.includes('less')
                                  ? 'text-good'
                                  : 'text-bad'
                                : better
                                  ? 'text-good'
                                  : (o.deltaYears ?? 0) < 0
                                    ? 'text-bad'
                                    : 'text-ink-mute'
                            }`}
                          >
                            {l.differenceOverride
                              ? l.differenceOverride
                              : o.fixesIt
                              ? 'fixes it'
                              : o.deltaYears === null
                                ? '—'
                                : o.deltaYears > 0
                                  ? `+${o.deltaYears} yrs`
                                  : o.deltaYears === 0
                                    ? 'no change'
                                    : `${o.deltaYears} yrs`}
                            {/* The same figure as a length, so the ranking is visible
                                without reading every row. Scaled against the best row,
                                which is the only comparison that matters here. */}
                            {o.deltaYears !== null && o.deltaYears !== 0 && (
                              <span className="bar-track mt-1.5">
                                <span
                                  className={`bar-fill ${o.deltaYears < 0 ? 'bar-fill-bad' : ''}`}
                                  style={{
                                    width: `${Math.max(
                                      6,
                                      (Math.abs(o.deltaYears) / worstBestYears) * 100,
                                    )}%`,
                                  }}
                                />
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-ink-mute">
                            {money(o.liquidEstateReal)}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button
                              onClick={() => {
                                // Through the field rules, key by key: applying "salary
                                // sacrifice $10,000" has to move the take-home figure the
                                // form shows, or the panel would contradict the lever.
                                setForm((f) => withChange(f, l.change, ruleset));
                                clearResults();
                              }}
                              className="btn btn-sm"
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
              <p className="mt-2 text-xs text-ink-mute">
                Ranked by outcome, not by what the change costs you — working five more years
                and spending $10,000 less are not equivalent sacrifices, and only you can weigh
                them. These are also single deterministic paths, so they compare like with like
                but say nothing about risk; run the simulations below for that.
              </p>
            </div>

            </>
          )}

          {view === 'detail' && (
            <>
            <Panel title="Not modelled yet — these numbers are incomplete" tone="warn" items={r.notModelled} />
            {r.warnings.length > 0 && <Panel title="Assumptions and flags" tone="info" items={r.warnings} />}

            <div className="rounded-lg border border-rule bg-surface">
              <h2 className="border-b border-rule p-3 font-semibold">
                Projection ({real ? "today's dollars" : 'future dollars'})
              </h2>
              <div className="max-h-[520px] overflow-auto">
                <table className="table table-dense text-right">
                  <thead className="sticky top-0 bg-surface">
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
                        <th key={h} className="text-right">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.planYear}
                        className={`border-t border-rule-soft ${row.shortfall > 0 ? 'bg-bad-bg' : ''} ${
                          form.hasPartner && !row.alive.includes(PARTNER_ID) ? 'text-ink-mute' : ''
                        }`}
                        title={row.events.join(' ')}
                      >
                        <td className="px-2 py-1 text-left">{row.calendarYear}</td>
                        <td className="">
                          {row.ages[PRIMARY_ID]}
                          {form.hasPartner && (
                            <span className="text-ink-mute">/{row.ages[PARTNER_ID]}</span>
                          )}
                        </td>
                        <td className="">{money(row.income.salary)}</td>
                        <td
                          className="px-2 py-1 text-good"
                          title={
                            row.agePension > 0
                              ? `Cut back by the ${row.agePensionDetail.bindingTest} test. Deemed income ${money(row.agePensionDetail.deemedIncome)} against a full rate of ${money(row.agePensionDetail.maxRate)}.`
                              : 'No entitlement this year'
                          }
                        >
                          {money(row.agePension)}
                        </td>
                        <td
                          className=""
                          title={`Personal ${money(row.tax.personal)}, super earnings ${money(row.tax.superEarnings)}, contributions ${money(row.tax.superContributions)}`}
                        >
                          {money(row.tax.total)}
                        </td>
                        <td className="">{money(row.spending.total)}</td>
                        <td className="">{money(row.drawdown.total)}</td>
                        <td className="">{money(row.balances.cash)}</td>
                        <td className="">{money(row.balances.investments)}</td>
                        <td className="">{money(row.balances.superAccumulation)}</td>
                        <td className="">{money(row.balances.superPension)}</td>
                        <td className="px-2 py-1 text-ink-mute">{money(row.balances.primaryResidence)}</td>
                        <td className="px-2 py-1 font-medium">{money(row.balances.accessible)}</td>
                        <td className="px-2 py-1 text-bad">{row.shortfall > 0 ? money(row.shortfall) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          )}

          <p className="pb-8 text-xs text-ink-mute">
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
    </>
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
    <div className="rounded-lg border border-calc-line bg-calc-bg p-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-ink-mute">
        measured at {(result.achievedProbability * 100).toFixed(1)}% over{' '}
        {result.verifyRuns.toLocaleString()} runs ({(result.elapsedMs / 1000).toFixed(1)}s)
      </div>
      {result.notes.map((n) => (
        <p key={n} className="mt-1 text-xs text-assume">
          {n}
        </p>
      ))}
    </div>
  );
}

function Card({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'good' | 'bad' | 'neutral' }) {
  const skin = tone === 'bad' ? 'card-bad' : tone === 'good' ? 'card-good' : '';
  return (
    <div className={`card ${skin}`}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 font-display text-[1.7rem] font-semibold leading-tight tracking-tight">
        {value}
      </div>
      <div className="help mt-1 mb-0">{note}</div>
    </div>
  );
}

function Panel({ title, items, tone }: { title: string; items: string[]; tone: 'warn' | 'info' }) {
  const c = tone === 'warn' ? 'card-assume' : 'card-source';
  return (
    <details open className={`card ${c}`}>
      <summary className="details-summary section-title text-base">{title}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </details>
  );
}
