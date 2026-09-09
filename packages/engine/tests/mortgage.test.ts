import { describe, expect, it } from 'vitest';
import { advanceMortgage, annualRepaymentFor } from '../src/mortgage';
import { project } from '../src/engine';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import { baseCase } from '../src/fixtures/baseCase';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};

const withLoan = (over: Partial<NonNullable<Scenario['household']['mortgage']>> = {}): Scenario => ({
  ...baseCase,
  household: {
    ...baseCase.household,
    mortgage: {
      balance: 400_000,
      interestRate: 0.062,
      remainingYears: 20,
      offsetBalance: 0,
      ...over,
    },
  },
});

describe('repayment arithmetic', () => {
  it('amortises to zero over the term', () => {
    const B = 400_000;
    const r = 0.062;
    const n = 20;
    const pmt = annualRepaymentFor(B, r, n);
    let bal = B;
    for (let i = 0; i < n; i++) bal = bal + bal * r - pmt;
    expect(bal).toBeCloseTo(0, 4);
  });

  it('is simple division when the rate is zero', () => {
    expect(annualRepaymentFor(100_000, 0, 10)).toBeCloseTo(10_000, 6);
  });

  it('is nothing when there is nothing owing', () => {
    expect(annualRepaymentFor(0, 0.06, 20)).toBe(0);
  });

  it('costs more in total the longer the term', () => {
    const short = annualRepaymentFor(400_000, 0.062, 10) * 10;
    const long = annualRepaymentFor(400_000, 0.062, 30) * 30;
    expect(long).toBeGreaterThan(short);
  });
});

describe('one year of a loan', () => {
  it('charges interest on the balance and reduces it by the rest of the repayment', () => {
    const y = advanceMortgage(400_000, 0, { interestRate: 0.062 }, 35_000);
    expect(y.interest).toBeCloseTo(24_800, 2);
    expect(y.principalRepaid).toBeCloseTo(10_200, 2);
    expect(y.closingBalance).toBeCloseTo(389_800, 2);
  });

  it('charges interest only on the balance NET of the offset', () => {
    const y = advanceMortgage(400_000, 100_000, { interestRate: 0.062 }, 35_000);
    expect(y.interest).toBeCloseTo(300_000 * 0.062, 2);
    expect(y.interestSavedByOffset).toBeCloseTo(100_000 * 0.062, 2);
    // The saved interest goes to principal instead, so the loan falls faster.
    expect(y.principalRepaid).toBeCloseTo(35_000 - 300_000 * 0.062, 2);
  });

  it('pays the loan out of the offset once the offset covers it', () => {
    const y = advanceMortgage(50_000, 60_000, { interestRate: 0.062 }, 35_000);
    expect(y.clearedThisYear).toBe(true);
    expect(y.closingBalance).toBe(0);
    expect(y.offsetUsedToClear).toBeGreaterThan(0);
  });

  it('never repays more than is owed', () => {
    const y = advanceMortgage(5_000, 0, { interestRate: 0.062 }, 35_000);
    expect(y.repayment).toBeCloseTo(5_000 + 5_000 * 0.062, 2);
    expect(y.closingBalance).toBe(0);
  });

  it('does nothing once the loan is gone', () => {
    const y = advanceMortgage(0, 10_000, { interestRate: 0.062 }, 35_000);
    expect(y.interest).toBe(0);
    expect(y.repayment).toBe(0);
  });
});

describe('a mortgage inside the projection', () => {
  const r = project(withLoan(), ruleset, datasets);
  const at = (age: number) => r.rows.find((x) => x.ages.you === age)!;

  it('charges the repayment as a spending line, not as a transfer', () => {
    // Build plan 2.2: repayments are spending that ends when the loan does.
    expect(at(42).spending.mortgage).toBeGreaterThan(0);
    expect(at(42).spending.total).toBeGreaterThan(at(42).spending.baseline);
  });

  it('runs the repayment before retirement too, unlike every other spending line', () => {
    expect(at(42).spending.baseline).toBe(0); // still working
    expect(at(42).spending.mortgage).toBeGreaterThan(0);
  });

  it('clears the loan and reports the age', () => {
    expect(r.mortgagePaidOffAge).toBe(42 + 20);
    expect(at(r.mortgagePaidOffAge!).mortgage.balance).toBe(0);
  });

  it('stops the spending line the year after the loan ends', () => {
    const after = at(r.mortgagePaidOffAge! + 1);
    expect(after.spending.mortgage).toBe(0);
    expect(after.mortgage.balance).toBe(0);
  });

  it('leaves the household worse off than having no loan at all', () => {
    const noLoan = project(baseCase, ruleset, datasets);
    expect(r.moneyRunsOutAge!).toBeLessThan(noLoan.moneyRunsOutAge ?? 999);
  });

  it('nets what is still owed off total net worth', () => {
    const noLoan = project(baseCase, ruleset, datasets);
    const owing = at(45).mortgage.balance;
    expect(owing).toBeGreaterThan(0);
    expect(at(45).balances.total).toBeLessThan(
      noLoan.rows.find((x) => x.ages.you === 45)!.balances.total,
    );
  });
});

