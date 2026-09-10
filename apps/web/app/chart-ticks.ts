/**
 * Ticks every five years, plus the first and last age.
 *
 * Recharts labels every category by default, which at a fifty-year plan puts fifty
 * labels on an axis a few hundred pixels wide and they overlap into a grey smear.
 */
export function fiveYearTicks(ages: number[]): number[] {
  if (ages.length === 0) return [];
  const first = ages[0];
  const last = ages[ages.length - 1];
  const ticks = new Set<number>([first, last]);
  for (let a = Math.ceil(first / 5) * 5; a <= last; a += 5) ticks.add(a);
  // The first label and the first multiple of five can end up on top of each other.
  if (ticks.has(first + 1) || ticks.has(first + 2)) ticks.delete(first);
  return [...ticks].sort((a, b) => a - b);
}
