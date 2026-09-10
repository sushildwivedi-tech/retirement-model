import {
  grossFromTakeHome,
  superGuaranteeOn,
  takeHome,
  type DrawdownStrategy,
  type PayOptions,
  type Ruleset,
  type Scenario,
} from '@retirement/engine';

/** The flat shape the form edits, mapped into a `Scenario` for the engine. */
export interface FormInputs {
  startYear: number;
  birthYear: number;
  currentAge: number;
  retirementAge: number;
  planToAge: number;
  /**
   * Take-home pay per month - what actually lands in the account after tax. This is what
   * the user knows; `salary` is solved back out of it.
   */
  netMonthlyPay: number;
  /** Gross annual salary, calculated from `netMonthlyPay` by running the tax scale backwards. */
  salary: number;
  /**
   * What the employer puts into super each month, as it appears on a payslip. Defaults to
   * the legislated minimum on the salary, and follows it: raise your pay and this moves
   * with it, at whatever rate the two currently imply.
   */
  employerSuperMonthly: number;
  /** Your own contribution into super each month, before tax. `voluntarySuperContribution` x12. */
  personalSuperMonthly: number;
  wageGrowth: number;
  superBalance: number;
  voluntarySuperContribution: number;
  cash: number;
  investments: number;
  primaryResidence: number;
  annualSavings: number;
  retirementSpending: number;
  cpi: number;
  investmentIncomeYield: number;
  returnCash: number;
  returnInvestments: number;
  returnSuper: number;
  returnHome: number;
  includeHealthCosts: boolean;
  outOfPocketMultiplier: number;
  /** Health insurance premium per month, as it is billed; the annual figure is calculated. */
  healthInsuranceMonthly: number;
  /** Health insurance premium per year, calculated from `healthInsuranceMonthly`. */
  privateHealthInsurancePremium: number;
  healthInflation: number;
  phaseGoGoTo: number;
  phaseSlowGoMultiplier: number;
  phaseNoGoFrom: number;
  phaseNoGoMultiplier: number;
  agedCareEnabled: boolean;
  agedCareFromAge: number;
  agedCareYears: number;
  agedCareAccommodation: number;
  sex: 'male' | 'female' | 'unspecified';
  indexAgePension: boolean;
  indexTaxBrackets: boolean;
  indexSuperCaps: boolean;
  drawdownStrategy: DrawdownStrategy;
  cashBufferYears: number;
  glidePath: boolean;
  hasMortgage: boolean;
  mortgageBalance: number;
  mortgageRate: number;
  mortgageYears: number;
  offsetBalance: number;
  partTimeIncome: number;
  partTimeYears: number;
  partnerPartTimeIncome: number;
  partnerPartTimeYears: number;
  hasPartner: boolean;
  partnerCurrentAge: number;
  partnerBirthYear: number;
  partnerRetirementAge: number;
  /** The partner's take-home pay per month; `partnerSalary` is calculated from it. */
  partnerNetMonthlyPay: number;
  /** The partner's gross annual salary, calculated from `partnerNetMonthlyPay`. */
  partnerSalary: number;
  /** What the partner's employer puts into super each month. */
  partnerEmployerSuperMonthly: number;
  /** The partner's own contribution into super each month, before tax. */
  partnerPersonalSuperMonthly: number;
  partnerWageGrowth: number;
  partnerSuperBalance: number;
  partnerVoluntarySuperContribution: number;
  partnerSex: 'male' | 'female' | 'unspecified';
  /** 0 means no death is modelled. */
  firstDeathAge: number;
  spendingStepDownOnFirstDeath: number;
  downsize: boolean;
  downsizeAge: number;
  downsizeNewHomeValue: number;
  sellingCostRate: number;
}

/**
 * Illustrative starting figures - deliberately not anyone's real finances.
 * Put your own in `scenarios/local.json` (gitignored) and the app prefills from there.
 */