describe('the offset account', () => {
  const withOffset = project(withLoan({ offsetBalance: 150_000 }), ruleset, datasets);
  const without = project(withLoan({ offsetBalance: 0 }), ruleset, datasets);

  it('saves interest at the loan rate', () => {
    const first = withOffset.rows[0];
    expect(first.mortgage.interestSavedByOffset).toBeCloseTo(150_000 * 0.062, 0);
    expect(without.rows[0].mortgage.interestSavedByOffset).toBe(0);
  });

  it('clears the loan years earlier', () => {
    expect(withOffset.mortgagePaidOffAge!).toBeLessThan(without.mortgagePaidOffAge!);
  });

  it('is still an asset - it counts in what the household can spend', () => {
    expect(withOffset.rows[0].balances.offset).toBeGreaterThan(0);
    expect(withOffset.rows[0].balances.accessible).toBeGreaterThan(
      without.rows[0].balances.accessible,
    );
  });

  it('is assessed by the Age Pension like any other financial asset', () => {
    const late = (x: typeof withOffset) => x.rows.find((y) => y.ages.you === 68)!;
    // More assessable assets means a smaller entitlement, all else equal.
    expect(late(withOffset).agePensionDetail.deemedIncome).toBeGreaterThanOrEqual(
      late(without).agePensionDetail.deemedIncome,
    );
  });

  it('earns no interest of its own - the return is the interest it avoids', () => {
    // Cash grows at the cash return; the offset does not, which is why it only pays off
    // while a loan exists.
    const noLoanButCash: Scenario = {
      ...baseCase,
      household: { ...baseCase.household, cash: 150_000 },
    };
    const cashRun = project(noLoanButCash, ruleset, datasets);
    expect(cashRun.rows[0].balances.cash).toBeGreaterThan(150_000);
    expect(withOffset.rows[0].balances.offset).toBeCloseTo(150_000, 0);
  });
});

describe('what happens to the offset once the loan is gone', () => {
  it('moves the balance to cash rather than leaving it earning nothing', () => {
    const r = project(
      withLoan({ balance: 100_000, remainingYears: 5, offsetBalance: 80_000 }),
      ruleset,
      datasets,
    );
    const paidOff = r.mortgagePaidOffAge!;
    expect(paidOff).toBeLessThan(47);
    const year = r.rows.find((x) => x.ages.you === paidOff)!;
    expect(year.balances.offset).toBe(0);
    expect(year.events.join(' ')).toMatch(/earns nothing sitting there|paid out from the offset/);
    // The money is not lost: it is in cash, and from there it compounds.
    const after = r.rows.find((x) => x.ages.you === paidOff + 1)!;
    expect(after.balances.cash).toBeGreaterThan(0);
  });

  it('warns when the offset is bigger than the loan, because the excess earns nothing', () => {
    const r = project(
      withLoan({ balance: 100_000, offsetBalance: 250_000 }),
      ruleset,
      datasets,
    );
    expect(r.warnings.join(' ')).toMatch(/larger than the loan/);
    expect(r.warnings.join(' ')).toMatch(/excess earns nothing/);
  });

  it('caps the interest saving at the amount owing', () => {
    const over = project(withLoan({ balance: 100_000, offsetBalance: 250_000 }), ruleset, datasets);
    // Saving is 6.2% of 100,000, not of 250,000.
    expect(over.rows[0].mortgage.interestSavedByOffset).toBeCloseTo(100_000 * 0.062, 0);
    expect(over.rows[0].mortgage.interest).toBe(0);
  });
});
