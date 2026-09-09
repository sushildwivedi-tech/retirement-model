import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { HealthCostCurve, LifeTables, Ruleset } from '@retirement/engine';
import Planner from '../planner';

const RULESET_ID = 'au-2026-07';

/** Walk up from the process cwd to find a file in the repo's `/rules` or `/data`. */
function findFile(dirName: string, id: string): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = resolve(dir, dirName, `${id}.json`);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find ${dirName}/${id}.json above ${process.cwd()}`);
}

const read = <T,>(dirName: string, id: string): T =>
  JSON.parse(readFileSync(findFile(dirName, id), 'utf-8')) as T;

/**
 * The workings: balances and spending over time, longevity, the year-by-year table, and
 * everything the model does not cover. Inputs are shared with the front page through the
 * same browser-local store, so switching pages keeps whatever you have entered.
 */
export default function Page() {
  return (
    <Planner
      ruleset={read<Ruleset>('rules', RULESET_ID)}
      lifeTables={read<LifeTables>('data', 'au-life-tables-2020-22')}
      healthCostCurve={read<HealthCostCurve>('data', 'au-health-cost-curve')}
      view="detail"
    />
  );
}
