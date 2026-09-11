import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  milestones,
  project,
  type HealthCostCurve,
  type LifeTables,
  type Ruleset,
} from '@retirement/engine';
import { defaults, toScenario, type FormInputs } from '../app/inputs';
import { summaryHtml, type SummaryInput } from '../app/summary-doc';

const load = <T,>(p: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, p), 'utf-8')) as T;

const ruleset = load<Ruleset>('../../../rules/au-2026-07.json');
const datasets = {
  lifeTables: load<LifeTables>('../../../data/au-life-tables-2020-22.json'),
  healthCostCurve: load<HealthCostCurve>('../../../data/au-health-cost-curve.json'),
};

function build(over: Partial<SummaryInput> = {}, form: FormInputs = defaults): SummaryInput {
  const scenario = toScenario(form, {
    phiInflation: ruleset.privateHealthInsurance.premiumGrowthRate.value,
  });
  const result = project(scenario, ruleset, datasets);
  return {
    form,
    scenario,
    result,
    ruleset,
    milestones: milestones(result, scenario, ruleset),
    headline: {
      age: 52,
      partnerAge: null,
      basis: 'confidence',
      confidence: 85,
      runs: 2000,
      centralAge: 49,
      plannedAge: form.retirementAge,
      plannedWorks: false,
      yearsFromPlan: 5,
    },
    levers: [
      { label: 'Work two more years', detail: 'Retire at 49', difference: '+4 yrs', runsOutAge: 84 },
    ],
    monteCarlo: null,
    planName: null,
    generatedAt: new Date('2026-09-11T00:00:00Z'),
    ...over,
  };
}

describe('the executive summary', () => {
  it('leads with the age and says which of the two answers it is', () => {
    const html = summaryHtml(build());
    expect(html).toContain('You could retire at 52');
    expect(html).toContain('85% confidence');
    // The central-path age is the caveat, not the headline, but it must still be there.
    expect(html).toContain('it would be 49');
  });

  it('falls back to the central path, and says so, before any simulation has run', () => {
    const html = summaryHtml(
      build({
        headline: {
          age: 49,
          partnerAge: null,
          basis: 'central',
          centralAge: 49,
          plannedAge: 47,
          plannedWorks: false,
          yearsFromPlan: 2,
        },
      }),
    );
    expect(html).toContain('returns land on the average every single year');
    expect(html).not.toContain('confidence over');
  });

  it('gives both ages when there is a partner', () => {
    const couple = { ...defaults, hasPartner: true };
    const html = summaryHtml(
      build({ headline: { ...build({}, couple).headline, partnerAge: 48 } }, couple),
    );
    expect(html).toContain('your partner at 48');
  });

  it('dates every milestone it carries', () => {
    const input = build();
    const html = summaryHtml(input);
    expect(input.milestones.length).toBeGreaterThan(3);
    for (const m of input.milestones) {
      expect(html).toContain(String(m.calendarYear));
      expect(html).toContain(m.title.replace(/'/g, '&#39;'));
    }
  });

  it('traces itself to the ruleset it was produced from', () => {
    const html = summaryHtml(build());
    expect(html).toContain(ruleset.id);
    expect(html).toContain(ruleset.retrievedAt);
    expect(html).toContain('not personal financial advice');
  });

  it('escapes a plan name rather than letting it write markup', () => {
    const html = summaryHtml(build({ planName: '<script>alert(1)</script> & "co"' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;co&quot;');
  });

  it('is a complete document, not a fragment', () => {
    const html = summaryHtml(build());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    // Self-contained: no network, so it still opens in ten years with the wifi off.
    expect(html).not.toMatch(/<(script|link|img)\b/i);
  });
});