export const defaults: FormInputs = {
  startYear: 2026,
  birthYear: 1984,
  currentAge: 42,
  retirementAge: 47,
  planToAge: 95,
  // $7,590 a month in the hand is a $120,000 salary under the 2026-27 scale. The two are
  // kept consistent by applyFieldRules; see the test that pins them together.
  netMonthlyPay: 7_590,
  salary: 120_000,
  // 12% of $120,000 is $14,400 a year: the super guarantee and nothing above it.
  employerSuperMonthly: 1_200,
  personalSuperMonthly: 0,
  wageGrowth: 0.035,
  superBalance: 250_000,
  voluntarySuperContribution: 0,
  cash: 0,
  investments: 150_000,
  primaryResidence: 900_000,
  annualSavings: 30_000,
  retirementSpending: 60_000,
  cpi: 0.025,
  investmentIncomeYield: 0.025,
  returnCash: 0.035,
  returnInvestments: 0.065,
  returnSuper: 0.075,
  returnHome: 0.04,
  includeHealthCosts: true,
  outOfPocketMultiplier: 1,
  healthInsuranceMonthly: 0,
  privateHealthInsurancePremium: 0,
  healthInflation: 0.035,
  phaseGoGoTo: 75,
  phaseSlowGoMultiplier: 0.85,
  phaseNoGoFrom: 85,
  phaseNoGoMultiplier: 0.75,
  agedCareEnabled: false,
  agedCareFromAge: 85,
  agedCareYears: 4,
  agedCareAccommodation: 40_000,
  sex: 'unspecified',
  indexAgePension: true,
  indexTaxBrackets: true,
  indexSuperCaps: true,
  drawdownStrategy: 'outsideSuperFirst',
  cashBufferYears: 3,
  glidePath: false,
  hasMortgage: false,
  mortgageBalance: 150_000,
  mortgageRate: 0.062,
  mortgageYears: 10,
  offsetBalance: 50_000,
  partTimeIncome: 0,
  partTimeYears: 5,
  partnerPartTimeIncome: 0,
  partnerPartTimeYears: 5,
  hasPartner: false,
  partnerCurrentAge: 40,
  partnerBirthYear: 1986,
  partnerRetirementAge: 50,
  partnerNetMonthlyPay: 5_890,
  partnerSalary: 90_000,
  partnerEmployerSuperMonthly: 900,
  partnerPersonalSuperMonthly: 0,
  partnerWageGrowth: 0.035,
  partnerSuperBalance: 150_000,
  partnerVoluntarySuperContribution: 0,
  partnerSex: 'unspecified',
  firstDeathAge: 0,
  spendingStepDownOnFirstDeath: 0.7,
  // Off by default. Downsizing the family home is a major life decision, not something
  // a planning tool should quietly assume on your behalf.
  downsize: false,
  downsizeAge: 60,
  downsizeNewHomeValue: 600_000,
  sellingCostRate: 0.025,
};

/**
 * Inputs still awaiting a real figure - shown as `assumed` in the UI.
 * Empty: every field has a real default. Add a key back here if one is ever a guess.
 */
export const PROVISIONAL: Array<keyof FormInputs> = [];

const STORAGE_KEY = 'retirement-model:inputs:v1';

/**
 * Where the form is kept between pages.
 *
 * sessionStorage, not localStorage, and deliberately: the app starts from the example
 * every time you open it, rather than quietly resurrecting whatever you typed days ago.
 * Within a visit your entries survive moving between the three pages and an accidental
 * reload, which they must - the detail and comparison pages are worthless if they show
 * the example instead of your plan. Close the tab and it is gone.
 *
 * Export is the way to keep a scenario for longer; nothing is written to disk otherwise.
 */
function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadSaved(ruleset: Ruleset): FormInputs | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeInputs(JSON.parse(raw) as Partial<FormInputs>, ruleset);
  } catch {
    return null;
  }
}

export function save(inputs: FormInputs): void {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    // Private windows and blocked site data both throw; losing the copy is not fatal.
  }
}

