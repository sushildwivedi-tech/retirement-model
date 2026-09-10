import { describe, expect, it } from 'vitest';
import { monteCarlo, DEFAULT_CORRELATIONS, DEFAULT_VOLATILITY } from '../src/montecarlo';
import { project } from '../src/engine';
import { cholesky, correlatedNormals, makeNormal, makeRng, percentile } from '../src/random';
import { loadRuleset, loadDataset } from '../src/loadRuleset';
import { baseCase } from '../src/fixtures/baseCase';
import type { HealthCostCurve, LifeTables, Scenario } from '../src/types';

const ruleset = loadRuleset('au-2026-07');
const datasets = {
  lifeTables: loadDataset<LifeTables>('au-life-tables-2020-22'),
  healthCostCurve: loadDataset<HealthCostCurve>('au-health-cost-curve'),
};

describe('seeded randomness', () => {
  it('is reproducible for a given seed', () => {
    const a = Array.from({ length: 5 }, makeRng(99));
    const b = Array.from({ length: 5 }, makeRng(99));
    expect(a).toEqual(b);
  });

  it('differs between seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('produces standard normals with about the right mean and spread', () => {
    const n = makeNormal(makeRng(7));
    const xs = Array.from({ length: 20_000 }, n);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(sd).toBeCloseTo(1, 1);
  });

  it('reproduces the requested correlation', () => {
    const L = cholesky([
      [1, 0.8],
      [0.8, 1],
    ]);
    const n = makeNormal(makeRng(3));
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const [x, y] = correlatedNormals(L, n);
      xs.push(x);
      ys.push(y);
    }
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      vx += (xs[i] - mx) ** 2;
      vy += (ys[i] - my) ** 2;
    }
    expect(cov / Math.sqrt(vx * vy)).toBeCloseTo(0.8, 1);
  });

  it('rejects a correlation matrix that is not positive definite', () => {
    expect(() =>
      cholesky([
        [1, 1.5],
        [1.5, 1],
      ]),
    ).toThrow(/positive definite/);
  });

  it('computes percentiles by interpolation', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, 20], 0)).toBe(10);
    expect(percentile([10, 20], 1)).toBe(20);
  });
});

describe('Monte Carlo', () => {
  it('collapses to the deterministic projection when volatility is zero', () => {
    // The strongest check on the whole apparatus: with no randomness the answer must be
    // exactly the one the deterministic engine gives.
    const zeroVol: Scenario = {
      ...baseCase,
      assumptions: {
        ...baseCase.assumptions,
        volatility: { cash: 0, investments: 0, superAccumulation: 0, primaryResidence: 0 },
      },
    };
    const mc = monteCarlo(zeroVol, ruleset, datasets, { runs: 10, seed: 5 });
    const det = project(baseCase, ruleset, datasets);
    expect(mc.successProbability).toBe(det.moneyRunsOutAge === null ? 1 : 0);
    expect(mc.medianFailureAge).toBe(det.moneyRunsOutAge);
    for (const band of mc.fan) {
      expect(band.values.p10).toBe(band.values.p90);
    }
  });

  it('is reproducible for a given seed and differs for another', () => {
    const a = monteCarlo(baseCase, ruleset, datasets, { runs: 200, seed: 1 });
    const b = monteCarlo(baseCase, ruleset, datasets, { runs: 200, seed: 1 });
    const c = monteCarlo(baseCase, ruleset, datasets, { runs: 200, seed: 2 });
    expect(a.successProbability).toBe(b.successProbability);
    expect(a.fan.map((f) => f.values.p50)).toEqual(b.fan.map((f) => f.values.p50));
    // Success probability is discretised to n/runs, so two seeds can land on the same
    // value by chance. The median path is what actually distinguishes them.
    expect(a.fan.map((f) => f.values.p50)).not.toEqual(c.fan.map((f) => f.values.p50));
  });

  it('orders the fan percentiles correctly at every year', () => {
    const mc = monteCarlo(baseCase, ruleset, datasets, { runs: 300, seed: 11 });
    for (const band of mc.fan) {
      expect(band.values.p10).toBeLessThanOrEqual(band.values.p25);
      expect(band.values.p25).toBeLessThanOrEqual(band.values.p50);
      expect(band.values.p50).toBeLessThanOrEqual(band.values.p75);
      expect(band.values.p75).toBeLessThanOrEqual(band.values.p90);
    }
  });

  it('gets worse as spending rises', () => {
    const spend = (v: number): Scenario => ({
      ...baseCase,
      household: { ...baseCase.household, retirementSpending: v },
    });
    const low = monteCarlo(spend(40_000), ruleset, datasets, { runs: 400, seed: 4 });
    const high = monteCarlo(spend(90_000), ruleset, datasets, { runs: 400, seed: 4 });
    expect(low.successProbability).toBeGreaterThan(high.successProbability);
  });

  it('runs 5,000 paths inside the build plan’s ~5 second target', () => {
    const mc = monteCarlo(baseCase, ruleset, datasets, { runs: 5000, seed: 42 });
    expect(mc.runs).toBe(5000);
    expect(mc.elapsedMs).toBeLessThan(5000);
  });

  it('flags that volatility and correlations are assumed, not sourced', () => {
    const mc = monteCarlo(baseCase, ruleset, datasets, { runs: 50, seed: 1 });
    expect(mc.notes.join(' ')).toMatch(/ASSUMED/);
    expect(mc.notes.join(' ')).toMatch(/correlation/i);
  });

  it('says so when lifespan sampling is asked for but cannot be applied', () => {
    // baseCase has no gender recorded, so there is no table to sample from.
    const mc = monteCarlo(baseCase, ruleset, datasets, { runs: 20, seed: 1, sampleLifespan: true });
    expect(mc.notes.join(' ')).toMatch(/needs life tables and a gender/);
  });

  it('samples lifespan once a gender is recorded, which raises success', () => {
    const withSex: Scenario = {
      ...baseCase,
      household: {
        ...baseCase.household,
        people: [{ ...baseCase.household.people[0], sex: 'female' }],
      },
    };
    const fixed = monteCarlo(withSex, ruleset, datasets, { runs: 600, seed: 8 });
    const sampled = monteCarlo(withSex, ruleset, datasets, { runs: 600, seed: 8, sampleLifespan: true });
    // Many sampled lives end before 95, so the money has fewer years to fail in.
    expect(sampled.successProbability).toBeGreaterThan(fixed.successProbability);
  });

  it('uses a documented default correlation matrix that is symmetric with unit diagonal', () => {
    for (let i = 0; i < DEFAULT_CORRELATIONS.length; i++) {
      expect(DEFAULT_CORRELATIONS[i][i]).toBe(1);
      for (let j = 0; j < DEFAULT_CORRELATIONS.length; j++) {
        expect(DEFAULT_CORRELATIONS[i][j]).toBe(DEFAULT_CORRELATIONS[j][i]);
      }
    }
    expect(() => cholesky(DEFAULT_CORRELATIONS)).not.toThrow();
    expect(DEFAULT_VOLATILITY.cash).toBeLessThan(DEFAULT_VOLATILITY.superAccumulation);
  });
});
