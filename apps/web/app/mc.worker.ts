/**
 * Monte Carlo, the solvers, and the auto-run headline, off the main thread.
 *
 * The engine is pure TypeScript with no DOM and no I/O, so it moves here unchanged. What
 * changes is that a 5,000-path run no longer freezes the page for several seconds, and
 * the headline can re-solve on its own after every edit without anyone noticing.
 *
 * Every job carries an id. The page discards results whose id is not the one it is
 * waiting for, which is how a run that has been superseded by another keystroke gets
 * thrown away rather than overwriting a newer answer.
 */
import {
  earliestRetirementAge,
  maxSustainableSpend,
  monteCarlo,
  type Datasets,
  type GoalSeekResult,
  type MonteCarloResult,
  type Ruleset,
  type Scenario,
} from '@retirement/engine';

export type WorkerJob =
  | { id: number; kind: 'simulate'; scenario: Scenario; ruleset: Ruleset; datasets: Datasets; runs: number }
  | { id: number; kind: 'earliestAge'; scenario: Scenario; ruleset: Ruleset; datasets: Datasets; confidence: number; searchRuns: number; runs: number }
  | { id: number; kind: 'maxSpend'; scenario: Scenario; ruleset: Ruleset; datasets: Datasets; confidence: number; searchRuns: number; runs: number };

export type WorkerReply =
  | { id: number; kind: 'simulate'; result: MonteCarloResult }
  | { id: number; kind: 'earliestAge'; result: GoalSeekResult<number> }
  | { id: number; kind: 'maxSpend'; result: GoalSeekResult<number> }
  | { id: number; kind: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerJob>) => {
  const job = e.data;
  try {
    switch (job.kind) {
      case 'simulate': {
        const result = monteCarlo(job.scenario, job.ruleset, job.datasets, {
          runs: job.runs,
          seed: 42,
        });
        (self as unknown as Worker).postMessage({ id: job.id, kind: 'simulate', result } satisfies WorkerReply);
        return;
      }
      case 'earliestAge': {
        const result = earliestRetirementAge(job.scenario, job.ruleset, job.datasets, {
          confidence: job.confidence,
          searchRuns: job.searchRuns,
          runs: job.runs,
          seed: 42,
        });
        (self as unknown as Worker).postMessage({ id: job.id, kind: 'earliestAge', result } satisfies WorkerReply);
        return;
      }
      case 'maxSpend': {
        const result = maxSustainableSpend(job.scenario, job.ruleset, job.datasets, {
          confidence: job.confidence,
          searchRuns: job.searchRuns,
          runs: job.runs,
          seed: 42,
        });
        (self as unknown as Worker).postMessage({ id: job.id, kind: 'maxSpend', result } satisfies WorkerReply);
        return;
      }
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: job.id,
      kind: 'error',
      message: (err as Error).message,
    } satisfies WorkerReply);
  }
};