export function clearSaved(): void {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Merge a partial set of inputs over the defaults, keeping only keys that exist and whose
 * type matches. An imported file from an older version, or a hand-edited one, cannot
 * inject unexpected shapes into the form this way.
 */
/**
 * Keep fields that describe the same fact from contradicting each other.
 *
 * Two rules, both of which were previously unenforced and produced states that looked
 * like stale inputs but were really invalid scenarios:
 *
 * 1. Age and birth year are one fact. `birthYear = startYear - age`, ignoring the
 *    birthday within the year. Birth year is not decoration - it sets the preservation
 *    age, the year super becomes accessible.
 * 2. You cannot retire before today. If age passes the planned retirement age, that age
 *    comes with it; if a retirement age is typed below the current age, it is lifted.
 * 3. Pay is one fact entered as take-home per month, because that is the number people
 *    know. The gross salary the model runs on is solved back out of it against the tax
 *    scale in the ruleset. Health insurance is the same idea, but only a x12.
 *
 * Only fields related to the one being edited are touched, so nothing moves under the
 * user unexpectedly.
 */
export function applyFieldRules(
  form: FormInputs,
  key: keyof FormInputs,
  ruleset: Ruleset,
): FormInputs {
  const sane = (n: number) => Number.isFinite(n) && n > 1900 && n < 2200;
  const next = { ...form };

  // Pay: three payslip lines and the salary behind them, kept consistent. See applyPayRules.
  applyPayRules(next, key, ruleset, YOUR_PAY);
  applyPayRules(next, key, ruleset, PARTNER_PAY);

  if (key === 'healthInsuranceMonthly') {
    next.privateHealthInsurancePremium = annualFromMonthly(next.healthInsuranceMonthly);
  } else if (key === 'privateHealthInsurancePremium') {
    next.healthInsuranceMonthly = monthlyFromAnnual(next.privateHealthInsurancePremium);
  }

  if (key === 'currentAge' && Number.isFinite(next.currentAge)) {
    const y = next.startYear - next.currentAge;
    if (sane(y)) next.birthYear = y;
  } else if (key === 'birthYear' && sane(next.birthYear)) {
    next.currentAge = next.startYear - next.birthYear;
  } else if (key === 'partnerCurrentAge' && Number.isFinite(next.partnerCurrentAge)) {
    const y = next.startYear - next.partnerCurrentAge;
    if (sane(y)) next.partnerBirthYear = y;
  } else if (key === 'partnerBirthYear' && sane(next.partnerBirthYear)) {
    next.partnerCurrentAge = next.startYear - next.partnerBirthYear;
  } else if (key === 'startYear') {
    // Moving the plan's start year keeps ages fixed and shifts the birth years.
    if (sane(next.startYear - next.currentAge)) next.birthYear = next.startYear - next.currentAge;
    if (sane(next.startYear - next.partnerCurrentAge)) {
      next.partnerBirthYear = next.startYear - next.partnerCurrentAge;
    }
  }

  // Nobody can retire in the past. Whichever side moved, the retirement age ends up at
  // or after the current age - "retire now" being the earliest honest answer.
  if (
    Number.isFinite(next.currentAge) &&
    Number.isFinite(next.retirementAge) &&
    next.retirementAge < next.currentAge &&
    ['currentAge', 'birthYear', 'retirementAge', 'startYear'].includes(key as string)
  ) {
    next.retirementAge = next.currentAge;
  }
  if (
    Number.isFinite(next.partnerCurrentAge) &&
    Number.isFinite(next.partnerRetirementAge) &&
    next.partnerRetirementAge < next.partnerCurrentAge &&
    ['partnerCurrentAge', 'partnerBirthYear', 'partnerRetirementAge', 'startYear'].includes(
      key as string,
    )
  ) {
    next.partnerRetirementAge = next.partnerCurrentAge;
  }
  return next;
}

export function mergeInputs(incoming: Partial<FormInputs>, ruleset: Ruleset): FormInputs {
  const out = { ...defaults };
  const took = new Set<keyof FormInputs>();
  for (const key of Object.keys(defaults) as Array<keyof FormInputs>) {
    const v = incoming[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof defaults[key]) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    (out as Record<string, unknown>)[key] = v;
    took.add(key);
  }

  // A file written before pay was entered as take-home carries a gross salary and no
  // monthly figure; a hand-edited one can carry both, disagreeing. Whichever side the
  // file supplied is kept and the other recomputed, so the form never opens showing two
  // numbers that contradict each other. The monthly figure wins when both are present -
  // it is the one a person typed.
  reconcilePay(out, took, ruleset, YOUR_PAY);
  reconcilePay(out, took, ruleset, PARTNER_PAY);
  if (took.has('healthInsuranceMonthly')) {
    out.privateHealthInsurancePremium = annualFromMonthly(out.healthInsuranceMonthly);
  } else if (took.has('privateHealthInsurancePremium')) {
    out.healthInsuranceMonthly = monthlyFromAnnual(out.privateHealthInsurancePremium);
  }
  return out;
}

/**
 * The gross annual salary behind a monthly take-home figure.
 *
 * Salary sacrifice comes out before tax, so the same take-home means a higher gross when
 * you sacrifice - and the engine trims a sacrifice that will not fit under the
 * concessional cap, so this does too. Rounded to whole dollars in both directions, which
 * keeps the pair stable: converting back and forth repeatedly does not drift the number
 * under the user.
 *
 * The remaining assumption is the projection's own: salary is the whole of taxable
 * income. No HELP repayment, no reportable fringe benefits, no Division 293 surcharge.
 * The super guarantee is paid on top of salary, so it is correctly absent here.
 */
export function grossSalaryFor(
  netMonthly: number,
  ruleset: Ruleset,
  opts: PayOptions = {},
): number {
  if (!Number.isFinite(netMonthly) || netMonthly <= 0) return 0;
  return Math.round(grossFromTakeHome(netMonthly * 12, ruleset, opts));
}

/** What a gross annual salary leaves in the hand each month, after sacrifice and tax. */
export function netMonthlyFor(gross: number, ruleset: Ruleset, opts: PayOptions = {}): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.round(takeHome(gross, ruleset, opts).net / 12);
}

