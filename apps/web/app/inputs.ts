import type { DrawdownStrategy, Scenario } from '@retirement/engine';

/** The flat shape the form edits, mapped into a `Scenario` for the engine. */
export interface FormInputs {
  startYear: number;
  birthYear: number;
  currentAge: number;
  retirementAge: number;
  planToAge: number;
  salary: number;
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
  partnerSalary: number;
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
  salary: 120_000,
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
  partnerSalary: 90_000,
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

export function loadSaved(): FormInputs | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeInputs(JSON.parse(raw) as Partial<FormInputs>);
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
 *
 * Only fields related to the one being edited are touched, so nothing moves under the
 * user unexpectedly.
 */
export function applyFieldRules(form: FormInputs, key: keyof FormInputs): FormInputs {
  const sane = (n: number) => Number.isFinite(n) && n > 1900 && n < 2200;
  const next = { ...form };
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

export function mergeInputs(incoming: Partial<FormInputs>): FormInputs {
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof FormInputs>) {
    const v = incoming[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof defaults[key]) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

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
