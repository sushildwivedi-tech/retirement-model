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

/**
 * Shift everyone's retirement by the same number of YEARS, not to the same age.
 *
 * For one person the two are equivalent. For a couple they are not: setting both to
 * retire "at 55" retires a 42-year-old and a 40-year-old two years apart in calendar
 * time, which is not what anyone means by stopping together. Shifting by years preserves
 * whatever gap the household actually planned - one partner going earlier than the other
 * stays that way - and answers the question a couple is really asking, which is "how much
 * longer do we both have to work?".
 *
 * A negative delay brings retirement forward, so the same search answers "could we stop
 * sooner?" as well as "must we work longer?". Nobody can retire before today, so each
 * person's age is floored at their current age.
 */
const withRetirementDelay = (s: Scenario, years: number): Scenario => {
  const people = s.household.people.map((p) => ({
    ...p,
    retirementAge: Math.max(p.currentAge, p.retirementAge + years),
  }));
  const byId = new Map(people.map((p) => [p.id, p.retirementAge]));
  return {
    ...s,
    household: { ...s.household, people },
    // A downsize scheduled for the old retirement date moves with it, rather than
    // landing years before or after the household actually stops work.
    events: s.events.map((e) => {
      if (e.kind !== 'downsize') return e;
      const retireAt = byId.get(e.personId);
      return retireAt !== undefined && e.atAge < retireAt ? { ...e, atAge: retireAt } : e;
    }),
  };
};

/** The range of delays worth searching: not before today, not past the end of the plan. */
const delayRange = (s: Scenario): { min: number; max: number } => ({
  min: Math.min(...s.household.people.map((p) => p.currentAge - p.retirementAge)),
  max: Math.max(...s.household.people.map((p) => s.assumptions.planToAge - p.retirementAge)),
});

export interface RetirementAgeForPerson {
  personId: string;
  name: string;
  /** Age this person stops work in the earliest workable plan. */
  age: number;
  /** Age they were planning to stop. */
  plannedAge: number;
}

export interface DeterministicRetirementAge {
  /**
   * Earliest workable retirement age for the FIRST person. `people` carries one entry
   * each, which is what a couple needs - a single age cannot describe two people of
   * different ages stopping at the same time.
   */
  age: number | null;
  people: RetirementAgeForPerson[];
  /** The first person's planned age, for comparison. */
  plannedAge: number;
  /** Years later (positive) or earlier (negative) than the current plan, for everyone. */
  yearsFromPlan: number | null;
  /** True when the ages currently planned already work. */
  plannedAgeWorks: boolean;
}

/**
 * The earliest the household can stop work and still have the money last the whole plan,
 * on the central return path.
 *
 * Deterministic, so it is instant - a binary search over about six projections, each well
 * under a millisecond. That is what makes it usable as a headline that updates while you
 * type, where the Monte Carlo version takes seconds.
 *
 * It answers a different question from `earliestRetirementAge`, and a softer one: this is
 * "the age that works if returns behave", not "the age that works most of the time". The
 * probabilistic answer is always later, and the UI should say so.
 *
 * For a couple it shifts both retirements by the same number of years, preserving any gap
 * they planned, and reports the age each of them reaches at that point.
 */
export function earliestRetirementAgeDeterministic(
  scenario: Scenario,
  ruleset: Ruleset,
  datasets: Datasets = {},
): DeterministicRetirementAge {
  const first = scenario.household.people[0];
  const plannedAge = first.retirementAge;
  const lasts = (years: number) =>
    project(withRetirementDelay(scenario, years), ruleset, datasets).moneyRunsOutAge === null;

  const agesAt = (years: number): RetirementAgeForPerson[] =>
    withRetirementDelay(scenario, years).household.people.map((p, i) => ({
      personId: p.id,
      name: p.name,
      age: p.retirementAge,
      plannedAge: scenario.household.people[i].retirementAge,
    }));

  const plannedAgeWorks = lasts(0);
  const { min, max } = delayRange(scenario);
  if (!lasts(max)) {
    return { age: null, people: [], plannedAge, yearsFromPlan: null, plannedAgeWorks };
  }
  // Success is monotonic in how long you keep working, so the first delay that works is
  // the answer.
  let lo = min;
  let hi = max;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lasts(mid)) hi = mid;
    else lo = mid + 1;
  }
  const people = agesAt(lo);
  return {
    age: people[0].age,
    people,
    plannedAge,
    yearsFromPlan: lo,
    plannedAgeWorks,
  };
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
  const to = scenario.assumptions.planToAge;
  const { min, max } = delayRange(scenario);

  const probability = (years: number, runs: number) =>
    monteCarlo(withRetirementDelay(scenario, years), ruleset, datasets, { ...options, runs })
      .successProbability;

  // Binary search over whole years of delay, so a couple shifts together rather than
  // both being forced to the same age.
  let lo = min;
  let hi = max;
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
  const solved = withRetirementDelay(scenario, lo).household.people[0].retirementAge;
  if (scenario.household.people.length > 1) {
    const ages = withRetirementDelay(scenario, lo)
      .household.people.map((p) => `${p.name} at ${p.retirementAge}`)
      .join(', ');
    notes.push(`Both stop together, ${lo === 0 ? 'as planned' : `${lo} years later than planned`}: ${ages}.`);
  }
  return {
    value: solved,
    achievedProbability: probability(lo, verifyRuns),
    confidence,
    searchRuns,
    verifyRuns,
    iterations,
    elapsedMs: Date.now() - started,
    notes,
  };
}
