/**
 * Phase 1 domain types.
 *
 * Everything is nominal (future dollars) inside the engine. Each year records the
 * CPI index that applies to it so a caller can deflate to today's dollars for the
 * real/nominal toggle - see `toRealRow` in `report.ts`.
 */

/** A leaf value in a dated ruleset, carrying its provenance. */
export interface SourcedValue<T> {
  value: T;
  status: 'sourced' | 'assumed' | 'unsourced';
  source: string | null;
  url?: string | null;
  retrievedAt?: string | null;
}

export interface PreservationAgeBand {
  bornFrom?: string;
  bornBefore?: string;
  preservationAge: number;
}

export interface TaxBracket {
  /** Upper bound of the bracket; null for the top bracket. */
  upTo: number | null;
  base: number;
  rate: number;
  over: number;
}

export interface SaptoBand {
  maxOffset: number;
  shadeOutThreshold: number;
  cutOutThreshold: number;
}

export interface DrawdownBand {
  fromAge: number;
  percent: number;
}

/** The subset of `rules/au-YYYY-MM.json` the engine reads. */
export interface Ruleset {
  id: string;
  financialYear: string;
  effectiveDate: string;
  retrievedAt: string;
  super: {
    guaranteeRate: SourcedValue<number>;
    maximumContributionBaseAnnual: SourcedValue<number>;
    concessionalCap: SourcedValue<number>;
    generalTransferBalanceCap: SourcedValue<number>;
    contributionsTaxConcessional: SourcedValue<number>;
    earningsTaxAccumulation: SourcedValue<number>;
    earningsTaxPensionPhase: SourcedValue<number>;
    minimumDrawdownPercentByAge: SourcedValue<DrawdownBand[] | null>;
    preservationAgeByDateOfBirth: SourcedValue<PreservationAgeBand[]>;
    downsizerContribution: {
      minimumAge: SourcedValue<number>;
      capPerPerson: SourcedValue<number>;
      minimumOwnershipYears: SourcedValue<number>;
    };
  };
  incomeTax: {
    brackets: SourcedValue<TaxBracket[]>;
    medicareLevyRate: SourcedValue<number>;
    medicareLevyLowIncomeThresholds: SourcedValue<{
      shadeInRate: number;
      single: { lower: number; upper: number };
      singleWithSapto: { lower: number; upper: number };
    }>;
    lowIncomeTaxOffset: SourcedValue<{
      maxOffset: number;
      fullOffsetUpTo: number;
      firstTaper: number;
      firstTaperTo: number;
      secondTaperOffsetAt: number;
      secondTaper: number;
      cutOut: number;
    }>;
    seniorsAndPensionersTaxOffset: SourcedValue<{
      taperRate: number;
      single: SaptoBand;
      couplePartnerEach: SaptoBand;
      illnessSeparatedEach: SaptoBand;
    }>;
  };
  capitalGains: {
    discountRate: SourcedValue<number>;
    minimumHoldingMonths: SourcedValue<number>;
  };
  agePension: {
    rateEffectiveDate: SourcedValue<string>;
    eligibilityAge: SourcedValue<number>;
    fortnightsPerYear: SourcedValue<number>;
    maxRateFortnight: SourcedValue<{
      single: { total: number };
      coupleEach: { total: number };
      coupleCombined: { total: number };
    }>;
    incomeTest: SourcedValue<{
      freeAreaFortnight: { single: number; coupleCombined: number };
      taperPerDollar: { single: number; coupleCombinedTotal: number };
      cutOffFortnight: { single: number; coupleCombined: number };
    }>;
    assetsTest: SourcedValue<{
      fullPensionLimit: {
        singleHomeowner: number;
        singleNonHomeowner: number;
        coupleHomeownerCombined: number;
        coupleNonHomeownerCombined: number;
      };
      cutOff: {
        singleHomeowner: number;
        singleNonHomeowner: number;
        coupleHomeownerCombined: number;
        coupleNonHomeownerCombined: number;
      };
      taperPerThousandPerFortnight: number;
    }>;
    deeming: SourcedValue<{
      lowerRate: number;
      upperRate: number;
      threshold: {
        single: number;
        coupleCombinedAtLeastOnePensioner: number;
        coupleNeitherPensionerEach: number;
      };
    }>;
    workBonus: SourcedValue<{ creditPerFortnight: number; maximumBalance: number }>;
  };
  agedCare: {
    basicDailyFeePerDay: SourcedValue<number>;
    hotellingContributionMaxPerDay: SourcedValue<number>;
    nonClinicalCareContributionMaxPerDay: SourcedValue<number>;
    nonClinicalCareLifetimeCap: SourcedValue<number>;
    nonClinicalCareMaxYears: SourcedValue<number>;
  };
  privateHealthInsurance: {
    premiumGrowthRate: SourcedValue<number>;
    latestApprovedIncrease: SourcedValue<number>;
  };
}

