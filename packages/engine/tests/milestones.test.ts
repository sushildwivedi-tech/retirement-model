import { describe, expect, it } from 'vitest';
import { project } from '../src/engine';
import { milestones, type Milestone } from '../src/milestones';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';
import { baseCase } from '../src/fixtures/baseCase';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};

const run = (s: Scenario): Milestone[] =>
  milestones(project(s, ruleset, datasets), s, ruleset);

const kinds = (ms: Milestone[]) => ms.map((m) => m.kind);
const of = (ms: Milestone[], kind: Milestone['kind']) => ms.find((m) => m.kind === kind);

describe('milestones', () => {
  const base = run(baseCase);

  it('opens where the plan opens and closes where it closes', () => {
    expect(base[0].kind).toBe('start');
    expect(base[0].yearsAway).toBe(0);
    expect(base[base.length - 1].kind).toBe('planEnds');
  });

  it('runs forwards in time', () => {
    const years = base.map((m) => m.calendarYear);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it('dates each turning point by the year it happens, not by an age typed in', () => {
    // The base case retires at 47 with a preservation age of 60, from a 2026 start at 42.
    expect(of(base, 'stopWork')?.calendarYear).toBe(2026 + (47 - 42));
    expect(of(base, 'preservationAge')?.calendarYear).toBe(2026 + (60 - 42));
    expect(of(base, 'agePension')?.calendarYear).toBe(
      2026 + (ruleset.agePension.eligibilityAge.value - 42),
    );
  });

  it('warns that the bridge is unfunded when the projection says it is', () => {
    const stop = of(base, 'stopWork')!;
    const bridge = project(baseCase, ruleset, datasets).bridge[0];
    expect(stop.action).toContain(String(bridge.years));
    expect(stop.tone).toBe(bridge.shortfall > 0 ? 'bad' : 'neutral');
  });

  it('reports the money running out only when it does', () => {
    const lasts: Scenario = {
      ...baseCase,
      household: { ...baseCase.household, retirementSpending: 40_000, investments: 900_000 },
    };
    expect(kinds(run(lasts))).not.toContain('moneyRunsOut');

    const fails: Scenario = {
      ...baseCase,
      household: { ...baseCase.household, retirementSpending: 200_000 },
    };
    const ms = run(fails);
    expect(kinds(ms)).toContain('moneyRunsOut');
    expect(of(ms, 'moneyRunsOut')!.tone).toBe('bad');
    // And it must be dated to the year the projection itself names.
    expect(of(ms, 'moneyRunsOut')!.calendarYear).toBe(
      project(fails, ruleset, datasets).moneyRunsOutYear,
    );
  });

  it('speaks in today’s dollars by default, and in future dollars on request', () => {
    const result = project(baseCase, ruleset, datasets);
    const realEnd = milestones(result, baseCase, ruleset).at(-1)!;
    const nominalEnd = milestones(result, baseCase, ruleset, { real: false }).at(-1)!;
    expect(realEnd.detail).not.toEqual(nominalEnd.detail);
    // Fifty-odd years of CPI: the nominal figure has to be the larger of the two.
    const biggest = (s: string) =>
      Math.max(...[...s.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replaceAll(',', ''))));
    expect(biggest(nominalEnd.detail)).toBeGreaterThan(biggest(realEnd.detail));
  });

  it('gives a couple one unlock date each, and names whose it is', () => {
    const couple: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        people: [
          baseCase.household.people[0],
          {
            ...baseCase.household.people[0],
            id: 'partner',
            name: 'Partner',
            currentAge: 38,
            dateOfBirth: '1988-01-01',
            retirementAge: 50,
          },
        ],
      },
    };
    const ms = run(couple);
    const unlocks = ms.filter((m) => m.kind === 'preservationAge');
    expect(unlocks).toHaveLength(2);
    expect(unlocks[0].calendarYear).toBeLessThan(unlocks[1].calendarYear);
    expect(unlocks[1].title).toContain('Partner');
  });

  it('flags a downsize below the downsizer age as forfeiting the contribution', () => {
    const minAge = ruleset.super.downsizerContribution.minimumAge.value;
    const early: Scenario = {
      ...baseCase,
      events: [
        {
          kind: 'downsize',
          personId: 'you',
          atAge: minAge - 5,
          newHomeValue: 600_000,
          sellingCostRate: 0.03,
          proceedsTo: 'investments',
        },
      ],
    };
    expect(of(run(early), 'downsize')!.action).toContain('not available');

    const late: Scenario = {
      ...early,
      events: [{ ...early.events[0], kind: 'downsize', atAge: minAge }] as Scenario['events'],
    };
    expect(of(run(late), 'downsize')!.action).toContain('downsizer contribution');
    expect(of(run(late), 'downsize')!.tone).toBe('good');
  });

  it('never invents a milestone for something the projection did not do', () => {
    // No aged care, no death and no part-time work in the base case. It DOES downsize,
    // so that one has to be there - the point is that the list follows the scenario.
    expect(kinds(base)).not.toContain('agedCare');
    expect(kinds(base)).not.toContain('death');
    expect(kinds(base)).not.toContain('partTimeEnds');
    expect(kinds(base)).toContain('downsize');
  });
});
