import type { ProjectionResult, YearRow } from './types';

/** Fields that are not dollar amounts and must survive deflation untouched. */
const NOT_MONEY = new Set(['planYear', 'calendarYear', 'cpiIndex', 'ages', 'events', 'bindingTest']);

function deflate<T>(node: T, divisor: number): T {
  if (typeof node === 'number') return (Math.round((node / divisor) * 100) / 100) as T;
  if (Array.isArray(node) || node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = NOT_MONEY.has(k) ? v : deflate(v, divisor);
  }
  return out as T;
}

/**
 * Deflate a nominal year row to today's dollars, for the real/nominal toggle.
 *
 * Walks the row rather than listing its fields, so adding a line item to `YearRow`
 * does not silently leave that item in nominal dollars.
 */
export function toRealRow(row: YearRow): YearRow {
  return deflate(row, row.cpiIndex);
}

export function toReal(result: ProjectionResult): ProjectionResult {
  return { ...result, rows: result.rows.map(toRealRow) };
}

export function toCsv(result: ProjectionResult, real = false): string {
  const rows = real ? result.rows.map(toRealRow) : result.rows;
  const personIds = Object.keys(result.rows[0]?.ages ?? {});
  const cols: Array<[string, (r: YearRow) => number | string]> = [
    ['calendarYear', (r) => r.calendarYear],
    ...personIds.map(
      (id) => [`age_${id}`, (r: YearRow) => r.ages[id]] as [string, (r: YearRow) => number],
    ),
    ['salary', (r) => r.income.salary],
    ['investmentIncome', (r) => r.income.investmentIncome],
    ['agePension', (r) => r.agePension],
    ['agePensionBindingTest', (r) => r.agePensionDetail.bindingTest],
    ['deemedIncome', (r) => r.agePensionDetail.deemedIncome],
    ['sgContribution', (r) => r.contributions.superGuarantee],
    ['voluntaryContribution', (r) => r.contributions.voluntary],
    ['downsizerContribution', (r) => r.contributions.downsizer],
    ['contributionsTax', (r) => r.contributions.contributionsTax],
    ['savings', (r) => r.savings],
    ['spending', (r) => r.spending.total],
    ['personalTax', (r) => r.tax.personal],
    ['medicareLevy', (r) => r.tax.medicareLevy],
    ['taxOffsets', (r) => r.tax.offsets],
    ['superEarningsTax', (r) => r.tax.superEarnings],
    ['realisedCapitalGain', (r) => r.realisedCapitalGain],
    ['drawdownCash', (r) => r.drawdown.cash],
    ['drawdownInvestments', (r) => r.drawdown.investments],
    ['drawdownSuperPension', (r) => r.drawdown.superPension],
    ['drawdownSuperAccum', (r) => r.drawdown.superAccumulation],
    ['minimumPensionPayment', (r) => r.income.superPensionPayments],
    ['balCash', (r) => r.balances.cash],
    ['balInvestments', (r) => r.balances.investments],
    ['balSuperAccum', (r) => r.balances.superAccumulation],
    ['balSuperPension', (r) => r.balances.superPension],
    ['balHome', (r) => r.balances.primaryResidence],
    ['balTotal', (r) => r.balances.total],
    ['balAccessible', (r) => r.balances.accessible],
    ['shortfall', (r) => r.shortfall],
  ];
  return [
    cols.map(([h]) => h).join(','),
    ...rows.map((r) => cols.map(([, f]) => f(r)).join(',')),
  ].join('\n');
}