/** The four form fields that describe one person's pay, so the rules can be written once. */
interface PayFields {
  net: 'netMonthlyPay' | 'partnerNetMonthlyPay';
  gross: 'salary' | 'partnerSalary';
  employer: 'employerSuperMonthly' | 'partnerEmployerSuperMonthly';
  ownMonthly: 'personalSuperMonthly' | 'partnerPersonalSuperMonthly';
  ownAnnual: 'voluntarySuperContribution' | 'partnerVoluntarySuperContribution';
}

const YOUR_PAY: PayFields = {
  net: 'netMonthlyPay',
  gross: 'salary',
  employer: 'employerSuperMonthly',
  ownMonthly: 'personalSuperMonthly',
  ownAnnual: 'voluntarySuperContribution',
};

const PARTNER_PAY: PayFields = {
  net: 'partnerNetMonthlyPay',
  gross: 'partnerSalary',
  employer: 'partnerEmployerSuperMonthly',
  ownMonthly: 'partnerPersonalSuperMonthly',
  ownAnnual: 'partnerVoluntarySuperContribution',
};

/**
 * What the employer is currently paying, expressed as the form's own two figures imply.
 *
 * Either they are on the legislated minimum - the ordinary case - or they pay some rate
 * above it. Which of the two matters: the minimum stops at the maximum contribution base,
 * whereas an employer who has agreed to 15.4% pays it on the whole salary. Keeping the
 * distinction means a pay rise moves the figure the right way in both cases.
 */
function employerBasis(gross: number, monthly: number, ruleset: Ruleset) {
  const minimum = superGuaranteeOn(gross, ruleset);
  // Within a dollar a month of the minimum counts as being on it; the fields are rounded.
  const atMinimum = !(gross > 0) || Math.abs(monthly * 12 - minimum) < 12;
  return { atMinimum, rate: gross > 0 ? (monthly * 12) / gross : 0, minimum };
}

type EmployerBasis = ReturnType<typeof employerBasis>;

/** What the employer would put in per month at a different salary, on the same basis. */
function employerMonthlyAt(gross: number, basis: EmployerBasis, ruleset: Ruleset): number {
  const minimum = Math.round(superGuaranteeOn(gross, ruleset) / 12);
  if (basis.atMinimum) return minimum;
  return Math.max(minimum, Math.round((basis.rate * gross) / 12));
}

/** How the employer's contribution enters the take-home sum: through the concessional cap. */
function payOptions(
  form: FormInputs,
  f: PayFields,
  basis: EmployerBasis,
  solving: boolean,
): PayOptions {
  const salarySacrifice = form[f.ownAnnual];
  if (basis.atMinimum) return { salarySacrifice };
  // Solving for the salary: the employer's contribution moves with it, so pass the rate
  // and let the engine keep the two together at whatever salary it lands on.
  return solving
    ? { salarySacrifice, employerSuperRate: basis.rate }
    : { salarySacrifice, employerSuper: form[f.employer] * 12 };
}

/**
 * Keep one person's pay fields consistent with each other.
 *
 * Three of them come off a payslip - what reaches the bank, what the employer puts into
 * super, what you put in yourself - and the gross salary the model runs on is behind all
 * three. Which one holds still depends on what was edited:
 *
 * - Type a take-home figure and the salary is solved to match it.
 * - Type a salary sacrifice and the salary holds: sacrificing more does not earn you
 *   more, it lowers what reaches the bank. That is also the honest way to show the cost.
 * - Type an employer contribution and only the cap moves - it is paid on top of salary,
 *   so it cannot change take-home except by squeezing what you can sacrifice.
 * - Change the salary from an import or a lever and everything else follows it.
 */
