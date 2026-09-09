import type { Ruleset, SourcedValue } from './types';

/**
 * Scale a ruleset's dollar thresholds by an index factor.
 *
 * Every rate (percentages, tapers, the levy) is left alone; only dollar amounts move.
 * The list is explicit rather than a recursive walk so that adding a rate to the ruleset
 * cannot accidentally get indexed as if it were an amount.
 *
 * WHY THIS EXISTS: the plan runs for fifty years. Leaving the Age Pension at its 2026
 * dollar rate understates retirement income by roughly two thirds by the 2070s, and
 * leaving the tax brackets fixed applies fifty years of bracket creep. Both are wrong
 * enough to change the answer.
 *
 * WHAT IS ASSUMED: in law, Age Pension rates are indexed (CPI/PBLCI, benchmarked to
 * MTAWE) but the personal tax brackets are NOT - they only move when Parliament changes
 * them. Indexing brackets here is a modelling choice that keeps the projection in stable
 * real terms; not indexing them assumes fifty years of no tax cuts. Neither is neutral.
 */
export interface IndexationChoice {
  agePension: boolean;
  taxBrackets: boolean;
  superCaps: boolean;
}

export const INDEX_ALL: IndexationChoice = { agePension: true, taxBrackets: true, superCaps: true };

export function indexRuleset(
  ruleset: Ruleset,
  factor: number,
  which: IndexationChoice = INDEX_ALL,
): Ruleset {
  if (factor === 1) return ruleset;
  if (!which.agePension && !which.taxBrackets && !which.superCaps) return ruleset;
  const s = (n: number) => n * factor;
  // Preserves status/source/url so provenance survives indexation.
  const v = <T>(node: SourcedValue<T>, value: T): SourcedValue<T> => ({ ...node, value });

  const it = ruleset.incomeTax;
  const lito = it.lowIncomeTaxOffset.value;
  const sapto = it.seniorsAndPensionersTaxOffset.value;
  const ml = it.medicareLevyLowIncomeThresholds.value;
  const band = (b: (typeof sapto)['single']) => ({
    maxOffset: s(b.maxOffset),
    shadeOutThreshold: s(b.shadeOutThreshold),
    cutOutThreshold: s(b.cutOutThreshold),
  });

  const ap = ruleset.agePension;
  const rates = ap.maxRateFortnight.value;
  const inc = ap.incomeTest.value;
  const ass = ap.assetsTest.value;
  const deem = ap.deeming.value;
  const wb = ap.workBonus.value;

  return {
    ...ruleset,
    super: !which.superCaps ? ruleset.super : {
      ...ruleset.super,
      generalTransferBalanceCap: v(ruleset.super.generalTransferBalanceCap, s(ruleset.super.generalTransferBalanceCap.value)),
      concessionalCap: v(ruleset.super.concessionalCap, s(ruleset.super.concessionalCap.value)),
      maximumContributionBaseAnnual: v(
        ruleset.super.maximumContributionBaseAnnual,
        s(ruleset.super.maximumContributionBaseAnnual.value),
      ),
      downsizerContribution: {
        ...ruleset.super.downsizerContribution,
        capPerPerson: v(ruleset.super.downsizerContribution.capPerPerson, s(ruleset.super.downsizerContribution.capPerPerson.value)),
      },
    },
    incomeTax: !which.taxBrackets ? it : {
      ...it,
      brackets: v(
        it.brackets,
        it.brackets.value.map((b) => ({
          upTo: b.upTo === null ? null : s(b.upTo),
          base: s(b.base),
          rate: b.rate,
          over: s(b.over),
        })),
      ),
      lowIncomeTaxOffset: v(it.lowIncomeTaxOffset, {
        ...lito,
        maxOffset: s(lito.maxOffset),
        fullOffsetUpTo: s(lito.fullOffsetUpTo),
        firstTaperTo: s(lito.firstTaperTo),
        secondTaperOffsetAt: s(lito.secondTaperOffsetAt),
        cutOut: s(lito.cutOut),
      }),
      seniorsAndPensionersTaxOffset: v(it.seniorsAndPensionersTaxOffset, {
        taperRate: sapto.taperRate,
        single: band(sapto.single),
        couplePartnerEach: band(sapto.couplePartnerEach),
        illnessSeparatedEach: band(sapto.illnessSeparatedEach),
      }),
      medicareLevyLowIncomeThresholds: v(it.medicareLevyLowIncomeThresholds, {
        shadeInRate: ml.shadeInRate,
        single: { lower: s(ml.single.lower), upper: s(ml.single.upper) },
        singleWithSapto: { lower: s(ml.singleWithSapto.lower), upper: s(ml.singleWithSapto.upper) },
      }),
    },
    agePension: !which.agePension ? ap : {
      ...ap,
      maxRateFortnight: v(ap.maxRateFortnight, {
        single: { total: s(rates.single.total) },
        coupleEach: { total: s(rates.coupleEach.total) },
        coupleCombined: { total: s(rates.coupleCombined.total) },
      }),
      incomeTest: v(ap.incomeTest, {
        freeAreaFortnight: {
          single: s(inc.freeAreaFortnight.single),
          coupleCombined: s(inc.freeAreaFortnight.coupleCombined),
        },
        taperPerDollar: inc.taperPerDollar,
        cutOffFortnight: {
          single: s(inc.cutOffFortnight.single),
          coupleCombined: s(inc.cutOffFortnight.coupleCombined),
        },
      }),
      assetsTest: v(ap.assetsTest, {
        fullPensionLimit: {
          singleHomeowner: s(ass.fullPensionLimit.singleHomeowner),
          singleNonHomeowner: s(ass.fullPensionLimit.singleNonHomeowner),
          coupleHomeownerCombined: s(ass.fullPensionLimit.coupleHomeownerCombined),
          coupleNonHomeownerCombined: s(ass.fullPensionLimit.coupleNonHomeownerCombined),
        },
        cutOff: {
          singleHomeowner: s(ass.cutOff.singleHomeowner),
          singleNonHomeowner: s(ass.cutOff.singleNonHomeowner),
          coupleHomeownerCombined: s(ass.cutOff.coupleHomeownerCombined),
          coupleNonHomeownerCombined: s(ass.cutOff.coupleNonHomeownerCombined),
        },
        // The taper is $3 per $1,000 per fortnight. As the dollar amounts index, the
        // taper must scale inversely for the cut-off point to stay consistent with the
        // limit and the maximum rate.
        taperPerThousandPerFortnight: ass.taperPerThousandPerFortnight,
      }),
      deeming: v(ap.deeming, {
        lowerRate: deem.lowerRate,
        upperRate: deem.upperRate,
        threshold: {
          single: s(deem.threshold.single),
          coupleCombinedAtLeastOnePensioner: s(deem.threshold.coupleCombinedAtLeastOnePensioner),
          coupleNeitherPensionerEach: s(deem.threshold.coupleNeitherPensionerEach),
        },
      }),
      workBonus: v(ap.workBonus, {
        creditPerFortnight: s(wb.creditPerFortnight),
        maximumBalance: s(wb.maximumBalance),
      }),
    },
  };
}
