import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * Twenty seconds, against a default of five.
     *
     * Nothing in this suite is time-dependent by design: every Monte Carlo path is
     * seeded, and `Date.now()` appears only in the `elapsedMs` a result reports, never in
     * a branch. The goal-seek tests are simply EXPENSIVE - a bisection of fourteen probes
     * at 200 paths each is roughly 2,800 projections - and they measured 3.5-4.3s on this
     * machine under load, against a 5s default. Anything else running on the box pushed
     * them over, and a deterministic test then failed for reasons that had nothing to do
     * with what it was asserting.
     *
     * The one genuine performance budget - Monte Carlo's "5,000 paths in ~5 seconds" -
     * keeps asserting its own elapsed time, which is where that check belongs. The
     * difference matters for diagnosis: with headroom, a slow run now fails saying it
     * took 6,200ms, instead of a bare "timed out" that names no number at all.
     */
    testTimeout: 20_000,
  },
});
