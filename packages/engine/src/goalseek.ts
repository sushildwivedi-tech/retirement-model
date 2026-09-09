import { monteCarlo, type MonteCarloOptions } from './montecarlo';
import { project, type Datasets } from './engine';
import type { Ruleset, Scenario } from './types';

export interface GoalSeekOptions extends MonteCarloOptions {
  /** Success probability to solve for, e.g. 0.85. */
  confidence?: number;
  /**
   * Runs per probe while searching. Fewer runs make the search fast but noisy; the final
   * answer is re-measured at `runs` so the number reported is not the noisy one.
   */
  searchRuns?: number;
  /** Bisection iterations. Twelve halvings resolve a $200k range to about $50. */
  iterations?: number;
}

export interface GoalSeekResult<T> {
  /** The solved value, or null if even the most conservative end failed. */
  value: T | null;
  /** Success probability at the solved value, measured at full `runs`. */
  achievedProbability: number;
  confidence: number;
  searchRuns: number;
  verifyRuns: number;
  iterations: number;
  elapsedMs: number;
  notes: string[];
}

const withSpend = (s: Scenario, spend: number): Scenario => ({
  ...s,
  household: { ...s.household, retirementSpending: spend },
});

const withRetirementAge = (s: Scenario, age: number): Scenario => ({
  ...s,
  household: {
    ...s.household,
    people: s.household.people.map((p) => ({ ...p, retirementAge: age })),
  },
  events: s.events.map((e) =>
    e.kind === 'downsize' && e.atAge < age ? { ...e, atAge: age } : e,
  ),
});

export interface DeterministicRetirementAge {
  /** Earliest age the money lasts the whole plan on the central return path. */
  age: number | null;
  /** The age currently planned, for comparison. */
  plannedAge: number;
  /** How many years earlier (negative) or later (positive) than the current plan. */
  yearsFromPlan: number | null;
  /** True when the currently planned age already works. */
  plannedAgeWorks: boolean;
}

/**
 * The earliest retirement age that lasts the whole plan on the central return path.
 *
 * Deterministic, so it is instant - a binary search over about six projections, each
 * well under a millisecond. That is what makes it usable as a headline that updates
 * while you type, where the Monte Carlo version takes seconds.
 *
 * It answers a different question from `earliestRetirementAge`, and a softer one: this is
 * "the age that works if returns behave", not "the age that works most of the time". The
 * probabilistic answer is always later, and the UI should say so.
 */
export function earliestRetirementAgeDeterministic(
  scenario: Scenario,
  ruleset: Ruleset,
  datasets: Datasets = {},
): DeterministicRetirementAge {
  const first = scenario.household.people[0];
  const plannedAge = first.retirementAge;
  const lasts = (age: number) =>
    project(withRetirementAge(scenario, age), ruleset, datasets).moneyRunsOutAge === null;

  const plannedAgeWorks = lasts(plannedAge);
  let lo = first.currentAge;
  let hi = scenario.assumptions.planToAge;
  if (!lasts(hi)) {
    return { age: null, plannedAge, yearsFromPlan: null, plannedAgeWorks };
  }
  // Success is monotonic in retirement age, so the first age that works is the answer.
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lasts(mid)) hi = mid;
    else lo = mid + 1;
  }
  return { age: lo, plannedAge, yearsFromPlan: lo - plannedAge, plannedAgeWorks };
}

/**
 * The largest annual spend that still meets the confidence target.
 *
 * Bisects on spending. Success is monotonically decreasing in spend, which is what makes
 * bisection valid here.
 */
export function maxSustainableSpend(
  scenario: Scenario,
  ruleset: Ruleset,
  datasets: Datasets = {},
  options: GoalSeekOptions = {},
): GoalSeekResult<number> {
  const started = Date.now();
  const confidence = options.confidence ?? 0.85;
  const searchRuns = options.searchRuns ?? 1000;
  const verifyRuns = options.runs ?? 5000;
  const iterations = options.iterations ?? 14;
  const notes: string[] = [];

  const probability = (spend: number, runs: number) =>
    monteCarlo(withSpend(scenario, spend), ruleset, datasets, { ...options, runs }).successProbability;

  let lo = 0;
  let hi = Math.max(scenario.household.retirementSpending * 3, 100_000);

  if (probability(hi, searchRuns) >= confidence) {
    notes.push(
      `Even ${Math.round(hi).toLocaleString()} a year clears the target, so the search range ` +
        'was not wide enough to bind. Treat the answer as "at least this much".',
    );
    const achieved = probability(hi, verifyRuns);
    return { value: hi, achievedProbability: achieved, confidence, searchRuns, verifyRuns, iterations: 0, elapsedMs: Date.now() - started, notes };
  }
  if (probability(lo, searchRuns) < confidence) {
    notes.push(
      'Even spending nothing does not reach the confidence target. That means the plan fails ' +
        'on fixed costs alone - health, insurance, aged care or one-off expenses.',
    );
    return { value: null, achievedProbability: probability(lo, verifyRuns), confidence, searchRuns, verifyRuns, iterations: 0, elapsedMs: Date.now() - started, notes };
  }

  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (probability(mid, searchRuns) >= confidence) lo = mid;
    else hi = mid;
  }
  const value = Math.floor(lo / 100) * 100;
  const achieved = probability(value, verifyRuns);
  if (achieved < confidence) {
    notes.push(
      `The search used ${searchRuns} runs per probe but the answer was verified at ${verifyRuns}, ` +
        `so the measured probability (${(achieved * 100).toFixed(1)}%) sits just under the ` +
        `${(confidence * 100).toFixed(0)}% target. Raise searchRuns to tighten it.`,
    );
  }
  return {
    value,
    achievedProbability: achieved,
    confidence,
    searchRuns,
    verifyRuns,
    iterations,
    elapsedMs: Date.now() - started,
    notes,
  };
}

/**
 * The earliest retirement age that still meets the confidence target.
 *
 * Walks up from the current age; success is monotonically increasing in retirement age,
 * so the first age that clears the bar is the answer.
 */
export function earliestRetirementAge(
  scenario: Scenario,
  ruleset: Ruleset,
  datasets: Datasets = {},
  options: GoalSeekOptions = {},
): GoalSeekResult<number> {
  const started = Date.now();
  const confidence = options.confidence ?? 0.85;
  const searchRuns = options.searchRuns ?? 1000;
  const verifyRuns = options.runs ?? 5000;
  const notes: string[] = [];

  const first = scenario.household.people[0];
  const from = first.currentAge;
  const to = scenario.assumptions.planToAge;

  const probability = (age: number, runs: number) =>
    monteCarlo(withRetirementAge(scenario, age), ruleset, datasets, { ...options, runs })
      .successProbability;

  // Binary search over whole years.
  let lo = from;
  let hi = to;
  if (probability(hi, searchRuns) < confidence) {
    notes.push(
      `Even working to ${to} does not reach ${Math.round(confidence * 100)}% confidence at this ` +
        'level of spending. Lower the spend, or accept a lower confidence.',
    );
    return { value: null, achievedProbability: probability(hi, verifyRuns), confidence, searchRuns, verifyRuns, iterations: 0, elapsedMs: Date.now() - started, notes };
  }
  let iterations = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    iterations += 1;
    if (probability(mid, searchRuns) >= confidence) hi = mid;
    else lo = mid + 1;
  }
  return {
    value: lo,
    achievedProbability: probability(lo, verifyRuns),
    confidence,
    searchRuns,
    verifyRuns,
    iterations,
    elapsedMs: Date.now() - started,
    notes,
  };
}
