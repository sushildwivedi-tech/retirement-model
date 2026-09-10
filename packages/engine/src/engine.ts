import { preservationAge, assertUsable } from './rules';
import { personalIncomeTax } from './tax';
import { agePension, minimumDrawdownPercent } from './agePension';
import { indexRuleset } from './indexation';
import { advanceMortgage, annualRepaymentFor } from './mortgage';
import { DEFAULT_SPENDING_PHASES, outOfPocketAtAge, spendingMultiplier } from './health';
import { lifeExpectancy, lifespanPercentile, survivalCurve } from './longevity';
import type {
  AgedCareAssumptions,
  DrawdownStrategy,
  GlidePathStep,
  ReturnDraw,
  RunOverrides,
  BridgePeriod,
  HealthAssumptions,
  HealthCostCurve,
  LifeTables,
  LongevityView,
  OneOffExpenseEvent,
  DownsizeEvent,
  LumpSumEvent,
  PlanEvent,
  ProjectionResult,
  Ruleset,
  Scenario,
  YearRow,
} from './types';

interface State {
  cash: number;
  investments: number;
  investmentsCostBase: number;
  superAccumulation: Record<string, number>;
  superPension: Record<string, number>;
  /** Cumulative amount transferred into retirement phase, against the transfer balance cap. */
  transferBalanceUsed: Record<string, number>;
  workBonusBalance: Record<string, number>;
  dead: Set<string>;
  mortgageBalance: number;
  offset: number;
  primaryResidence: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Draw `need` proportionally across several balances, so no one person's account is
 * drained before another's. Returns whatever could not be funded.
 */
function drawProportionally<P>(
  need: number,
  holders: P[],
  balanceOf: (p: P) => number,
  take: (p: P, amount: number) => void,
): number {
  if (need <= 0) return need;
  const total = holders.reduce((a, p) => a + balanceOf(p), 0);
  if (total <= 0) return need;
  const draw = Math.min(need, total);
  for (const p of holders) {
    const amount = draw * (balanceOf(p) / total);
    if (amount > 0) take(p, amount);
  }
  return need - draw;
}

/**
 * Run the deterministic projection.
 *
 * Phase 2 scope: personal income tax with the Medicare levy, LITO and SAPTO; super
 * contributions tax, earnings tax by phase, pension-phase conversion and minimum
 * drawdown; CGT on outside-super drawdown; and the Age Pension under both the income
 * and assets tests. Still deterministic - a single return path, one household member.
 */
export interface Datasets {
  lifeTables?: LifeTables;
  healthCostCurve?: HealthCostCurve;
}

export function project(
  scenario: Scenario,
  ruleset: Ruleset,
  datasets: Datasets = {},
  overrides: RunOverrides = {},
): ProjectionResult {
  assertUsable(ruleset);

  const { household, assumptions, events, startYear } = scenario;
  const { people } = household;
  const warnings: string[] = [];
  if (people.length === 0) throw new Error('project: household has no people');
  if (people.length > 2) {
    throw new Error('project: a household is one or two people.');
  }
  const ownership = household.outsideSuperOwnership ?? Object.fromEntries(
    people.map((p) => [p.id, 1 / people.length]),
  );
  const ownedSum = Object.values(ownership).reduce((a, b) => a + b, 0);
  if (Math.abs(ownedSum - 1) > 1e-9) {
    throw new Error(`project: outsideSuperOwnership must sum to 1, got ${ownedSum}`);
  }
  const stepDown = household.spendingStepDownOnFirstDeath ?? 0.7;
  const phases = assumptions.spendingPhases ?? DEFAULT_SPENDING_PHASES;
  const health: HealthAssumptions | undefined = assumptions.health?.includeHealthCosts
    ? assumptions.health
    : undefined;
  if (health && !datasets.healthCostCurve) {
    throw new Error(
      'project: health costs are switched on but no health-cost curve was supplied. Silently ' +
        'skipping them would understate spending by thousands a year and make the money last ' +
        'longer than it should - pass datasets.healthCostCurve, or set includeHealthCosts: false.',
    );
  }
  const agedCare: AgedCareAssumptions | undefined = assumptions.agedCare?.enabled
    ? assumptions.agedCare
    : undefined;
  const ac = ruleset.agedCare;
  /** Non-clinical care contributions paid so far, against the lifetime cap. */
  let nonClinicalPaid = 0;
  let agedCareYearsPaid = 0;
  const mortgage = household.mortgage;
  // The repayment is a nominal dollar amount fixed by the loan contract, so unlike every
  // other spending line it is NOT indexed to CPI - which is exactly why a mortgage gets
  // easier to carry over time.
  const mortgageRepayment =
    mortgage === undefined
      ? 0
      : (mortgage.annualRepayment ??
        annualRepaymentFor(mortgage.balance, mortgage.interestRate, mortgage.remainingYears));
  let mortgagePaidOffAge: number | null = null;
  let totalMortgageInterest = 0;
  let totalOffsetInterestSaved = 0;
  if (mortgage && mortgage.offsetBalance > mortgage.balance) {
    warnings.push(
      `The offset balance (${Math.round(mortgage.offsetBalance).toLocaleString()}) is larger than ` +
        `the loan (${Math.round(mortgage.balance).toLocaleString()}). An offset only saves interest ` +
        'up to the amount owing, so the excess earns nothing at all - it would do better in ' +
        'cash, investments or super.',
    );
  }
  const strategy: DrawdownStrategy = assumptions.drawdownStrategy ?? 'outsideSuperFirst';
  const bufferYears = assumptions.cashBufferYears ?? 3;
  const glidePath: GlidePathStep[] = [...(assumptions.glidePath ?? [])].sort(
    (a, b) => a.fromAge - b.fromAge,
  );
  const superReturnAt = (age: number): number => {
    let r = assumptions.returns.superAccumulation;
    for (const step of glidePath) if (age >= step.fromAge) r = step.expectedReturn;
    return r;
  };

  const sgRate = ruleset.super.guaranteeRate.value;
  const baseContributionBase = ruleset.super.maximumContributionBaseAnnual.value;
  const baseConcessionalCap = ruleset.super.concessionalCap.value;
  const contributionsTaxRate = ruleset.super.contributionsTaxConcessional.value;
  const accumEarningsTax = ruleset.super.earningsTaxAccumulation.value;
  const pensionEarningsTax = ruleset.super.earningsTaxPensionPhase.value;
  const downsizerMinAge = ruleset.super.downsizerContribution.minimumAge.value;
  const downsizerCap = ruleset.super.downsizerContribution.capPerPerson.value;
  const baseTbc = ruleset.super.generalTransferBalanceCap.value;
  const nonConcessionalCap = ruleset.super.nonConcessionalCap.value;
  const cgtDiscount = ruleset.capitalGains.discountRate.value;
  const pensionAge = ruleset.agePension.eligibilityAge.value;

  const preservation: Record<string, number> = {};
  for (const p of people) {
    preservation[p.id] = preservationAge(p.dateOfBirth, ruleset.super.preservationAgeByDateOfBirth.value);
  }

  warnings.push(
    assumptions.indexation.taxBrackets
      ? 'ASSUMED: personal tax brackets, LITO, SAPTO and the Medicare thresholds are indexed ' +
        'forward at CPI. They are NOT indexed in law - they move only when Parliament changes ' +
        'them - so this assumes governments keep the scale roughly steady in real terms rather ' +
        'than letting bracket creep run for fifty years. On the base case it is worth about ' +
        'four years of run-out age; indexing the Age Pension, which is not a choice, is worth ten.'
      : 'ASSUMED: personal tax brackets are frozen at their 2026-27 values for the whole ' +
        'projection, which models fifty years of unbroken bracket creep with no tax cuts. ' +
        'Expect this to overstate tax.',
  );
  if (!assumptions.indexation.agePension) {
    warnings.push(
      'Age Pension rates and thresholds are NOT being indexed. They are indexed in law ' +
        '(CPI/PBLCI, benchmarked to MTAWE), so this models something that does not happen and ' +
        'will badly understate retirement income.',
    );
  }
  if (!assumptions.indexation.superCaps) {
    warnings.push(
      'Super caps are NOT being indexed. They are indexed to AWOTE in law, so this understates ' +
        'how much can be contributed and sheltered in later years.',
    );
  }
  warnings.push(
    `ASSUMED: ${(assumptions.investmentIncomeYield * 100).toFixed(1)}% of the outside-super ` +
      'return is taxable income each year and the rest is capital growth taxed on realisation. ' +
      'Franking credits are not modelled, so Australian share income is overtaxed here.',
  );
  warnings.push(
    'Before retirement the household is modelled by its net savings rate, so tax on salary ' +
      'is already inside that figure. Only the extra tax caused by investment income is ' +
      'charged against the portfolio in those years, at the marginal rate that income attracts.',
  );
  warnings.push(
    'ASSUMED: rebate income for SAPTO is approximated by taxable income. True rebate income ' +
      'also includes reportable super contributions and net investment losses.',
  );
  warnings.push(
    `Age Pension rates and thresholds are those effective ${ruleset.agePension.rateEffectiveDate.value}. ` +
      'They are adjusted every 20 March and 20 September - re-fetch the ruleset after each.',
  );

  const state: State = {
    cash: household.cash,
    investments: household.investments,
    investmentsCostBase: household.investmentsCostBase ?? household.investments,
    superAccumulation: Object.fromEntries(people.map((p) => [p.id, p.superBalance])),
    superPension: Object.fromEntries(people.map((p) => [p.id, 0])),
    transferBalanceUsed: Object.fromEntries(people.map((p) => [p.id, 0])),
    workBonusBalance: Object.fromEntries(people.map((p) => [p.id, 0])),
    dead: new Set<string>(),
    mortgageBalance: household.mortgage?.balance ?? 0,
    offset: household.mortgage?.offsetBalance ?? 0,
    primaryResidence: household.primaryResidence,
  };

  const firstRetirementAgeOffset = Math.min(...people.map((p) => p.retirementAge - p.currentAge));
  const lastYear = Math.max(...people.map((p) => assumptions.planToAge - p.currentAge));

  const rows: YearRow[] = [];
  const firedEvents = new Set<PlanEvent>();

  for (let t = 0; t <= lastYear; t++) {
    const calendarYear = startYear + t;
    const cpiIndex = Math.pow(1 + assumptions.cpi, t);
    const wageIndex = (p: (typeof people)[number]) => Math.pow(1 + p.wageGrowth, t);
    const ages: Record<string, number> = {};
    for (const p of people) ages[p.id] = p.currentAge + t;
    const eventLog: string[] = [];

    // Deaths are applied at the START of the year they occur, so the survivor's reduced
    // spending and the single Age Pension rate apply from that year onward. Monte Carlo
    // supplies sampled death ages through `overrides`; a scenario can also set them
    // explicitly as events.
    const deathsThisYear: Array<{ personId: string; atAge: number }> = [];
    for (const ev of events) {
      if (ev.kind === 'death' && !firedEvents.has(ev) && ages[ev.personId] === ev.atAge) {
        firedEvents.add(ev);
        deathsThisYear.push({ personId: ev.personId, atAge: ev.atAge });
      }
    }
    for (const [personId, atAge] of Object.entries(overrides.deathAgeByPerson ?? {})) {
      if (!state.dead.has(personId) && ages[personId] === atAge) {
        deathsThisYear.push({ personId, atAge });
      }
    }
    for (const ev of deathsThisYear) {
      if (state.dead.has(ev.personId)) continue;
      state.dead.add(ev.personId);
      const survivor = people.find((p) => !state.dead.has(p.id));
      const gone = people.find((p) => p.id === ev.personId)!;
      const balance = state.superAccumulation[gone.id] + state.superPension[gone.id];
      if (survivor && balance > 0) {
        // A death benefit paid to a spouse is a dependant benefit and is tax-free.
        state.superPension[survivor.id] += balance;
        state.transferBalanceUsed[survivor.id] += balance;
      } else if (!survivor && balance > 0) {
        state.cash += balance;
      }
      state.superAccumulation[gone.id] = 0;
      state.superPension[gone.id] = 0;
      eventLog.push(
        `${gone.name} dies at ${ev.atAge}. ` +
          (survivor
            ? `${Math.round(balance).toLocaleString()} of super passes to ${survivor.name} tax-free, ` +
              `spending steps down to ${Math.round(stepDown * 100)}% and the single Age Pension rate applies.`
            : 'The plan ends.'),
      );
      if (survivor) {
        warnings.push(
          `The death benefit passing to ${survivor.name} is credited against their transfer ` +
            'balance cap here. In practice a reversionary pension is counted differently and ' +
            'after a 12-month delay - check this if the cap is close to binding.',
        );
      }
    }

    const alive = people.filter((p) => !state.dead.has(p.id));
    if (alive.length === 0) break;
    const partnered = alive.length > 1;

    // Legislated dollar thresholds - Age Pension rates and limits, tax brackets, offsets,
    // deeming thresholds - move with the year. Rates and tapers do not.
    const ry =
      overrides.indexedRulesets?.[t] ??
      indexRuleset(ruleset, cpiIndex, assumptions.indexation);

    // Monte Carlo supplies a sampled return for the year; otherwise the fixed assumption
    // applies. The glide path overrides the super return by age either way.
    const drawn: ReturnDraw | undefined = overrides.returns?.[t];
    const oldestAlive = Math.max(...people.filter((p) => !state.dead.has(p.id)).map((p) => ages[p.id]));
    const ret = {
      cash: drawn?.cash ?? assumptions.returns.cash,
      investments: drawn?.investments ?? assumptions.returns.investments,
      superAccumulation: drawn?.superAccumulation ?? superReturnAt(oldestAlive),
      primaryResidence: drawn?.primaryResidence ?? assumptions.returns.primaryResidence,
    };

    // --- 2. Income -------------------------------------------------------------
    // Salary and part-time income are tracked apart: salary sets the super guarantee
    // base, part-time work does not (see Person.partTimeIncome). Both are employment
    // income for the Age Pension income test and the Work Bonus.
    const salaryOf: Record<string, number> = {};
    const partTimeOf: Record<string, number> = {};
    let salaryTotal = 0;
    let partTimeTotal = 0;
    for (const p of alive) {
      const age = ages[p.id];
      salaryOf[p.id] = age < p.retirementAge ? p.salary * wageIndex(p) : 0;
      salaryTotal += salaryOf[p.id];
      const pt = p.partTimeIncome;
      partTimeOf[p.id] =
        pt && age >= pt.fromAge && age < pt.toAge ? pt.amount * cpiIndex : 0;
      partTimeTotal += partTimeOf[p.id];
    }

    const cashInterest = state.cash * ret.cash;
    const investmentIncome = state.investments * assumptions.investmentIncomeYield;
    const investmentGrowthRate = ret.investments - assumptions.investmentIncomeYield;
    const taxableInvestmentIncome = cashInterest + investmentIncome;

    // --- 3. Super contributions (concessional, taxed 15% in the fund) -----------
    let sgTotal = 0;
    let voluntaryTotal = 0;
    let contributionsTaxTotal = 0;
    for (const p of alive) {
      if (salaryOf[p.id] <= 0) continue;
      const contributionBase = baseContributionBase * wageIndex(p);
      // The legislated minimum, which stops at the maximum contribution base - and then
      // whatever the employer actually pays, if that is more. See Person.employerSuperContribution.
      const minimumSg = Math.min(salaryOf[p.id], contributionBase) * sgRate;
      const sg = p.employerSuperContribution
        ? Math.max(minimumSg, p.employerSuperContribution * wageIndex(p))
        : minimumSg;
      const capNow = Math.floor((baseConcessionalCap * wageIndex(p)) / 2500) * 2500;
      // Indexed with wages, not CPI: a voluntary contribution is a slice of pay, and
      // someone sacrificing $10,000 of a $120,000 salary means to keep sacrificing that
      // share of it. The cap it is trimmed against is wage-indexed for the same reason.
      const wanted = (p.voluntarySuperContribution ?? 0) * wageIndex(p);
      const voluntary = Math.min(wanted, Math.max(0, capNow - sg));
      if (voluntary < wanted) {
        eventLog.push(
          `${p.name}: voluntary super contribution trimmed to the concessional cap ` +
            `(${Math.round(capNow).toLocaleString()}).`,
        );
      }
      const ctax = (sg + voluntary) * contributionsTaxRate;
      state.superAccumulation[p.id] += sg + voluntary - ctax;
      sgTotal += sg;
      voluntaryTotal += voluntary;
      contributionsTaxTotal += ctax;
    }

    // --- Pension-phase conversion, per person ----------------------------------
    for (const p of alive) {
      const retiredAndPreserved = ages[p.id] >= preservation[p.id] && ages[p.id] >= p.retirementAge;
      if (!assumptions.convertSuperToPensionPhase || !retiredAndPreserved) continue;
      const room = Math.max(0, ry.super.generalTransferBalanceCap.value - state.transferBalanceUsed[p.id]);
      const move = Math.min(state.superAccumulation[p.id], room);
      if (move <= 0) continue;
      state.superAccumulation[p.id] -= move;
      state.superPension[p.id] += move;
      state.transferBalanceUsed[p.id] += move;
      eventLog.push(
        `${p.name}: moved ${Math.round(move).toLocaleString()} into pension phase ` +
          '(earnings untaxed, minimum drawdown now applies).',
      );
      if (state.superAccumulation[p.id] > 1) {
        warnings.push(
          `At age ${ages[p.id]} the transfer balance cap left ` +
            `${Math.round(state.superAccumulation[p.id]).toLocaleString()} of ${p.name}'s super in ` +
            'accumulation phase, where earnings stay taxed at 15%.',
        );
      }
    }

    // --- Compulsory minimum pension payments (on opening pension balances) -----
    let minimumPensionPayment = 0;
    for (const p of alive) {
      if (state.superPension[p.id] <= 0) continue;
      const take = state.superPension[p.id] * minimumDrawdownPercent(ages[p.id], ry);
      state.superPension[p.id] -= take;
      state.cash += take;
      minimumPensionPayment += take;
    }

    // --- 4. Spending -----------------------------------------------------------
    const inRetirement = t >= firstRetirementAgeOffset;
    const anyoneDied = state.dead.size > 0;
    // Real spending falls through retirement (go-go / slow-go / no-go), keyed to the
    // oldest living person. Health costs rise as this falls and are a separate line.
    const oldest = Math.max(...alive.map((p) => ages[p.id]));
    const phaseMultiplier = inRetirement ? spendingMultiplier(oldest, phases) : 1;
    const baselineSpending = inRetirement
      ? household.retirementSpending * cpiIndex * phaseMultiplier * (anyoneDied ? stepDown : 1)
      : 0;

    // Out-of-pocket health costs, per living person, on the AIHW age curve. Indexed at
    // health inflation rather than CPI because health costs have run faster.
    let healthSpending = 0;
    let phiSpending = 0;
    // Only from retirement. Before then the household is modelled by its net savings
    // rate, and recurring living costs - health among them - are already inside that
    // figure. Adding them again here would double-count, the same way charging the full
    // salary tax pre-retirement did. Explicit one-off expenses are different: the user
    // enters those deliberately, so they are additional by construction.
    if (inRetirement && health && datasets.healthCostCurve) {
      const healthIndex = Math.pow(1 + health.healthInflation, t);
      const phiIndex = Math.pow(1 + health.privateHealthInsuranceInflation, t);
      for (const p of alive) {
        healthSpending +=
          outOfPocketAtAge(datasets.healthCostCurve, ages[p.id]) *
          health.outOfPocketMultiplier *
          healthIndex;
      }
      phiSpending += health.privateHealthInsurancePremium * alive.length * phiIndex;
    }

    // Residential aged care, as a deterministic stress test on the primary person.
    let agedCareSpending = 0;
    if (inRetirement && agedCare) {
      const subject = alive.find((p) => ages[p.id] >= agedCare.fromAge);
      const withinWindow =
        subject !== undefined && ages[subject.id] < agedCare.fromAge + agedCare.years;
      if (withinWindow) {
        const bdf = ac.basicDailyFeePerDay.value * 365 * cpiIndex;
        let fees = bdf;
        if (agedCare.payFullMeansTestedContributions) {
          fees += ac.hotellingContributionMaxPerDay.value * 365 * cpiIndex;
          // The non-clinical care contribution stops at the lifetime cap OR after four
          // years of contributions, whichever comes first.
          const capNow = ac.nonClinicalCareLifetimeCap.value * cpiIndex;
          if (agedCareYearsPaid < ac.nonClinicalCareMaxYears.value && nonClinicalPaid < capNow) {
            const yearly = ac.nonClinicalCareContributionMaxPerDay.value * 365 * cpiIndex;
            const allowed = Math.min(yearly, capNow - nonClinicalPaid);
            fees += allowed;
            nonClinicalPaid += allowed;
            agedCareYearsPaid += 1;
          }
        }
        fees += agedCare.annualAccommodationCost * cpiIndex;
        agedCareSpending = fees;
        eventLog.push(
          `Residential aged care: ${Math.round(fees).toLocaleString()} this year ` +
            `(basic daily fee, means-tested contributions and accommodation).`,
        );
      }
    }

    // --- Home loan ------------------------------------------------------------
    // Repayments are a spending line that ends when the loan does (build plan 2.2),
    // rather than being netted against assets. They run whether or not anyone has
    // retired, so unlike the other lines this one is not gated on `inRetirement`.
    let mortgageSpending = 0;
    const mortgageYear = mortgage
      ? advanceMortgage(state.mortgageBalance, state.offset, mortgage, mortgageRepayment)
      : null;
    if (mortgageYear && state.mortgageBalance > 0) {
      mortgageSpending = mortgageYear.repayment;
      totalMortgageInterest += mortgageYear.interest;
      totalOffsetInterestSaved += mortgageYear.interestSavedByOffset;
      state.offset -= mortgageYear.offsetUsedToClear;
      state.mortgageBalance = mortgageYear.closingBalance;
      if (mortgageYear.clearedThisYear) {
        mortgagePaidOffAge ??= ages[people[0].id];
        eventLog.push(
          mortgageYear.offsetUsedToClear > 0
            ? `Home loan cleared, ${Math.round(mortgageYear.offsetUsedToClear).toLocaleString()} of it paid out from the offset. The repayment stops from here.`
            : 'Home loan cleared. The repayment stops from here.',
        );
        // With no loan left to offset, the account is just a transaction account. Leaving
        // the balance there would have it earn nothing for the rest of the plan, which is
        // a modelling artefact rather than anything a household would actually do.
        if (state.offset > 0) {
          state.cash += state.offset;
          eventLog.push(
            `${Math.round(state.offset).toLocaleString()} moved out of the offset — with no loan ` +
              'to offset, it earns nothing sitting there.',
          );
          state.offset = 0;
        }
      }
    }

    // One-off expenses.
    let oneOffSpending = 0;
    for (const ev of events) {
      if (ev.kind !== 'expense') continue;
      const e = ev as OneOffExpenseEvent;
      const p = alive.find((x) => x.id === e.personId);
      if (!p) continue;
      const age = ages[p.id];
      const due =
        age === e.atAge ||
        (e.repeatEveryYears !== undefined &&
          e.repeatEveryYears > 0 &&
          age > e.atAge &&
          (age - e.atAge) % e.repeatEveryYears === 0);
      if (!due) continue;
      const amount = e.indexed === false ? e.amount : e.amount * cpiIndex;
      oneOffSpending += amount;
      eventLog.push(`${e.label}: ${Math.round(amount).toLocaleString()}.`);
    }

    const totalSpending =
      baselineSpending +
      healthSpending +
      phiSpending +
      agedCareSpending +
      oneOffSpending +
      mortgageSpending;

    const savings = inRetirement ? 0 : household.annualSavings * cpiIndex;
    if (savings > 0) {
      state.investments += savings;
      state.investmentsCostBase += savings;
    }

    // --- 5. Age Pension --------------------------------------------------------
    // Superannuation still in accumulation phase is NOT assessed until its owner reaches
    // Age Pension age. Money already converted to a pension is assessed whatever the
    // owner's age, because starting a pension is a choice with consequences.
    //
    // For a couple with an age gap this is the single most-used strategy there is: hold
    // the balance in the younger partner's accumulation account and the older partner is
    // assessed as though it did not exist. Assessing it - as this did until now - quietly
    // deleted that strategy and understated the pension by thousands a year.
    let assessedSuper = 0;
    let exemptSuper = 0;
    for (const p of alive) {
      assessedSuper += state.superPension[p.id];
      if (ages[p.id] >= pensionAge) assessedSuper += state.superAccumulation[p.id];
      else exemptSuper += state.superAccumulation[p.id];
    }
    // An offset balance is still the household's money, so it is assessed like any other
    // financial asset - both deemed for the income test and counted for the assets test.
    const financialAssets = state.cash + state.offset + state.investments + assessedSuper;
    // Contents, vehicles and personal effects count towards the assets test but are not
    // financial assets, so they are never deemed to earn anything.
    const personalAssets = (household.personalAssets ?? 0) * cpiIndex;
    const ap = agePension(
      {
        people: alive.map((p) => ({
          id: p.id,
          age: ages[p.id],
          employmentIncome: inRetirement ? salaryOf[p.id] + partTimeOf[p.id] : 0,
          workBonusBalance: state.workBonusBalance[p.id],
        })),
        partnered,
        homeOwner: household.homeOwner,
        financialAssets,
        assessableAssets: financialAssets + personalAssets,
        otherAssessableIncome: 0,
      },
      ry,
    );
    state.workBonusBalance = { ...state.workBonusBalance, ...ap.workBonusBalanceEnd };

    // --- 6/7. Fund the year, then tax it ---------------------------------------
    const spendableIncome = inRetirement ? salaryTotal + partTimeTotal + ap.entitlement : 0;
    state.cash += taxableInvestmentIncome;

    // Ownership shares are renormalised over the living, so a survivor is taxed on the
    // whole portfolio rather than half of it.
    const aliveOwnedTotal = alive.reduce((a, p) => a + (ownership[p.id] ?? 0), 0);
    const shareOf = (p: (typeof people)[number]) =>
      aliveOwnedTotal > 0 ? (ownership[p.id] ?? 0) / aliveOwnedTotal : 1 / alive.length;

    const drawdown = { cash: 0, investments: 0, superAccumulation: 0, superPension: 0, total: 0 };
    let realisedCapitalGain = 0;
    let shortfall = 0;
    let recontributed = 0;
    let taxPayable = 0;

    // Super benefits from a taxed source are tax-free from age 60, so pension payments and
    // withdrawals are excluded from taxable income.
    //
    // While everyone is still working, `annualSavings` is already net of tax on salary, so
    // charging the full salary tax against the portfolio as well would tax it twice. Only
    // the INCREMENTAL tax caused by investment income is charged - which is also the
    // correct marginal treatment, since that income stacks on top of salary.
    const taxFor = (gain: number) => {
      const discounted = gain * (1 - cgtDiscount);
      let charged = 0;
      let payable = 0;
      let medicareLevy = 0;
      let offsets = 0;
      for (const p of alive) {
        const share = shareOf(p);
        const pension = ap.byPerson[p.id] ?? 0;
        const saptoEligible = ages[p.id] >= pensionAge && pension > 0;
        const status = partnered ? ('couplePartnerEach' as const) : ('single' as const);
        const taxable =
          salaryOf[p.id] + partTimeOf[p.id] + (taxableInvestmentIncome + discounted) * share + pension;
        const full = personalIncomeTax(taxable, ry, { saptoEligible, saptoStatus: status });
        const netted = inRetirement
          ? 0
          : personalIncomeTax(salaryOf[p.id], ry, { saptoEligible, saptoStatus: status }).payable;
        charged += Math.max(0, full.payable - netted);
        payable += full.payable;
        medicareLevy += full.medicareLevy;
        offsets += full.lowIncomeTaxOffset + full.seniorsAndPensionersTaxOffset;
      }
      return { charged, payable, medicareLevy, offsets };
    };

    // CGT depends on how much is drawn, which depends on the tax bill, which depends on
    // CGT. Iterate to a fixed point - it converges in two or three passes.
    const opening = {
      cash: state.cash,
      offset: state.offset,
      investments: state.investments,
      costBase: state.investmentsCostBase,
      superAccumulation: { ...state.superAccumulation },
      superPension: { ...state.superPension },
    };
    for (let pass = 0; pass < 5; pass++) {
      state.cash = opening.cash;
      state.offset = opening.offset;
      state.investments = opening.investments;
      state.investmentsCostBase = opening.costBase;
      state.superAccumulation = { ...opening.superAccumulation };
      state.superPension = { ...opening.superPension };
      drawdown.cash = 0;
      drawdown.investments = 0;
      drawdown.superAccumulation = 0;
      drawdown.superPension = 0;
      realisedCapitalGain = 0;

      let need = totalSpending + taxPayable - spendableIncome;
      if (need < 0) {
        need = 0; // surplus simply stays in cash
      } else if (need > 0) {
        // Each source is a closure so the strategies below only have to choose an order.
        const takeCash = (want: number) => {
          const amt = Math.min(want, state.cash);
          state.cash -= amt;
          drawdown.cash += amt;
          return want - amt;
        };
        // Spending the offset is the most expensive liquid choice while a loan exists: it
        // gives up a return equal to the mortgage rate, and an untaxed one at that. So it
        // is drawn after cash and investments rather than before them.
        const takeOffset = (want: number) => {
          if (want <= 0 || state.offset <= 0) return want;
          const amt = Math.min(want, state.offset);
          state.offset -= amt;
          drawdown.cash += amt;
          return want - amt;
        };
        const takeInvestments = (want: number) => {
          if (want <= 0 || state.investments <= 0) return want;
          const amt = Math.min(want, state.investments);
          const gainFraction = (state.investments - state.investmentsCostBase) / state.investments;
          realisedCapitalGain += amt * gainFraction;
          state.investmentsCostBase -= amt * (state.investmentsCostBase / state.investments);
          state.investments -= amt;
          drawdown.investments += amt;
          return want - amt;
        };
        // Super is drawn proportionally across whoever can access it, rather than
        // draining one partner's account before touching the other's.
        const takeSuper = (want: number) => {
          let left = drawProportionally(want, alive, (p) => state.superPension[p.id], (p, amt) => {
            state.superPension[p.id] -= amt;
            drawdown.superPension += amt;
          });
          left = drawProportionally(
            left,
            alive.filter((p) => ages[p.id] >= preservation[p.id]),
            (p) => state.superAccumulation[p.id],
            (p, amt) => {
              state.superAccumulation[p.id] -= amt;
              drawdown.superAccumulation += amt;
            },
          );
          return left;
        };

        switch (strategy) {
          case 'superFirst':
            need = takeCash(need);
            need = takeSuper(need);
            need = takeInvestments(need);
            need = takeOffset(need);
            break;

          case 'proportional': {
            // Pro-rata across every accessible bucket, so the asset mix stays stable
            // instead of one bucket being emptied first.
            const accessibleSuper =
              alive.reduce((a, p) => a + state.superPension[p.id], 0) +
              alive.reduce(
                (a, p) => a + (ages[p.id] >= preservation[p.id] ? state.superAccumulation[p.id] : 0),
                0,
              );
            const pool = state.cash + state.offset + state.investments + accessibleSuper;
            if (pool <= 0) break;
            const want = Math.min(need, pool);
            const fromCash = takeCash(want * (state.cash / pool));
            const fromOffset = takeOffset(want * (state.offset / pool));
            const fromInv = takeInvestments(want * (state.investments / pool));
            const fromSuper = takeSuper(want * (accessibleSuper / pool));
            // Anything a bucket could not cover falls through to the others.
            need -= want - (fromCash + fromOffset + fromInv + fromSuper);
            need = takeCash(need);
            need = takeInvestments(need);
            need = takeOffset(need);
            need = takeSuper(need);
            break;
          }

          case 'cashBuffer': {
            // Spend from cash, then top the buffer back up from the other buckets so it
            // is there for the next bad year. This is the sequence-of-returns defence.
            need = takeCash(need);
            need = takeInvestments(need);
            need = takeOffset(need);
            need = takeSuper(need);
            const targetBuffer = totalSpending * bufferYears;
            let refill = Math.max(0, targetBuffer - state.cash);
            if (refill > 0) {
              const before = state.investments;
              const leftAfterInv = takeInvestments(refill);
              state.cash += before - state.investments;
              refill = leftAfterInv;
            }
            if (refill > 0) {
              const beforeSuper =
                alive.reduce((a, p) => a + state.superPension[p.id] + state.superAccumulation[p.id], 0);
              const leftAfterSuper = takeSuper(refill);
              const moved = beforeSuper -
                alive.reduce((a, p) => a + state.superPension[p.id] + state.superAccumulation[p.id], 0);
              state.cash += moved;
              refill = leftAfterSuper;
            }
            break;
          }

          case 'outsideSuperFirst':
          default:
            need = takeCash(need);
            need = takeInvestments(need);
            need = takeOffset(need);
            need = takeSuper(need);
            break;
        }
      }
      shortfall = Math.max(0, need);

      const t2 = taxFor(realisedCapitalGain).charged;
      if (Math.abs(t2 - taxPayable) < 1) {
        taxPayable = t2;
        break;
      }
      taxPayable = t2;
    }
    // A compulsory minimum pension payment that the year did not need sits in cash, where
    // it is deemed for the income test and its earnings are taxed at the marginal rate -
    // both of which stop the moment it goes back into super. Only what the minimum forced
    // out can go back, only while the person is under 75, and only within the
    // non-concessional cap. Placed after the year is funded, so it recontributes what is
    // genuinely left over, and before returns, so the money earns the super rate.
    if (household.recontributeExcessDrawdown && minimumPensionPayment > 0 && shortfall <= 0) {
      let room = Math.min(minimumPensionPayment, state.cash);
      for (const p of alive) {
        if (room <= 0) break;
        if (ages[p.id] >= 75) continue;
        const amount = Math.min(room, nonConcessionalCap * cpiIndex);
        state.superAccumulation[p.id] += amount;
        state.cash -= amount;
        recontributed += amount;
        room -= amount;
      }
    }

    drawdown.total =
      drawdown.cash + drawdown.investments + drawdown.superAccumulation + drawdown.superPension;

    const finalTax = taxFor(realisedCapitalGain);
    const personalTaxCharged = finalTax.charged;

    // --- 8. Returns on closing balances ---------------------------------------
    state.investments *= 1 + investmentGrowthRate;
    state.investmentsCostBase = Math.min(state.investmentsCostBase, state.investments);
    let superEarningsTax = 0;
    for (const p of alive) {
      const accumEarnings = state.superAccumulation[p.id] * ret.superAccumulation;
      const pensionEarnings = state.superPension[p.id] * ret.superAccumulation;
      superEarningsTax += accumEarnings * accumEarningsTax + pensionEarnings * pensionEarningsTax;
      state.superAccumulation[p.id] += accumEarnings * (1 - accumEarningsTax);
      state.superPension[p.id] += pensionEarnings * (1 - pensionEarningsTax);
    }
    state.primaryResidence *= 1 + ret.primaryResidence;

    // --- 9. Events -------------------------------------------------------------
    let downsizerContribution = 0;
    for (const ev of events) {
      if (ev.kind === 'death' || firedEvents.has(ev)) continue;
      const p = alive.find((x) => x.id === ev.personId);
      if (!p || ages[p.id] !== ev.atAge) continue;
      firedEvents.add(ev);

      if (ev.kind === 'downsize') {
        const e = ev as DownsizeEvent;
        const homeGrowth = Math.pow(1 + assumptions.returns.primaryResidence, t + 1);
        const salePrice = state.primaryResidence;
        const replacement = e.newHomeValue * homeGrowth;
        const netProceeds = salePrice * (1 - e.sellingCostRate) - replacement;
        state.primaryResidence = replacement;

        if (ages[p.id] >= downsizerMinAge) {
          downsizerContribution = Math.max(0, Math.min(netProceeds, downsizerCap));
          state.superAccumulation[p.id] += downsizerContribution;
          const rest = netProceeds - downsizerContribution;
          state[e.proceedsTo] += rest;
          if (e.proceedsTo === 'investments') state.investmentsCostBase += rest;
          eventLog.push(
            `Downsize at ${ev.atAge}: net proceeds ${Math.round(netProceeds).toLocaleString()}, ` +
              `${Math.round(downsizerContribution).toLocaleString()} as a downsizer super contribution.`,
          );
        } else {
          state[e.proceedsTo] += netProceeds;
          if (e.proceedsTo === 'investments') state.investmentsCostBase += netProceeds;
          eventLog.push(
            `Downsize at ${ev.atAge}: net proceeds ${Math.round(netProceeds).toLocaleString()} to ` +
              `${e.proceedsTo}. NOT eligible for a downsizer super contribution - that needs age ${downsizerMinAge}+.`,
          );
          warnings.push(
            `${p.name} downsizes at ${ev.atAge}, below the downsizer contribution age of ` +
              `${downsizerMinAge}, so the proceeds stay outside super where their earnings are taxable. ` +
              `Downsizing at ${downsizerMinAge}+ instead would shelter up to $${downsizerCap.toLocaleString()} per person.`,
          );
        }
      } else {
        const e = ev as LumpSumEvent;
        const amount = e.indexed === false ? e.amount : e.amount * cpiIndex;
        state[e.into] += amount;
        if (e.into === 'investments') state.investmentsCostBase += amount;
        eventLog.push(`${e.label}: ${Math.round(amount).toLocaleString()} into ${e.into}.`);
      }
    }

    // --- 10. Record ------------------------------------------------------------
    const superByPerson: Record<string, number> = {};
    for (const p of people) {
      superByPerson[p.id] = round(state.superAccumulation[p.id] + state.superPension[p.id]);
    }
    const superAccum = alive.reduce((a, p) => a + state.superAccumulation[p.id], 0);
    const superPen = alive.reduce((a, p) => a + state.superPension[p.id], 0);
    const accessible =
      state.cash +
      state.offset +
      state.investments +
      superPen +
      alive.reduce(
        (a, p) => a + (ages[p.id] >= preservation[p.id] ? state.superAccumulation[p.id] : 0),
        0,
      );

    rows.push({
      planYear: t,
      calendarYear,
      ages: { ...ages },
      alive: alive.map((p) => p.id),
      cpiIndex,
      income: {
        salary: round(salaryTotal),
        partTime: round(partTimeTotal),
        investmentIncome: round(taxableInvestmentIncome),
        superPensionPayments: round(minimumPensionPayment),
        total: round(spendableIncome),
      },
      contributions: {
        superGuarantee: round(sgTotal),
        voluntary: round(voluntaryTotal),
        recontributed: round(recontributed),
        downsizer: round(downsizerContribution),
        contributionsTax: round(contributionsTaxTotal),
        total: round(sgTotal + voluntaryTotal - contributionsTaxTotal + downsizerContribution),
      },
      spending: {
        baseline: round(baselineSpending),
        health: round(healthSpending),
        privateHealthInsurance: round(phiSpending),
        agedCare: round(agedCareSpending),
        oneOff: round(oneOffSpending),
        mortgage: round(mortgageSpending),
        total: round(totalSpending),
      },
      agePension: round(ap.entitlement),
      agePensionDetail: {
        byPerson: Object.fromEntries(
          Object.entries(ap.byPerson).map(([k, v]) => [k, round(v)]),
        ),
        maxRate: round(ap.maxRate),
        deemedIncome: round(ap.deemedIncome),
        assessedIncome: round(ap.assessedIncome),
        bindingTest: ap.bindingTest,
        exemptSuper: round(exemptSuper),
      },
      tax: {
        // What is actually charged against the portfolio. Before retirement this is the
        // incremental tax on investment income only; salary tax is inside `savings`.
        personal: round(personalTaxCharged),
        medicareLevy: round(finalTax.medicareLevy),
        offsets: round(finalTax.offsets),
        superEarnings: round(superEarningsTax),
        superContributions: round(contributionsTaxTotal),
        capitalGains: 0,
        total: round(personalTaxCharged + superEarningsTax + contributionsTaxTotal),
      },
      realisedCapitalGain: round(realisedCapitalGain),
      drawdown: {
        cash: round(drawdown.cash),
        investments: round(drawdown.investments),
        superAccumulation: round(drawdown.superAccumulation),
        superPension: round(drawdown.superPension),
        total: round(drawdown.total),
      },
      savings: round(savings),
      events: eventLog,
      balances: {
        cash: round(state.cash),
        investments: round(state.investments),
        investmentsCostBase: round(state.investmentsCostBase),
        offset: round(state.offset),
        superAccumulation: round(superAccum),
        superPension: round(superPen),
        superByPerson,
        primaryResidence: round(state.primaryResidence),
        // Net of what is still owed on the home.
        total: round(
          state.cash +
            state.offset +
            state.investments +
            superAccum +
            superPen +
            state.primaryResidence -
            state.mortgageBalance,
        ),
        accessible: round(accessible),
      },
      mortgage: {
        interest: round(mortgageYear?.interest ?? 0),
        interestSavedByOffset: round(mortgageYear?.interestSavedByOffset ?? 0),
        principalRepaid: round(mortgageYear?.principalRepaid ?? 0),
        balance: round(state.mortgageBalance),
      },
      shortfall: round(shortfall),
    });
  }

  const firstShort = rows.find((r) => r.shortfall > 0) ?? null;
  const bridge: BridgePeriod[] = people
    .filter((p) => p.retirementAge < preservation[p.id])
    .map((p) => {
      const inWindow = rows.filter(
        (r) => r.ages[p.id] >= p.retirementAge && r.ages[p.id] < preservation[p.id],
      );
      return {
        personId: p.id,
        startAge: p.retirementAge,
        endAge: preservation[p.id],
        years: preservation[p.id] - p.retirementAge,
        shortfall: round(inWindow.reduce((s, r) => s + r.shortfall, 0)),
      };
    });

  // Longevity, from the published life tables. This is reporting only in Phase 3 - the
  // projection itself still runs a single deterministic path to `planToAge`. Sampling
  // lifespan is Phase 4.
  const longevity: LongevityView[] = [];
  if (datasets.lifeTables) {
    for (const p of people) {
      const sex = p.sex;
      if (!sex) {
        warnings.push(
          `${p.name} has no gender recorded, so no life table applies and no longevity view ` +
            'is shown. Life expectancy at 65 differs by 2.6 years between the published tables.',
        );
        continue;
      }
      const table = datasets.lifeTables.tables[sex];
      const survival = survivalCurve(table, p.currentAge);
      longevity.push({
        personId: p.id,
        sex,
        lifeExpectancyAge: Math.round((p.currentAge + lifeExpectancy(table, p.currentAge)) * 10) / 10,
        ninetiethPercentileAge: lifespanPercentile(table, p.currentAge, 0.9),
        survivalToPlanEnd: Math.round((survival.get(assumptions.planToAge) ?? 0) * 1000) / 1000,
      });
    }
    for (const l of longevity) {
      if (assumptions.planToAge < l.ninetiethPercentileAge) {
        warnings.push(
          `The plan stops at ${assumptions.planToAge} but 10% of people of this age reach ` +
            `${l.ninetiethPercentileAge}. The build plan asks for the 90th percentile, not the mean - ` +
            'planning to the mean leaves a one-in-ten chance of outliving the projection.',
        );
      }
    }
  }

  return {
    scenario: scenario.name,
    ruleset: `${ruleset.id} (${ruleset.financialYear}, retrieved ${ruleset.retrievedAt})`,
    rows,
    longevity,
    mortgagePaidOffAge,
    totalMortgageInterest: round(totalMortgageInterest),
    totalOffsetInterestSaved: round(totalOffsetInterestSaved),
    moneyRunsOutAge: firstShort ? firstShort.ages[people[0].id] : null,
    moneyRunsOutYear: firstShort ? firstShort.calendarYear : null,
    bridge,
    warnings: [...new Set(warnings)],
    notModelled: [
      'Transfer of unused SAPTO between spouses, which would reduce a couple\'s tax where one partner has little income.',
      'Reversionary pension mechanics - a death benefit is credited against the survivor\'s transfer balance cap immediately here, rather than after the 12-month delay that really applies.',
      'Households of more than two people, and re-partnering.',
      'Franking credits on Australian share income, which would reduce the tax shown here.',
      'Investment property, rental income and any asset sale other than the downsize.',
      'Division 296 (the extra 15% on super earnings above $3m) - not reached on this plan, but not modelled either.',
      'Death-benefit tax on super paid to non-dependants, which affects the estate residual.',
      'Aged care as a probability-weighted cost - it is modelled here only as a deterministic stress test you switch on, not as a likelihood by age.',
      'Home care packages and the Support at Home program; only residential care is costed.',
      'The ASFA Retirement Standard benchmarks, which could not be retrieved.',
      'Monte Carlo, life tables and sequence-of-returns risk - this is a single deterministic path (Phase 4).',
    ],
  };
}
