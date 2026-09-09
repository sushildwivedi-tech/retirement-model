import { project, type Datasets } from './engine';
import { toRealRow } from './report';
import type { ProjectionResult, Ruleset, Scenario } from './types';

export interface ScenarioOutcome {
  label: string;
  /** Age the household's own money runs out, or null if it lasts the whole plan. */
  runsOutAge: number | null;
  /**
   * Years gained against the baseline. Positive is better. Null when either side never
   * runs out, because "how many years later than never" is not a number.
   */
  deltaYears: number | null;
  /** True when this variant lasts the whole plan and the baseline did not. */
  fixesIt: boolean;
  /** What is left at the end of the plan, in today's dollars, including the home. */
  estateReal: number;
  /** Unfunded spending inside the bridge to super access, nominal. */
  bridgeShortfall: number;
}

function summarise(label: string, r: ProjectionResult, baselineAge: number | null): ScenarioOutcome {
  const last = r.rows.at(-1);
  return {
    label,
    runsOutAge: r.moneyRunsOutAge,
    deltaYears:
      r.moneyRunsOutAge === null || baselineAge === null ? null : r.moneyRunsOutAge - baselineAge,
    fixesIt: r.moneyRunsOutAge === null && baselineAge !== null,
    estateReal: last ? toRealRow(last).balances.total : 0,
    bridgeShortfall: r.bridge.reduce((a, b) => a + b.shortfall, 0),
  };
}

/**
 * Run a baseline and a set of variants, and report what each one is worth.
 *
 * Deliberately deterministic: one projection is well under a millisecond, so a whole
 * table of levers recomputes instantly on every edit. Monte Carlo would be more honest
 * about uncertainty but far too slow to sit behind a live table - the success
 * probability is a separate, explicit action.
 */
export function compareScenarios(
  baseline: Scenario,
  variants: Array<{ label: string; scenario: Scenario }>,
  ruleset: Ruleset,
  datasets: Datasets = {},
): { baseline: ScenarioOutcome; outcomes: ScenarioOutcome[] } {
  const base = project(baseline, ruleset, datasets);
  const baseAge = base.moneyRunsOutAge;
  return {
    baseline: summarise('Current plan', base, baseAge),
    outcomes: variants.map((v) => summarise(v.label, project(v.scenario, ruleset, datasets), baseAge)),
  };
}