export interface LifeTableRow {
  age: number;
  /** Probability of dying within one year at that age. */
  qx: number;
  /** Complete expectation of life, in years. */
  ex: number;
}
export type LifeTable = LifeTableRow[];

export interface LifeTables {
  id: string;
  source: string;
  url: string;
  retrievedAt: string;
  transformation: string;
  tables: { male: LifeTable; female: LifeTable };
}

export interface HealthCostCurve {
  id: string;
  sources: Array<{ what: string; who: string; url: string }>;
  transformation: string;
  assumption: string;
  nationalAveragePerPerson2018_19: number;
  outOfPocketPerPerson2023_24: number;
  bands: Array<{ label: string; midpointAge: number; spendPerPerson2018_19: number; index: number }>;
}

export interface Person {
  id: string;
  name: string;
  /** ISO date, e.g. "1984-03-15". Drives preservation age. */
  dateOfBirth: string;
  /** Age at the start of the plan. */
  currentAge: number;
  /** Age at which salary stops. */
  retirementAge: number;
  /** Gross annual salary in today's dollars at the plan start. */
  salary: number;
  /** Nominal wage growth, e.g. 0.035. */
  wageGrowth: number;
  /** Super accumulation balance at plan start. */
  superBalance: number;
  /**
   * What the employer actually puts into super each year, in today's dollars, when that
   * is more than the legislated minimum - 15.4% in much of the public service, or a
   * package that names a figure. Indexed with wages, like the salary it accompanies.
   *
   * Leave it undefined for an employer paying the super guarantee and no more, which is
   * the ordinary case: the projection then works the guarantee out itself, including its
   * cut-off at the maximum contribution base. A value below the legislated minimum is
   * lifted to it - an employer cannot pay less.
   */
  employerSuperContribution?: number;
  /** Additional salary-sacrifice / personal deductible contributions per year, today's dollars. */
  voluntarySuperContribution?: number;
  /**
   * Which life table applies. Presented as "gender" in the UI; the field keeps the term
   * the data uses, because the Australian Life Tables are published by sex and a person
   * choosing a table is choosing which published table best fits them.
   *
   * Not supplied by default - the caller must choose, and the difference is material:
   * life expectancy at 65 is 20.3 years for males and 22.9 for females on the 2020-22
   * tables.
   */
  sex?: 'male' | 'female';
  /**
   * Part-time or consulting work after retiring. Amount is in today's dollars and is
   * indexed to CPI; it runs from `fromAge` up to but not including `toAge`.
   *
   * It is employment income, so it counts against the Age Pension income test and is
   * eligible for the Work Bonus. It does NOT attract the super guarantee here, because
   * this kind of work is usually contracting rather than employment - if it is really a
   * salaried part-time job, model it by lowering `salary` and raising `retirementAge`.
   */
  partTimeIncome?: { amount: number; fromAge: number; toAge: number };
}

/**
 * A home loan with an optional offset account.
 *
 * The build plan (section 2.2) is explicit about the treatment: repayments are modelled
 * as a SPENDING LINE that ends when the loan does, rather than netted against assets.
 * That keeps the cash-flow honest - a household with a mortgage really does have to find
 * the repayment each year, and the year it ends is a real step down in spending.
 */
export interface Mortgage {
  /** Amount owing at the plan start. */
  balance: number;
  /** Annual nominal interest rate, e.g. 0.062. */
  interestRate: number;
  /** Years left on the loan, used to derive the repayment when one is not given. */
  remainingYears: number;
  /**
   * Annual repayment. Derived from balance, rate and term when omitted - which is what a
   * lender does: the minimum repayment is set on the loan itself and does NOT fall
   * because you hold an offset balance. The offset's benefit shows up as an earlier
   * payoff, not a smaller repayment.
   */
  annualRepayment?: number;
  /**
   * Offset account balance. Reduces the interest charged, pound for pound, but is still
   * your money: it counts as an asset here and in the Age Pension tests.
   *
   * It deliberately earns no interest of its own - that is the whole point of an offset.
   * The return it earns is the loan interest it avoids, which is also untaxed, making it
   * worth more than the same balance sitting in a taxable savings account.
   */
  offsetBalance: number;
}