function applyPayRules(
  next: FormInputs,
  key: keyof FormInputs,
  ruleset: Ruleset,
  f: PayFields,
): void {
  const basis = employerBasis(next[f.gross], next[f.employer], ruleset);

  if (key === f.ownMonthly) next[f.ownAnnual] = Math.max(0, Math.round(next[f.ownMonthly] * 12));
  else if (key === f.ownAnnual) {
    next[f.ownMonthly] = Math.max(0, Math.round(next[f.ownAnnual] / 12));
  }

  if (key === f.net) {
    next[f.gross] = grossSalaryFor(next[f.net], ruleset, payOptions(next, f, basis, true));
    next[f.employer] = employerMonthlyAt(next[f.gross], basis, ruleset);
  } else if (
    key === f.gross ||
    key === f.employer ||
    key === f.ownMonthly ||
    key === f.ownAnnual
  ) {
    if (key === f.gross) {
      // The salary set directly rather than solved for - an import, or a lever. The old
      // salary is already gone by the time the rules run, so there is no rate to rescale
      // by: the employer's contribution stays as it was, lifted only if the new salary's
      // legislated minimum has overtaken it.
      next[f.employer] = Math.max(
        next[f.employer],
        Math.round(superGuaranteeOn(next[f.gross], ruleset) / 12),
      );
    }
    next[f.net] = netMonthlyFor(next[f.gross], ruleset, payOptions(next, f, basis, false));
  }
}

/**
 * Work out whichever side of a person's pay an imported file left out.
 *
 * A scenario saved before pay was entered as take-home carries a gross salary and no
 * monthly figures at all; a hand-edited one can carry both, disagreeing. The typed
 * monthly figure wins where there is one, because that is what a person actually knows.
 */
function reconcilePay(
  out: FormInputs,
  took: Set<keyof FormInputs>,
  ruleset: Ruleset,
  f: PayFields,
): void {
  if (took.has(f.ownMonthly)) out[f.ownAnnual] = Math.max(0, Math.round(out[f.ownMonthly] * 12));
  else if (took.has(f.ownAnnual)) {
    out[f.ownMonthly] = Math.max(0, Math.round(out[f.ownAnnual] / 12));
  }

  const basis = employerBasis(out[f.gross], out[f.employer], ruleset);
  if (took.has(f.net)) {
    // A file that names the employer's contribution in dollars is believed as dollars,
    // rather than being turned into a rate and rescaled by the salary we solve for.
    const opts = payOptions(out, f, basis, !took.has(f.employer));
    out[f.gross] = grossSalaryFor(out[f.net], ruleset, opts);
    if (!took.has(f.employer)) out[f.employer] = employerMonthlyAt(out[f.gross], basis, ruleset);
  } else if (took.has(f.gross) || took.has(f.ownAnnual) || took.has(f.employer)) {
    if (took.has(f.gross) && !took.has(f.employer)) {
      out[f.employer] = employerMonthlyAt(out[f.gross], basis, ruleset);
    }
    out[f.net] = netMonthlyFor(out[f.gross], ruleset, payOptions(out, f, basis, false));
  }
}

const annualFromMonthly = (monthly: number) =>
  Number.isFinite(monthly) && monthly > 0 ? Math.round(monthly * 12) : 0;
const monthlyFromAnnual = (annual: number) =>
  Number.isFinite(annual) && annual > 0 ? Math.round(annual / 12) : 0;

export const PRIMARY_ID = 'you';
export const PARTNER_ID = 'partner';

/** Values the model takes from public data rather than from the user. */
export interface SourcedRates {
  /** Private health insurance premium growth, from the Department of Health series. */
  phiInflation: number;
}

