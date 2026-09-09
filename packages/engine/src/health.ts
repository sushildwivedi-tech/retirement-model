import type { HealthCostCurve } from './types';

/**
 * Out-of-pocket health cost for one person at one age, in the data's own dollars.
 *
 * The curve's SHAPE comes from AIHW system spending per person by age band; its LEVEL
 * comes from the AIHW's average out-of-pocket spend per person. Bands are interpolated
 * linearly between their midpoints so the curve does not step.
 */
export function outOfPocketAtAge(curve: HealthCostCurve, age: number): number {
  return curve.outOfPocketPerPerson2023_24 * healthIndexAtAge(curve, age);
}

/** The age index itself, where 1.0 is the all-ages average. */
export function healthIndexAtAge(curve: HealthCostCurve, age: number): number {
  const pts = curve.bands
    .map((b) => ({ age: b.midpointAge, index: b.index }))
    .sort((a, b) => a.age - b.age);
  if (age <= pts[0].age) return pts[0].index;
  const last = pts[pts.length - 1];
  if (age >= last.age) return last.index;
  for (let i = 1; i < pts.length; i++) {
    if (age <= pts[i].age) {
      const a = pts[i - 1];
      const b = pts[i];
      const w = (age - a.age) / (b.age - a.age);
      return a.index + w * (b.index - a.index);
    }
  }
  return last.index;
}

/**
 * Phased retirement spending: real spending falls through retirement.
 *
 * The build plan's default profile is 100% to 75 ("go-go"), 85% from 75 to 85
 * ("slow-go"), 75% from 85 ("no-go"). Health costs are deliberately NOT folded in here -
 * they rise as this falls, and the plan asks for them as a separate line so the two are
 * visible against each other.
 */
export interface SpendingPhase {
  fromAge: number;
  multiplier: number;
}

export const DEFAULT_SPENDING_PHASES: SpendingPhase[] = [
  { fromAge: 0, multiplier: 1.0 },
  { fromAge: 75, multiplier: 0.85 },
  { fromAge: 85, multiplier: 0.75 },
];

export function spendingMultiplier(age: number, phases: SpendingPhase[]): number {
  let m = 1;
  for (const p of [...phases].sort((a, b) => a.fromAge - b.fromAge)) {
    if (age >= p.fromAge) m = p.multiplier;
  }
  return m;
}
