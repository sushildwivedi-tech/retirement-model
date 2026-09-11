import { minimumDrawdownPercent } from './agePension';
import { toRealRow } from './report';
import { preservationAge } from './rules';
import type { ProjectionResult, Ruleset, Scenario, YearRow } from './types';

/**
 * The projection as a short list of dated turning points.
 *
 * The year table answers "what happens"; this answers "what happens NEXT, and when".
 * Everything here is DERIVED from rows the engine already produced - a milestone appears
 * because the projection did something, never because a date was hard-coded. That matters
 * for the same reason the ruleset is sourced: a list of ages typed from memory goes stale
 * the first time the law moves, and nothing in the app would notice.
 */
export type MilestoneKind =
  | 'start'
  | 'stopWork'
  | 'partTimeEnds'
  | 'preservationAge'
  | 'pensionPhase'
  | 'mortgageCleared'
  | 'downsize'
  | 'agePension'
  | 'exemptSuperEnds'
  | 'seniorsHealthCard'
  | 'agedCare'
  | 'death'
  | 'moneyRunsOut'
  | 'planEnds';

export interface Milestone {
  kind: MilestoneKind;
  calendarYear: number;
  /** Years from the start of the plan. Zero for anything already true today. */
  yearsAway: number;
  ages: Record<string, number>;
  /** One line naming the event. */
  title: string;
  /** What the projection says about that year. */
  detail: string;
  /** What to do about it, where the projection implies something to do. */
  action?: string;
  tone: 'good' | 'watch' | 'bad' | 'neutral';
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-AU')}`;

/** Order within a single year, so a timeline reads in the order things actually bite. */
const ORDER: MilestoneKind[] = [
  'start',
  'stopWork',
  'partTimeEnds',
  'preservationAge',
  'pensionPhase',
  'mortgageCleared',
  'downsize',
  'agePension',
  'exemptSuperEnds',
  'seniorsHealthCard',
  'agedCare',
  'death',
  'moneyRunsOut',
  'planEnds',
];

export function milestones(
  result: ProjectionResult,
  scenario: Scenario,
  ruleset: Ruleset,
  opts: { real?: boolean } = {},
): Milestone[] {
  // Today's dollars by default: a summary read by a person is compared against today's
  // prices, and $80,000 in 2061 means nothing to anybody.
  const real = opts.real !== false;
  const rows: YearRow[] = real ? result.rows.map(toRealRow) : result.rows;
  if (rows.length === 0) return [];

  const people = scenario.household.people;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const out: Milestone[] = [];

  const add = (row: YearRow, m: Omit<Milestone, 'calendarYear' | 'yearsAway' | 'ages'>) =>
    out.push({
      ...m,
      calendarYear: row.calendarYear,
      yearsAway: row.planYear - first.planYear,
      ages: row.ages,
    });

  /** The year a person is a given age and still alive, or undefined if the plan ends first. */
  const whenAged = (personId: string, age: number): YearRow | undefined =>
    rows.find((r) => r.ages[personId] === age && r.alive.includes(personId));

  const rowBefore = (row: YearRow): YearRow | undefined =>
    rows[rows.indexOf(row) - 1];

  // --- Today ------------------------------------------------------------------------
  // From the scenario rather than from row one: every row carries END-of-year balances,
  // so row one has already had a year of growth applied and is not what the household
  // owns today. The inputs are today, exactly, and need no deflating.
  const h = scenario.household;
  const spendableNow = h.cash + h.investments + (h.mortgage?.offsetBalance ?? 0);
  const superNow = people.reduce((t, p) => t + p.superBalance, 0);
  add(first, {
    kind: 'start',
    title: 'Where the plan starts',
    detail:
      `${money(spendableNow + superNow)} in total — ${money(superNow)} of it in super, ` +
      `${money(spendableNow)} outside it` +
      (h.primaryResidence > 0
        ? `, plus a home worth ${money(h.primaryResidence)}`
        : '. No home in the plan, so rent runs for the whole of it') +
      (h.mortgage && h.mortgage.balance > 0
        ? ` and ${money(h.mortgage.balance)} still owing on it.`
        : h.primaryResidence > 0
          ? ', owned outright.'
          : ''),
    tone: 'neutral',
  });

  // --- Work stops, per person -------------------------------------------------------
  for (const p of people) {
    const row = whenAged(p.id, p.retirementAge);
    if (!row || row === first) continue;
    const before = rowBefore(row);
    const preservation = preservationAge(
      p.dateOfBirth,
      ruleset.super.preservationAgeByDateOfBirth.value,
    );
    const bridge = result.bridge.find((b) => b.personId === p.id);
    add(row, {
      kind: 'stopWork',
      title: `${p.name} ${p.name === 'You' ? 'stop' : 'stops'} work at ${p.retirementAge}`,
      detail: before
        ? `Household salary falls from ${money(before.income.salary)} to ${money(row.income.salary)} a year.`
        : `Salary stops.`,
      action:
        bridge && bridge.years > 0
          ? `Super is locked until ${preservation}, so ${bridge.years} ` +
            `${bridge.years === 1 ? 'year' : 'years'} of spending has to come from outside it` +
            (bridge.shortfall > 0
              ? ` — and on these figures the household comes up ${money(bridge.shortfall)} short across that window.`
              : ' — which this plan covers.')
          : undefined,
      tone: bridge && bridge.shortfall > 0 ? 'bad' : 'neutral',
    });
  }

  // --- Part-time work ends ----------------------------------------------------------
  for (const p of people) {
    if (!p.partTimeIncome) continue;
    const row = whenAged(p.id, p.partTimeIncome.toAge);
    if (!row) continue;
    add(row, {
      kind: 'partTimeEnds',
      title: `${p.name === 'You' ? 'Your' : `${p.name}'s`} part-time income ends`,
      detail: `The ${money(p.partTimeIncome.amount)} a year stops at ${p.partTimeIncome.toAge}. Spending is funded entirely from assets from here.`,
      tone: 'watch',
    });
  }

  // --- Super unlocks ----------------------------------------------------------------
  for (const p of people) {
    const age = preservationAge(p.dateOfBirth, ruleset.super.preservationAgeByDateOfBirth.value);
    const row = whenAged(p.id, age);
    if (!row || row === first) continue;
    add(row, {
      kind: 'preservationAge',
      title: `${p.name === 'You' ? 'Your' : `${p.name}'s`} super unlocks at ${age}`,
      detail: `${money(row.balances.superByPerson[p.id] ?? 0)} becomes accessible — preservation age is ${age} for anyone born ${p.dateOfBirth.slice(0, 4)}.`,
      tone: 'good',
    });
  }

  // --- Pension phase ----------------------------------------------------------------
  const pensionPhase = rows.find(
    (r, i) => r.balances.superPension > 0 && (i === 0 || rows[i - 1].balances.superPension === 0),
  );
  if (pensionPhase && pensionPhase !== first) {
    const drawPct = minimumDrawdownPercent(pensionPhase.ages[people[0].id], ruleset);
    add(pensionPhase, {
      kind: 'pensionPhase',
      title: 'Super moves into pension phase',
      detail: `${money(pensionPhase.balances.superPension)} starts paying a pension. Earnings inside it are untaxed from here.`,
      action:
        drawPct > 0
          ? `A minimum of ${(drawPct * 100).toFixed(0)}% of the balance must be drawn each year, rising with age — whether or not it is needed. Anything not spent lands in cash, where it is deemed and taxed.`
          : undefined,
      tone: 'good',
    });
  }

  // --- Home loan --------------------------------------------------------------------
  if (result.mortgagePaidOffAge !== null) {
    const row = whenAged(people[0].id, result.mortgagePaidOffAge);
    if (row) {
      const before = rowBefore(row);
      add(row, {
        kind: 'mortgageCleared',
        title: 'The home loan is paid off',
        detail:
          `Repayments of about ${money(before?.spending.mortgage ?? row.spending.mortgage)} a year stop. ` +
          `Total interest over the life of the loan: ${money(result.totalMortgageInterest)}` +
          (result.totalOffsetInterestSaved > 0
            ? `, after the offset saved ${money(result.totalOffsetInterestSaved)}.`
            : '.'),
        action:
          'The repayment is free cash from this year. Directing it at super or investments is the least painful increase in savings in the whole plan, because nothing else has to be given up.',
        tone: 'good',
      });
    }
  }

  // --- Downsizing -------------------------------------------------------------------
  for (const e of scenario.events) {
    if (e.kind !== 'downsize') continue;
    const row = whenAged(e.personId, e.atAge);
    if (!row) continue;
    const minAge = ruleset.super.downsizerContribution.minimumAge.value;
    add(row, {
      kind: 'downsize',
      title: `Downsize at ${e.atAge}`,
      detail: `Move to a ${money(e.newHomeValue)} home, with ${(e.sellingCostRate * 100).toFixed(1)}% going in selling costs.`,
      action:
        e.atAge >= minAge
          ? `Up to ${money(ruleset.super.downsizerContribution.capPerPerson.value)} per person of the proceeds can go into super as a downsizer contribution, outside the usual caps.`
          : `Below ${minAge}, so the downsizer contribution is not available — the proceeds stay outside super, where their earnings are taxed at your marginal rate.`,
      tone: e.atAge >= minAge ? 'good' : 'watch',
    });
  }

  // --- Age Pension ------------------------------------------------------------------
  const firstPension = rows.find((r) => r.agePension > 0);
  if (firstPension) {
    const taperPerThousandPerYear =
      ruleset.agePension.assetsTest.value.taperPerThousandPerFortnight *
      ruleset.agePension.fortnightsPerYear.value;
    const test = firstPension.agePensionDetail.bindingTest;
    add(firstPension, {
      kind: 'agePension',
      title: 'The Age Pension starts',
      detail:
        `${money(firstPension.agePension)} a year` +
        (test === 'none'
          ? ' — the full rate, with neither test biting.'
          : ` — cut back from a full rate of ${money(firstPension.agePensionDetail.maxRate)} by the ${test} test.`),
      action:
        test === 'assets'
          ? `The assets test is binding, and it costs ${money(taperPerThousandPerYear)} of pension a year for every $1,000 of assessable assets above the free area. Spending down assessable assets, or moving them where the test cannot see them, is worth more here than an investment return.`
          : test === 'income'
            ? `The income test is binding. Deemed income of ${money(firstPension.agePensionDetail.deemedIncome)} is counted whether or not the money earned it — what the balances are, not what they paid.`
            : undefined,
      tone: 'good',
    });
  }

  // --- The exemption closing --------------------------------------------------------
  const exemptEnds = rows.find(
    (r, i) =>
      i > 0 &&
      rows[i - 1].agePensionDetail.exemptSuper > 0 &&
      r.agePensionDetail.exemptSuper === 0 &&
      rows[i - 1].agePension > 0,
  );
  if (exemptEnds) {
    const before = rowBefore(exemptEnds)!;
    const fall = before.agePension - exemptEnds.agePension;
    add(exemptEnds, {
      kind: 'exemptSuperEnds',
      title: 'Super stops being invisible to the pension tests',
      detail:
        `${money(before.agePensionDetail.exemptSuper)} of accumulation-phase super was ignored by both tests while its holder was under ${ruleset.agePension.eligibilityAge.value}. From this year it is counted` +
        (fall > 0 ? `, and the payment falls by ${money(fall)} a year.` : '.'),
      action:
        'This is the single largest step-down in the plan that nobody sees coming. It is worth re-running the numbers in the year before it, not the year after.',
      tone: fall > 0 ? 'watch' : 'neutral',
    });
  }

  // --- Seniors Health Card ----------------------------------------------------------
  const card = rows.find((r) => r.seniorsHealthCard);
  if (card) {
    add(card, {
      kind: 'seniorsHealthCard',
      title: 'Commonwealth Seniors Health Card',
      detail: `Of pension age, no pension payable, and income under the limit — so the card is available. It has to be claimed; it does not arrive on its own.`,
      tone: 'good',
    });
  }

  // --- Aged care --------------------------------------------------------------------
  const agedCare = rows.find((r) => r.spending.agedCare > 0);
  if (agedCare) {
    add(agedCare, {
      kind: 'agedCare',
      title: 'Residential aged care begins',
      detail: `${money(agedCare.spending.agedCare)} a year, on top of everything else. Modelled as a fixed stress test rather than a prediction.`,
      tone: 'watch',
    });
  }

  // --- A death ----------------------------------------------------------------------
  for (const e of scenario.events) {
    if (e.kind !== 'death') continue;
    const row = whenAged(e.personId, e.atAge);
    const person = people.find((p) => p.id === e.personId);
    if (!row || !person) continue;
    add(row, {
      kind: 'death',
      title: `${person.name} dies at ${e.atAge}`,
      detail: `Super passes to the survivor tax-free, spending steps down, and the single Age Pension rate applies from here — which is more than half the couple rate, so income falls by less than spending does.`,
      tone: 'neutral',
    });
  }

  // --- The money running out --------------------------------------------------------
  if (result.moneyRunsOutAge !== null) {
    const row = rows.find((r) => r.shortfall > 0);
    if (row) {
      add(row, {
        kind: 'moneyRunsOut',
        title: `Your own money runs out at ${result.moneyRunsOutAge}`,
        detail:
          row.agePension > 0
            ? `The Age Pension continues at ${money(row.agePension)} a year — ${Math.round((row.agePension / row.spending.total) * 100)}% of the ${money(row.spending.total)} this plan wants to spend.`
            : `There is no Age Pension yet — it does not start until ${ruleset.agePension.eligibilityAge.value} — so there is no income at all in this year.`,
        action:
          'Everything in the plan before this date is a chance to move it. Everything after it is not.',
        tone: 'bad',
      });
    }
  }

  // --- The end of the plan ----------------------------------------------------------
  const leftOver =
    last.balances.cash +
    last.balances.investments +
    last.balances.offset +
    last.balances.superAccumulation +
    last.balances.superPension;
  add(last, {
    kind: 'planEnds',
    title: `The plan ends`,
    detail:
      result.moneyRunsOutAge === null
        ? `${money(leftOver)} of spendable assets left` +
          (last.balances.primaryResidence > 0
            ? `, plus a home worth ${money(last.balances.primaryResidence)}.`
            : '.')
        : `Nothing spendable left` +
          (last.balances.primaryResidence > 0
            ? `, apart from a home worth ${money(last.balances.primaryResidence)}.`
            : '.'),
    tone: result.moneyRunsOutAge === null ? 'good' : 'bad',
  });

  return out.sort(
    (a, b) => a.calendarYear - b.calendarYear || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
}
