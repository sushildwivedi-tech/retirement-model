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
 * Your own figures, kept in this browser only.
 *
 * They are written to localStorage and never sent anywhere - there is no server to send
 * them to. Clearing site data, or using a different browser or device, starts from the
 * illustrative example again, which is what Export is for.
 */
export function loadSaved(): FormInputs | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeInputs(JSON.parse(raw) as Partial<FormInputs>);
  } catch {
    return null;
  }
}

export function save(inputs: FormInputs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    // Private windows and blocked site data both throw; losing the save is not fatal.
  }
}

export function clearSaved(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Merge a partial set of inputs over the defaults, keeping only keys that exist and whose
 * type matches. An imported file from an older version, or a hand-edited one, cannot
 * inject unexpected shapes into the form this way.
 */
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
