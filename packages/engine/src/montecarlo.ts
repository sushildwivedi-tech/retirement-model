import { project, type Datasets } from './engine';
import { indexRuleset } from './indexation';
import { cholesky, correlatedNormals, makeNormal, makeRng, percentile } from './random';
import type { ReturnDraw, Ruleset, Scenario } from './types';

/**
 * Correlation between bucket returns, in the order
 * [cash, investments, superAccumulation, primaryResidence].
 *
 * DOCUMENTED DEFAULT, not a sourced estimate - the build plan says "simple default matrix
 * is fine; document it". The shape reflects the obvious relationships: super is mostly
 * equities so it moves closely with outside-super investments (0.85); cash is near-
 * independent of both and slightly negative against growth assets in a flight to quality;
 * housing has a mild positive link to equities. Replace with a real estimate before using
 * the tails for anything consequential.
 */
export const DEFAULT_CORRELATIONS: number[][] = [
  //  cash   inv    super  home
  [1.0, -0.1, -0.1, 0.0],
  [-0.1, 1.0, 0.85, 0.3],
  [-0.1, 0.85, 1.0, 0.25],
  [0.0, 0.3, 0.25, 1.0],
];

/** Volatilities from the build plan's section 2.3 option table. Illustrative, not sourced. */
export const DEFAULT_VOLATILITY = {
  cash: 0.01,
  investments: 0.13,
  superAccumulation: 0.11,
  primaryResidence: 0.08,
};

export interface MonteCarloOptions {
  runs?: number;
  seed?: number;
  /** Sample age at death from the life tables instead of running to `planToAge`. */
  sampleLifespan?: boolean;
  /** Percentiles to report for the fan chart. */
  percentiles?: number[];
}

export interface FanBand {
  planYear: number;
  age: number;
  /** Accessible balance at each percentile, nominal. */
  values: Record<string, number>;
}

export interface MonteCarloResult {
  runs: number;
  seed: number;
  /** Share of runs that funded every year the household was alive. */
  successProbability: number;
  /** Ages at which money ran out, for the runs that failed. */
  failureAges: number[];
  medianFailureAge: number | null;
  fan: FanBand[];
  percentiles: number[];
  /** Wall-clock milliseconds, so the performance target stays visible. */
  elapsedMs: number;
  notes: string[];
}

/**
 * Run the projection many times with sampled returns and, optionally, sampled lifespans.
 *
 * Rulesets are indexed once up front and shared across every run - that is the build
 * plan's "pre-compute rule lookups", and it is what keeps 5,000 runs inside the target.
 */
export function monteCarlo(
  scenario: Scenario,
  ruleset: Ruleset,
  datasets: Datasets = {},
  options: MonteCarloOptions = {},
): MonteCarloResult {
  const runs = options.runs ?? 5000;
  const seed = options.seed ?? 12345;
  const pcts = options.percentiles ?? [0.1, 0.25, 0.5, 0.75, 0.9];
  const started = Date.now();
  const notes: string[] = [];

  const { assumptions, household } = scenario;
  const vol = assumptions.volatility ?? DEFAULT_VOLATILITY;
  const corr = assumptions.correlations ?? DEFAULT_CORRELATIONS;
  if (!assumptions.volatility) {
    notes.push(
      'ASSUMED: bucket volatilities are the build plan section 2.3 illustrative figures, not ' +
        'a sourced estimate. The width of the fan is only as good as these.',
    );
  }
  if (!assumptions.correlations) {
    notes.push(
      'ASSUMED: the correlation matrix is the documented default in DEFAULT_CORRELATIONS, ' +
        'not an estimate from data. Correlations drive the tails more than the median.',
    );
  }
  const L = cholesky(corr);

  const years = Math.max(...household.people.map((p) => assumptions.planToAge - p.currentAge)) + 1;

  // Pre-compute the indexed ruleset for each plan year, once for all runs.
  const indexedRulesets: Ruleset[] = [];
  for (let t = 0; t < years; t++) {
    indexedRulesets.push(
      indexRuleset(ruleset, Math.pow(1 + assumptions.cpi, t), assumptions.indexation),
    );
  }

  const canSampleLifespan =
    options.sampleLifespan === true &&
    datasets.lifeTables !== undefined &&
    household.people.every((p) => p.sex !== undefined);
  if (options.sampleLifespan && !canSampleLifespan) {
    notes.push(
      'Lifespan sampling was requested but not applied: it needs life tables and a sex for ' +
        'every person. The plan runs to the fixed planToAge instead.',
    );
  }

  const rng = makeRng(seed);
  const normal = makeNormal(rng);

  const failureAges: number[] = [];
  let successes = 0;
  // accessible[t] collects the balance at year t across runs, for the fan chart.
  const accessible: number[][] = Array.from({ length: years }, () => []);
  let representativeAges: number[] = [];

  for (let run = 0; run < runs; run++) {
    const returns: ReturnDraw[] = [];
    for (let t = 0; t < years; t++) {
      const z = correlatedNormals(L, normal);
      returns.push({
        cash: assumptions.returns.cash + z[0] * vol.cash,
        investments: assumptions.returns.investments + z[1] * vol.investments,
        superAccumulation: assumptions.returns.superAccumulation + z[2] * vol.superAccumulation,
        primaryResidence: assumptions.returns.primaryResidence + z[3] * vol.primaryResidence,
      });
    }

    let deathAgeByPerson: Record<string, number> | undefined;
    if (canSampleLifespan && datasets.lifeTables) {
      deathAgeByPerson = {};
      for (const p of household.people) {
        const table = datasets.lifeTables.tables[p.sex!];
        const qx = new Map(table.map((r) => [r.age, r.qx]));
        let age = p.currentAge;
        for (;;) {
          const q = qx.get(age) ?? 1;
          if (rng() < q) break;
          age += 1;
          if (age > 109) break;
        }
        deathAgeByPerson[p.id] = age;
      }
    }

    const result = project(scenario, ruleset, datasets, {
      returns,
      deathAgeByPerson,
      indexedRulesets,
    });

    if (run === 0) representativeAges = result.rows.map((r) => r.ages[household.people[0].id]);

    if (result.moneyRunsOutAge === null) successes += 1;
    else failureAges.push(result.moneyRunsOutAge);

    for (const row of result.rows) {
      accessible[row.planYear]?.push(row.balances.accessible);
    }
  }

  const fan: FanBand[] = accessible.map((values, t) => ({
    planYear: t,
    age: representativeAges[t] ?? household.people[0].currentAge + t,
    values: Object.fromEntries(
      pcts.map((p) => [`p${Math.round(p * 100)}`, Math.round(percentile(values, p))]),
    ),
  }));

  const sortedFailures = [...failureAges].sort((a, b) => a - b);

  return {
    runs,
    seed,
    successProbability: successes / runs,
    failureAges,
    medianFailureAge:
      sortedFailures.length === 0 ? null : sortedFailures[Math.floor(sortedFailures.length / 2)],
    fan,
    percentiles: pcts,
    elapsedMs: Date.now() - started,
    notes,
  };
}
