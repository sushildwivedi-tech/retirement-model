import type { Mortgage } from './types';

/**
 * The level annual repayment that clears a loan over its remaining term.
 *
 * Standard amortisation. Note this is derived WITHOUT reference to the offset balance,
 * because that is how a lender sets it: holding an offset does not reduce your minimum
 * repayment, it just means more of each repayment goes to principal.
 */
export function annualRepaymentFor(balance: number, rate: number, years: number): number {
  if (balance <= 0 || years <= 0) return 0;
  if (rate <= 0) return balance / years;
  return (balance * rate) / (1 - Math.pow(1 + rate, -years));
}

export interface MortgageYear {
  interest: number;
  /** Interest the offset balance avoided this year. */
  interestSavedByOffset: number;
  repayment: number;
  principalRepaid: number;
  closingBalance: number;
  /** True when the loan was cleared this year. */
  clearedThisYear: boolean;
  /** Offset money used to extinguish the last of the loan. */
  offsetUsedToClear: number;
}

/**
 * Advance a home loan by one year.
 *
 * Interest is charged on the balance NET of the offset, which is the whole mechanic:
 * a dollar in the offset saves a dollar of interest at the loan rate, and does so
 * tax-free, because interest you never incurred cannot be taxed.
 *
 * When the offset balance covers what is left, the loan is paid out from it. That is what
 * people actually do, and it is what makes the offset's benefit show up as an earlier
 * payoff rather than a lower repayment.
 */
export function advanceMortgage(
  balance: number,
  offset: number,
  m: Pick<Mortgage, 'interestRate'>,
  repayment: number,
): MortgageYear {
  if (balance <= 0) {
    return {
      interest: 0,
      interestSavedByOffset: 0,
      repayment: 0,
      principalRepaid: 0,
      closingBalance: 0,
      clearedThisYear: false,
      offsetUsedToClear: 0,
    };
  }

  const offsetApplied = Math.min(offset, balance);
  const interest = (balance - offsetApplied) * m.interestRate;
  const interestSavedByOffset = offsetApplied * m.interestRate;

  // Never pay more than what is owed including this year's interest.
  const due = balance + interest;
  const paid = Math.min(repayment, due);
  const principalRepaid = Math.max(0, paid - interest);
  let closing = Math.max(0, balance - principalRepaid);

  // If the offset now covers the remainder, clear the loan with it.
  let offsetUsedToClear = 0;
  if (closing > 0 && offset - offsetUsedToClear >= closing) {
    offsetUsedToClear = closing;
    closing = 0;
  }

  return {
    interest,
    interestSavedByOffset,
    repayment: paid,
    principalRepaid,
    closingBalance: closing,
    clearedThisYear: closing === 0,
    offsetUsedToClear,
  };
}
