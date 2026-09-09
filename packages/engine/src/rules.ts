import type { PreservationAgeBand, Ruleset } from './types';

/**
 * Preservation age from date of birth, per the ATO table carried in the ruleset.
 *
 * The table is ordered but not assumed to be: each band is matched on its own
 * `bornFrom` / `bornBefore` bounds, so a reordered or extended table still works.
 */
export function preservationAge(dateOfBirth: string, bands: PreservationAgeBand[]): number {
  const dob = Date.parse(dateOfBirth);
  if (Number.isNaN(dob)) {
    throw new Error(`preservationAge: unparseable date of birth "${dateOfBirth}"`);
  }
  for (const band of bands) {
    const afterStart = band.bornFrom === undefined || dob >= Date.parse(band.bornFrom);
    const beforeEnd = band.bornBefore === undefined || dob < Date.parse(band.bornBefore);
    if (afterStart && beforeEnd) return band.preservationAge;
  }
  throw new Error(`preservationAge: no band matched date of birth "${dateOfBirth}"`);
}

/** Every value in the ruleset that is not `sourced`, for surfacing in the UI. */
export function unsourcedValues(ruleset: unknown, path = ''): string[] {
  if (ruleset === null || typeof ruleset !== 'object') return [];
  const node = ruleset as Record<string, unknown>;
  if ('status' in node && 'value' in node) {
    return node.status === 'sourced' ? [] : [`${path} (${String(node.status)})`];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    unsourcedValues(child, path ? `${path}.${key}` : key),
  );
}

/** Fails loudly rather than letting an unpriced rule silently read as zero. */
export function assertUsable(ruleset: Ruleset): void {
  const required: Array<[string, { status: string }]> = [
    ['super.guaranteeRate', ruleset.super.guaranteeRate],
    ['super.maximumContributionBaseAnnual', ruleset.super.maximumContributionBaseAnnual],
    ['super.concessionalCap', ruleset.super.concessionalCap],
    ['super.preservationAgeByDateOfBirth', ruleset.super.preservationAgeByDateOfBirth],
    ['super.downsizerContribution.minimumAge', ruleset.super.downsizerContribution.minimumAge],
  ];
  const bad = required.filter(([, v]) => v.status === 'unsourced').map(([k]) => k);
  if (bad.length > 0) {
    throw new Error(`Ruleset ${ruleset.id} has unsourced values the engine depends on: ${bad.join(', ')}`);
  }
}
