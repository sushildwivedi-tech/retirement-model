'use client';

import type { Milestone, ProjectionResult, Ruleset, Scenario } from '@retirement/engine';
import type { FormInputs } from './inputs';
import { money } from './format';

/**
 * The plan as a one-page document you can keep, print or send to someone.
 *
 * A self-contained HTML file rather than a PDF: no library, no server, nothing to install,
 * and Cmd-P turns it into a PDF anyway with the print styles below doing the work. It is
 * also still readable in ten years, which a screenshot is not.
 *
 * Everything in it is passed in already computed. This module decides what a reader needs
 * and in what order - it never re-runs the model, so the document cannot disagree with the
 * screen it was produced from.
 */

export interface SummaryHeadline {
  /** The age on the front page, whichever basis produced it. */
  age: number | null;
  /** The partner's matching age, when there is a partner. */
  partnerAge: number | null;
  basis: 'confidence' | 'central';
  /** Target confidence, as a percentage, when that is the basis. */
  confidence?: number;
  /** Simulated futures behind the confident answer. */
  runs?: number;
  /** The central-path age, always, so the document can show both. */
  centralAge: number | null;
  plannedAge: number;
  plannedWorks: boolean;
  /** Years the plan is early (positive) or could be brought forward (negative). */
  yearsFromPlan: number | null;
}

export interface SummaryLever {
  label: string;
  detail: string;
  difference: string;
  runsOutAge: number | null;
}