export function toScenario(f: FormInputs, sourced: SourcedRates): Scenario {
  const people = [
    {
      id: PRIMARY_ID,
      name: 'You',
      dateOfBirth: `${f.birthYear}-01-01`,
      currentAge: f.currentAge,
      retirementAge: f.retirementAge,
      salary: f.salary,
      wageGrowth: f.wageGrowth,
      superBalance: f.superBalance,
      // Passed as dollars, always. The engine lifts anything below the legislated
      // minimum, and the maximum contribution base is wage-indexed exactly as the salary
      // is - so a figure that starts at the minimum stays at it, cap and all.
      employerSuperContribution: f.employerSuperMonthly * 12,
      voluntarySuperContribution: f.voluntarySuperContribution,
      sex: f.sex === 'unspecified' ? undefined : f.sex,
      partTimeIncome:
        f.partTimeIncome > 0 && f.partTimeYears > 0
          ? {
              amount: f.partTimeIncome,
              fromAge: f.retirementAge,
              toAge: f.retirementAge + f.partTimeYears,
            }
          : undefined,
    },
  ];
  if (f.hasPartner) {
    people.push({
      id: PARTNER_ID,
      name: 'Partner',
      dateOfBirth: `${f.partnerBirthYear}-01-01`,
      currentAge: f.partnerCurrentAge,
      retirementAge: f.partnerRetirementAge,
      salary: f.partnerSalary,
      wageGrowth: f.partnerWageGrowth,
      superBalance: f.partnerSuperBalance,
      employerSuperContribution: f.partnerEmployerSuperMonthly * 12,
      voluntarySuperContribution: f.partnerVoluntarySuperContribution,
      sex: f.partnerSex === 'unspecified' ? undefined : f.partnerSex,
      partTimeIncome:
        f.partnerPartTimeIncome > 0 && f.partnerPartTimeYears > 0
          ? {
              amount: f.partnerPartTimeIncome,
              fromAge: f.partnerRetirementAge,
              toAge: f.partnerRetirementAge + f.partnerPartTimeYears,
            }
          : undefined,
    });
  }

  const events: Scenario['events'] = [];
  if (f.downsize) {
    events.push({
      kind: 'downsize',
      personId: PRIMARY_ID,
      atAge: f.downsizeAge,
      newHomeValue: f.downsizeNewHomeValue,
      sellingCostRate: f.sellingCostRate,
      proceedsTo: 'investments',
    });
  }
  if (f.hasPartner && f.firstDeathAge > 0) {
    events.push({ kind: 'death', personId: PARTNER_ID, atAge: f.firstDeathAge });
  }

  return {
    name: f.hasPartner ? 'Couple' : 'Base case',
    startYear: f.startYear,
    household: {
      homeOwner: f.primaryResidence > 0,
      cash: f.cash,
      investments: f.investments,
      primaryResidence: f.primaryResidence,
      annualSavings: f.annualSavings,
      retirementSpending: f.retirementSpending,
      mortgage: f.hasMortgage
        ? {
            balance: f.mortgageBalance,
            interestRate: f.mortgageRate,
            remainingYears: f.mortgageYears,
            offsetBalance: f.offsetBalance,
          }
        : undefined,
      spendingStepDownOnFirstDeath: f.spendingStepDownOnFirstDeath,
      people,
    },
    assumptions: {
      cpi: f.cpi,
      investmentIncomeYield: f.investmentIncomeYield,
      convertSuperToPensionPhase: true,
      indexation: {
        agePension: f.indexAgePension,
        taxBrackets: f.indexTaxBrackets,
        superCaps: f.indexSuperCaps,
      },
      drawdownStrategy: f.drawdownStrategy,
      cashBufferYears: f.cashBufferYears,
      // The build plan's section 2.3 option table: Growth until 55, Balanced 55-65,
      // Conservative after. Illustrative figures, not sourced.
      glidePath: f.glidePath
        ? [
            { fromAge: 55, expectedReturn: 0.065, volatility: 0.08, label: 'Balanced' },
            { fromAge: 65, expectedReturn: 0.045, volatility: 0.04, label: 'Conservative' },
          ]
        : undefined,
      spendingPhases: [
        { fromAge: 0, multiplier: 1 },
        { fromAge: f.phaseGoGoTo, multiplier: f.phaseSlowGoMultiplier },
        { fromAge: f.phaseNoGoFrom, multiplier: f.phaseNoGoMultiplier },
      ],
      health: {
        includeHealthCosts: f.includeHealthCosts,
        outOfPocketMultiplier: f.outOfPocketMultiplier,
        privateHealthInsurancePremium: f.privateHealthInsurancePremium,
        healthInflation: f.healthInflation,
        privateHealthInsuranceInflation: sourced.phiInflation,
      },
      agedCare: {
        enabled: f.agedCareEnabled,
        fromAge: f.agedCareFromAge,
        years: f.agedCareYears,
        annualAccommodationCost: f.agedCareAccommodation,
        payFullMeansTestedContributions: true,
      },
      returns: {
        cash: f.returnCash,
        investments: f.returnInvestments,
        superAccumulation: f.returnSuper,
        primaryResidence: f.returnHome,
      },
      planToAge: f.planToAge,
    },
    events,
  };
}