export interface Household {
  people: Person[];
  homeOwner: boolean;
  /**
   * Household spending after the first death, as a share of the couple's spending.
   * The build plan's default is 0.70 - two people do not cost twice one.
   */
  spendingStepDownOnFirstDeath?: number;
  /**
   * Share of outside-super assets owned by each person, for tax. Keys are person ids and
   * values must sum to 1. Defaults to an equal split, which is a modelling assumption:
   * real ownership is whatever the holdings actually say, and skewing it toward the
   * lower earner reduces tax.
   */
  outsideSuperOwnership?: Record<string, number>;
  /** Outside-super liquid cash at plan start. */
  cash: number;
  /** Outside-super shares/ETFs/managed funds at plan start. */
  investments: number;
  /**
   * Cost base of `investments` at plan start, for CGT on drawdown. Defaults to the
   * full value (i.e. no unrealised gain) when omitted, which understates future CGT.
   */
  investmentsCostBase?: number;
  /** Primary residence value at plan start. Zero if renting. */
  primaryResidence: number;
  /** Total saved into `investments` each year while anyone is still working, today's dollars. */
  annualSavings: number;
  /** Household spending target from the first retirement onward, today's dollars. */
  retirementSpending: number;
  /** Home loan, if any. Repayments run whether or not anyone has retired. */
  mortgage?: Mortgage;
}

export interface HealthAssumptions {
  /** Model the age-shaped out-of-pocket health cost curve as a separate spending line. */
  includeHealthCosts: boolean;
  /**
   * Scale on the AIHW out-of-pocket level. 1.0 is the national average; someone with
   * chronic conditions or a preference for private care spends more.
   */
  outOfPocketMultiplier: number;
  /** Annual private health insurance premium in today's dollars. Zero if uninsured. */
  privateHealthInsurancePremium: number;
  /** Health costs index faster than CPI; PHI has its own, faster index again. */
  healthInflation: number;
  privateHealthInsuranceInflation: number;
}

export interface AgedCareAssumptions {
  /** Residential aged care as a deterministic stress test: from this age, for this long. */
  enabled: boolean;
  fromAge: number;
  years: number;
  /**
   * Annual room cost in today's dollars. Taken as a direct input rather than derived
   * from a room price, because the MPIR needed for that conversion could not be sourced.
   */
  annualAccommodationCost: number;
  /** Whether the person is assessed as paying the full means-tested contributions. */
  payFullMeansTestedContributions: boolean;
}

/** Which bucket to draw on first when spending exceeds income. */
export type DrawdownStrategy =
  /** Cash, then outside-super investments, then super. Preserves tax-free super longest. */
  | 'outsideSuperFirst'
  /** Accessible super first, leaving outside-super assets intact. */
  | 'superFirst'
  /** Pro-rata across every accessible bucket, keeping the mix stable. */
  | 'proportional'
  /** Hold N years of spending in cash, spend from it, and refill it in good years. */
  | 'cashBuffer';

export interface GlidePathStep {
  fromAge: number;
  /** Expected nominal return on super from this age. */
  expectedReturn: number;
  /** Standard deviation of that return, used by Monte Carlo. */
  volatility: number;
  label: string;
}

