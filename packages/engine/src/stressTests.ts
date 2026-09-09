import { project, type Datasets } from './engine';
import type { ProjectionResult, ReturnDraw, Ruleset, Scenario } from './types';

/**
 * A named run of actual historical returns, e.g. "retiring in 1973".
 *
 * NO SEQUENCES ARE SHIPPED. The build plan asks for replays of real Australian and global
 * return sequences, and a plausible-looking series invented here would be worse than none -
 * the whole point of a historical stress test is that the numbers actually happened.
 *
 * To add one, drop a file in `/data` holding, for each year of the sequence, the annual
 * return for cash, outside-super investments, super and housing, with its source and
 * retrieval date like every other dataset. A suitable primary source is an accumulation
 * index series (total return, not price) plus a cash rate series covering the same years.
 * The RBA's statistical tables were renumbered and the share-market table could not be
 * located on 2026-09-09; the ASX historical market statistics pages are the other option.
 */
export interface HistoricalSequence {
  id: string;
  label: string;
  startYear: number;
  source: string;
  url: string;
  retrievedAt: string;
  /** One entry per year of the sequence. */
  returns: ReturnDraw[];
}

export const SHIPPED_SEQUENCES: HistoricalSequence[] = [];

export interface StressTestResult {
  id: string;
  label: string;
  result: ProjectionResult;
  /** Years the sequence covers; the projection reverts to the fixed assumption after. */
  sequenceYears: number;
}

/**
 * Replay a historical return sequence through the projection.
 *
 * If the sequence is shorter than the plan, the remaining years fall back to the
 * scenario's fixed return assumptions - which the result reports, so a 20-year sequence
 * is not mistaken for a 50-year one.
 */
export function runHistoricalSequence(
  scenario: Scenario,
  ruleset: Ruleset,
  sequence: HistoricalSequence,
  datasets: Datasets = {},
): StressTestResult {
  return {
    id: sequence.id,
    label: sequence.label,
    sequenceYears: sequence.returns.length,
    result: project(scenario, ruleset, datasets, { returns: sequence.returns }),
  };
}

/**
 * A crash in the first year of retirement - the sequence-risk case that does not need
 * historical data to be worth running, because it is a "what if" rather than a "what was".
 */
export function crashInFirstRetirementYear(
  scenario: Scenario,
  ruleset: Ruleset,
  datasets: Datasets = {},
  options: { drop?: number } = {},
): StressTestResult {
  const drop = options.drop ?? -0.3;
  const first = scenario.household.people[0];
  const offset = Math.min(...scenario.household.people.map((p) => p.retirementAge - p.currentAge));
  const years = scenario.assumptions.planToAge - first.currentAge + 1;
  const returns: ReturnDraw[] = [];
  for (let t = 0; t < years; t++) {
    const crash = t === offset;
    returns.push({
      cash: scenario.assumptions.returns.cash,
      investments: crash ? drop : scenario.assumptions.returns.investments,
      superAccumulation: crash ? drop : scenario.assumptions.returns.superAccumulation,
      primaryResidence: crash ? drop / 3 : scenario.assumptions.returns.primaryResidence,
    });
  }
  return {
    id: 'crash-year-one',
    label: `${Math.round(drop * 100)}% crash in the first year of retirement`,
    sequenceYears: years,
    result: project(scenario, ruleset, datasets, { returns }),
  };
}