export interface SummaryInput {
  form: FormInputs;
  scenario: Scenario;
  result: ProjectionResult;
  ruleset: Ruleset;
  milestones: Milestone[];
  headline: SummaryHeadline;
  levers: SummaryLever[];
  monteCarlo: { successProbability: number; runs: number; medianFailureAge: number | null } | null;
  planName: string | null;
  generatedAt: Date;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`);

const longDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-AU', { dateStyle: 'long' }).format(d);

const away = (years: number): string =>
  years === 0 ? 'this year' : years === 1 ? 'in 1 year' : `in ${years} years`;

/** Ages in the year a milestone lands, written the way a person would say them. */
function agesAt(m: Milestone, form: FormInputs): string {
  const ids = Object.keys(m.ages);
  if (!form.hasPartner || ids.length < 2) return `age ${m.ages[ids[0]]}`;
  return `ages ${ids.map((id) => m.ages[id]).join(' and ')}`;
}

export function summaryHtml(input: SummaryInput): string {
  const { form, result, ruleset, milestones, headline, levers, monteCarlo } = input;
  const couple = form.hasPartner;
  const title = input.planName ? `${input.planName} — executive summary` : 'Retirement plan — executive summary';

  const answer = (() => {
    if (headline.age === null) {
      return {
        heading: 'No retirement age works on these numbers',
        line: `Even working to ${form.planToAge} does not fund ${money(form.retirementSpending)} a year of spending. The changes on page two are not optional refinements; one of them has to happen.`,
      };
    }
    const heading = couple
      ? `You could retire at ${headline.age}, your partner at ${headline.partnerAge}`
      : `You could retire at ${headline.age}`;
    const line = headline.plannedWorks
      ? `The plan is to stop at ${headline.plannedAge}, and that works — the money lasts to ${form.planToAge}.` +
        (headline.yearsFromPlan !== null && headline.yearsFromPlan < 0
          ? ` On these figures you could go ${-headline.yearsFromPlan} ${-headline.yearsFromPlan === 1 ? 'year' : 'years'} sooner.`
          : '')
      : `The plan is to stop at ${headline.plannedAge}, which is ${headline.yearsFromPlan} ${headline.yearsFromPlan === 1 ? 'year' : 'years'} too early — on that plan the money runs out at ${result.moneyRunsOutAge}.`;
    return { heading, line };
  })();

  const basisNote =
    headline.basis === 'confidence'
      ? `Measured at ${headline.confidence}% confidence over ${(headline.runs ?? 0).toLocaleString()} simulated futures.` +
        (headline.centralAge !== null && headline.centralAge !== headline.age
          ? ` If returns landed on the average every single year — which they will not — it would be ${headline.centralAge}.`
          : '')
      : 'The central path: it assumes returns land on the average every single year, which they will not. The simulated answer is always the later of the two.';

  const facts: Array<[string, string]> = [
    ['Spending target in retirement', `${money(form.retirementSpending)} a year, in today's dollars`],
    ['Plan runs to age', String(form.planToAge)],
    [
      couple ? 'Ages today' : 'Age today',
      couple ? `${form.currentAge} and ${form.partnerCurrentAge}` : String(form.currentAge),
    ],
    ['Super today', money(form.superBalance + (couple ? form.partnerSuperBalance : 0))],
    ['Outside super today', money(form.cash + form.investments + (form.hasMortgage ? form.offsetBalance : 0))],
    ['Home', form.ownsHome ? money(form.primaryResidence) : `Renting, ${money(form.rentPerWeek)} a week`],
    ...(form.hasMortgage && form.mortgageBalance > 0
      ? ([['Owing on the home loan', money(form.mortgageBalance)]] as Array<[string, string]>)
      : []),
    [
      'Own money runs out at',
      result.moneyRunsOutAge === null
        ? `Never — it lasts to ${form.planToAge}`
        : `Age ${result.moneyRunsOutAge}, in ${result.moneyRunsOutYear}`,
    ],
    ...(monteCarlo
      ? ([
          [
            'Simulated success',
            `${(monteCarlo.successProbability * 100).toFixed(0)}% of ${monteCarlo.runs.toLocaleString()} futures never ran out`,
          ],
        ] as Array<[string, string]>)
      : []),
  ];

  const rows = milestones
    .map(
      (m) => `
      <tr class="tone-${m.tone}">
        <td class="when">
          <div class="year">${m.calendarYear}</div>
          <div class="sub">${esc(away(m.yearsAway))}</div>
          <div class="sub">${esc(agesAt(m, form))}</div>
        </td>
        <td>
          <div class="what">${esc(m.title)}</div>
          <div class="detail">${esc(m.detail)}</div>
          ${m.action ? `<div class="action"><span class="arrow">→</span> ${esc(m.action)}</div>` : ''}
        </td>
      </tr>`,
    )
    .join('');

  const leverRows = levers
    .map(
      (l) => `
      <tr>
        <td>
          <div class="what">${esc(l.label)}</div>
          <div class="detail">${esc(l.detail)}</div>
        </td>
        <td class="num">${esc(l.difference)}</td>
        <td class="num">${l.runsOutAge === null ? 'never runs out' : `age ${l.runsOutAge}`}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root {
    --ink: #16181d;
    --soft: #3d434f;
    --mute: #6b7280;
    --rule: #d9dde5;
    --sunk: #f5f6f8;
    --good: #166534;
    --watch: #92400e;
    --bad: #9f1239;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px 32px 64px;
    color: var(--ink);
    background: #fff;
    font: 15px/1.55 "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .sheet { max-width: 46rem; margin: 0 auto; }
  h1, h2, .answer { font-family: Spectral, Georgia, "Iowan Old Style", serif; font-weight: 600; }
  h1 { font-size: 1.05rem; letter-spacing: 0.01em; margin: 0; }
  h2 {
    font-size: 1.05rem; margin: 2.4rem 0 0.6rem;
    padding-bottom: 0.35rem; border-bottom: 1px solid var(--rule);
  }
  .masthead {
    display: flex; flex-wrap: wrap; gap: 0.5rem 1rem;
    align-items: baseline; justify-content: space-between;
    padding-bottom: 0.6rem; border-bottom: 2px solid var(--ink);
  }
  .stamp { font-size: 0.72rem; color: var(--mute); font-variant-numeric: tabular-nums; }
  .answer { font-size: 2.1rem; line-height: 1.15; margin: 1.6rem 0 0.5rem; letter-spacing: -0.01em; }
  .lede { font-size: 1rem; color: var(--soft); margin: 0 0 0.6rem; max-width: 34rem; }
  .basis { font-size: 0.8rem; color: var(--mute); margin: 0; max-width: 34rem; }
  dl.facts {
    margin: 1.2rem 0 0; display: grid; grid-template-columns: 1fr auto;
    gap: 0; border-top: 1px solid var(--rule);
  }
  dl.facts dt, dl.facts dd {
    margin: 0; padding: 0.42rem 0; border-bottom: 1px solid var(--rule); font-size: 0.85rem;
  }
  dl.facts dt { color: var(--mute); }
  dl.facts dd { text-align: right; font-weight: 500; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.6rem 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
  td.when { width: 7.5rem; padding-right: 1rem; }
  .year { font-weight: 600; font-variant-numeric: tabular-nums; }
  .sub { font-size: 0.72rem; color: var(--mute); }
  .what { font-weight: 600; }
  .detail { color: var(--soft); font-size: 0.87rem; margin-top: 0.1rem; }
  .action { font-size: 0.83rem; margin-top: 0.35rem; color: var(--ink); }
  .arrow { color: var(--mute); }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 8rem; }
  thead td { border-bottom: 1px solid var(--ink); font-size: 0.7rem; text-transform: uppercase;
             letter-spacing: 0.06em; color: var(--mute); padding-bottom: 0.3rem; }
  tr.tone-good .year { color: var(--good); }
  tr.tone-watch .year { color: var(--watch); }
  tr.tone-bad .year { color: var(--bad); }
  tr.tone-bad .what { color: var(--bad); }
  ul { margin: 0.4rem 0 0; padding-left: 1.1rem; color: var(--soft); font-size: 0.87rem; }
  li { margin-bottom: 0.2rem; }
  .fine { font-size: 0.75rem; color: var(--mute); margin-top: 2rem; }
  .hint {
    margin: 0 auto 1.5rem; max-width: 46rem; padding: 0.6rem 0.8rem;
    background: var(--sunk); border: 1px solid var(--rule); border-radius: 8px;
    font-size: 0.8rem; color: var(--soft);
  }
  @media print {
    body { padding: 0; font-size: 11.5pt; }
    .hint { display: none; }
    tr, dl.facts > * { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
  @page { margin: 18mm 16mm; }
</style>
</head>
<body>
<div class="hint">Print this page (⌘P / Ctrl-P) to keep it as a PDF. Nothing here is live — it is a snapshot of the plan as it stood on ${esc(longDate(input.generatedAt))}.</div>
<div class="sheet">
  <div class="masthead">
    <h1>${esc(input.planName ?? 'Retirement plan')} — executive summary</h1>
    <div class="stamp">${esc(longDate(input.generatedAt))} · rules ${esc(ruleset.id)}</div>
  </div>

  <div class="answer">${esc(answer.heading)}</div>
  <p class="lede">${esc(answer.line)}</p>
  <p class="basis">${esc(basisNote)}</p>

  <dl class="facts">
    ${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('\n    ')}
  </dl>

  <h2>What happens, and when</h2>
  <table>${rows}</table>

  ${
    levers.length > 0
      ? `<h2>What would move it</h2>
  <table>
    <thead><tr><td>Change</td><td class="num">Difference</td><td class="num">Money lasts to</td></tr></thead>
    <tbody>${leverRows}</tbody>
  </table>
  <p class="basis" style="margin-top:0.6rem">Ranked by outcome, not by what the change costs you. Working longer and spending less are not equivalent sacrifices, and only you can weigh them.</p>`
      : ''
  }

  ${
    result.notModelled.length > 0
      ? `<h2>What this does not cover</h2><ul>${result.notModelled.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
      : ''
  }

  <p class="fine">
    General information only — not personal financial advice. Every regulated figure behind this
    plan (super guarantee, contribution caps, tax scales, Age Pension rates, deeming, aged-care
    fees) comes from the ${esc(ruleset.id)} ruleset, effective ${esc(ruleset.effectiveDate)} and
    retrieved ${esc(ruleset.retrievedAt)}. Figures are in today's dollars unless stated. Rates
    change: re-run this before acting on it.
  </p>
</div>
</body>
</html>`;
}

/** Hand the document to the browser as a file. */
export function downloadSummary(input: SummaryInput): void {
  const stamp = input.generatedAt.toISOString().slice(0, 10);
  const name = (input.planName ?? 'retirement').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([summaryHtml(input)], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name || 'retirement'}-summary-${stamp}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}