export interface Assumptions {
  /** Nominal CPI, e.g. 0.025 (RBA target midpoint). */
  cpi: number;
  /**
   * Share of the outside-super investment return paid out as taxable income (dividends
   * and distributions) rather than retained as capital growth. Taxed each year at the
   * marginal rate; the remainder is taxed on realisation as a capital gain. Franking
   * credits are NOT modelled, so this overstates tax on Australian shares.
   */
  investmentIncomeYield: number;
  /**
   * Which legislated dollar thresholds move with CPI over the life of the plan.
   *
   * These are split because they are different KINDS of claim. Age Pension rates and
   * super caps really are indexed in legislation, so switching those off models something
   * that does not happen. Personal tax brackets are NOT indexed in law - they move only
   * when Parliament changes them - so indexing them is a judgement call about fifty years
   * of future policy. On the base case that choice is worth about four years of run-out
   * age. Age Pension indexation is worth about ten, but that one is law, not a choice.
   */
  indexation: {
    /** Age Pension rates, limits, deeming thresholds and the Work Bonus. Indexed in law. */
    agePension: boolean;
    /**
     * Personal tax brackets, LITO, SAPTO and the Medicare levy thresholds. NOT indexed in
     * law. On: assumes governments keep the scale roughly steady in real terms. Off:
     * assumes fifty years of unbroken bracket creep with no tax cuts.
     */
    taxBrackets: boolean;
    /** Concessional cap, transfer balance cap, contribution base. Indexed to AWOTE in law. */
    superCaps: boolean;
  };
  /**
   * Convert super to pension phase at the later of retirement and preservation age.
   * Pension-phase earnings are untaxed but a minimum drawdown becomes compulsory.
   */
  convertSuperToPensionPhase: boolean;
  returns: {
    cash: number;
    investments: number;
    superAccumulation: number;
    primaryResidence: number;
  };
  /** Last age of the longest-lived person the plan runs to. */
  planToAge: number;
  /** Real spending falls through retirement; see DEFAULT_SPENDING_PHASES. */
  spendingPhases?: Array<{ fromAge: number; multiplier: number }>;
  health?: HealthAssumptions;
  agedCare?: AgedCareAssumptions;
  /** Defaults to 'outsideSuperFirst'. */
  drawdownStrategy?: DrawdownStrategy;
  /** Years of spending held in cash under the 'cashBuffer' strategy. */
  cashBufferYears?: number;
  /**
   * Shift the super investment option toward defensive with age. Each step replaces the
   * super return and volatility from that age on. A more defensive mix lowers the median
   * outcome but narrows the bad tail - the projection shows both.
   */
  glidePath?: GlidePathStep[];
  /** Standard deviation of each bucket's annual return. Only used by Monte Carlo. */
  volatility?: {
    cash: number;
    investments: number;
    superAccumulation: number;
    primaryResidence: number;
  };
  /**
   * Correlation matrix between buckets, in the order
   * [cash, investments, superAccumulation, primaryResidence]. Documented default in
   * DEFAULT_CORRELATIONS; the build plan says a simple default matrix is fine provided
   * it is written down.
   */
  correlations?: number[][];
}

export interface DownsizeEvent {
  kind: 'downsize';
  /** Triggered when this person reaches `atAge`. */
  personId: string;
  atAge: number;
  /** Value of the replacement home in today's dollars; grows with `returns.primaryResidence`. */
  newHomeValue: number;
  /** Agent fees, stamp duty and moving costs as a fraction of the sale price. */
  sellingCostRate: number;
  proceedsTo: 'cash' | 'investments';
}

export interface LumpSumEvent {
  kind: 'lumpSum';
  personId: string;
  atAge: number;
  /** Today's dollars; indexed to CPI by default. */
  amount: number;
  indexed?: boolean;
  into: 'cash' | 'investments';
  label: string;
}

/**
 * A death, as an explicit scenario input rather than something the engine invents.
 * Phase 3 replaces this with sampling from life tables; until then, modelling a first
 * death means choosing when, and that choice belongs to the user.
 */
export interface DeathEvent {
  kind: 'death';
  personId: string;
  atAge: number;
}

/** A one-off expense: a car, a wedding, a roof. */
export interface OneOffExpenseEvent {
  kind: 'expense';
  personId: string;
  atAge: number;
  amount: number;
  indexed?: boolean;
  label: string;
  /** Repeat every N years until the plan ends, e.g. a car every 8 years. */
  repeatEveryYears?: number;
}

export type PlanEvent = DownsizeEvent | LumpSumEvent | DeathEvent | OneOffExpenseEvent;

export interface Scenario {
  name: string;
  /** Calendar year the plan starts, e.g. 2026. */
  startYear: number;
  household: Household;
  assumptions: Assumptions;
  events: PlanEvent[];
}

