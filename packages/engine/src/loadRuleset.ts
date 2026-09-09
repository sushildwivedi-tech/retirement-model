import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Ruleset } from './types';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Load a dated ruleset from `/rules`. Kept out of `engine.ts` so the projection
 * itself stays pure and portable to the browser.
 */
export function loadRuleset(id: string): Ruleset {
  const path = resolve(here, '../../../rules', `${id}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as Ruleset;
}

/** Load a dataset from `/data` (life tables, health-cost curve). */
export function loadDataset<T>(id: string): T {
  const path = resolve(here, '../../../data', `${id}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}