export interface YearRow {
  planYear: number;
  calendarYear: number;
  ages: Record<string, number>;
  /** Ids of everyone still alive this year. */
  alive: string[];
  cpiIndex: number;
  income: {
    salary: number;
    /** Part-time or consulting income after retirement. */
    partTime: number;
    /** Interest on cash plus dividends and distributions on outside-super investments. */
    investmentIncome: number;
    /** Compulsory minimum pension payments not needed for spending; they land in cash. */
    superPensionPayments: number;
    total: number;
  };
  contributions: {
    superGuarantee: number;
    voluntary: number;
    downsizer: number;
    /** 15% contributions tax withheld in the fund on concessional contributions. */
    contributionsTax: number;
    /** Net of contributions tax - what actually lands in the account. */
    total: number;
  };
  spending: {
    /** CPI-indexed target spending, after the go-go / slow-go / no-go phase multiplier. */
    baseline: number;
    /** Out-of-pocket health costs, age-shaped, indexed at health inflation. */
    health: number;
    /** Private health insurance premiums, indexed at their own faster rate. */
    privateHealthInsurance: number;
    /** Residential aged care fees and accommodation. */
    agedCare: number;
    /** One-off expenses falling in this year. */
    oneOff: number;
    /** Mortgage repayment for the year - a spending line, per build plan section 2.2. */
    mortgage: number;
    total: number;
  };
  agePension: number;
  agePensionDetail: {
    byPerson: Record<string, number>;
    maxRate: number;
    deemedIncome: number;
    assessedIncome: number;
    bindingTest: 'income' | 'assets' | 'none';
  };
  tax: {
    personal: number;
    medicareLevy: number;
    offsets: number;
    superEarnings: number;
    superContributions: number;
    capitalGains: number;
    /** Personal tax payable plus tax levied inside super. */
    total: number;
  };
  /** Realised capital gain on investment drawdown, before the CGT discount. */
  realisedCapitalGain: number;
  drawdown: {
    cash: number;
    investments: number;
    superAccumulation: number;
    superPension: number;
    total: number;
  };
  savings: number;
  events: string[];
  balances: {
    cash: number;
    investments: number;
    /** Cost base of `investments`, carried for CGT. */
    investmentsCostBase: number;
    /** Offset account balance - an asset, even though it earns no interest. */
    offset: number;
    superAccumulation: number;
    superPension: number;
    /** Super by person, both phases combined. */
    superByPerson: Record<string, number>;
    primaryResidence: number;
    total: number;
    /** Balances the household can actually spend this year. */
    accessible: number;
  };
  mortgage: {
    /** Interest charged this year, after the offset is applied. */
    interest: number;
    /** Interest the offset balance avoided. */
    interestSavedByOffset: number;
    principalRepaid: number;
    /** Amount owing at the end of the year. */
    balance: number;
  };
  /** Spending that could not be funded from accessible assets. */
  shortfall: number;
}

export interface BridgePeriod {
  personId: string;
  startAge: number;
  endAge: number;
  years: number;
  /** Total unfunded spending inside the bridge, nominal. */
  shortfall: number;
}

export interface LongevityView {
  personId: string;
  sex: 'male' | 'female';
  /** Complete expectation of life at the person's current age. */
  lifeExpectancyAge: number;
  /** Age only 10% of people alive at the current age will reach. */
  ninetiethPercentileAge: number;
  /** Probability of still being alive at the plan-to age. */
  survivalToPlanEnd: number;
}

/** Per-year sampled returns, supplied by Monte Carlo instead of the fixed assumption. */
export interface ReturnDraw {
  cash: number;
  investments: number;
  superAccumulation: number;
  primaryResidence: number;
}

export interface RunOverrides {
  /** One entry per plan year. Falls back to the deterministic assumption when absent. */
  returns?: ReturnDraw[];
  /** Sampled death ages, keyed by person id. Applied like a death event. */
  deathAgeByPerson?: Record<string, number>;
  /**
   * Rulesets already indexed for each plan year. Monte Carlo precomputes these once and
   * shares them across every run - see the build plan's note about pre-computing rule
   * lookups to hit the performance target.
   */
  indexedRulesets?: Ruleset[];
}

export interface ProjectionResult {
  scenario: string;
  ruleset: string;
  rows: YearRow[];
  /** Age of the first person at the first year with a shortfall, or null if the money lasts. */
  moneyRunsOutAge: number | null;
  moneyRunsOutYear: number | null;
  bridge: BridgePeriod[];
  longevity: LongevityView[];
  /** Age of the first person when the home loan is cleared, or null if it never is. */
  mortgagePaidOffAge: number | null;
  /** Total nominal interest paid over the life of the loan. */
  totalMortgageInterest: number;
  /** Total interest avoided by the offset balance over the life of the loan. */
  totalOffsetInterestSaved: number;
  /** Things the caller must surface in the UI: assumed inputs, ineligibility, cap breaches. */
  warnings: string[];
  /** Parts of the spec deliberately not modelled yet. The UI must show these. */
  notModelled: string[];
}
