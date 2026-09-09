'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FanBand } from '@retirement/engine';
import { compact, money } from './format';

/**
 * Monte Carlo fan chart.
 *
 * Recharts has no native band mark, so each band is drawn as a stacked area: the lower
 * bound is transparent and the visible area is the width of the band above it.
 */
export default function FanChart({ fan }: { fan: FanBand[] }) {
  const data = fan.map((b) => ({
    age: b.age,
    base: b.values.p10,
    band10to25: b.values.p25 - b.values.p10,
    band25to50: b.values.p50 - b.values.p25,
    band50to75: b.values.p75 - b.values.p50,
    band75to90: b.values.p90 - b.values.p75,
    Median: b.values.p50,
  }));

  return (
    <div className="h-[360px] w-full">
      <p className="mb-1 text-xs text-slate-600">
        Shaded band: the 10th to 90th percentile of simulated outcomes. Solid line: the median.
      </p>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 12 }}
            label={{ value: 'Age', position: 'insideBottom', offset: -4, fontSize: 12 }}
          />
          <YAxis tickFormatter={compact} tick={{ fontSize: 12 }} width={56} />
          <Tooltip
            formatter={(v, name) => [money(Number(v)), String(name)]}
            labelFormatter={(l) => `Age ${l}`}
          />
          <Area isAnimationActive={false} dataKey="base" stackId="f" stroke="none" fill="none" name="10th percentile" />
          <Area isAnimationActive={false} dataKey="band10to25" stackId="f" stroke="none" fill="#e0e7ff" name="10th–25th" />
          <Area isAnimationActive={false} dataKey="band25to50" stackId="f" stroke="none" fill="#c7d2fe" name="25th–50th" />
          <Area isAnimationActive={false} dataKey="band50to75" stackId="f" stroke="none" fill="#c7d2fe" name="50th–75th" />
          <Area isAnimationActive={false} dataKey="band75to90" stackId="f" stroke="none" fill="#e0e7ff" name="75th–90th" />
          <Line isAnimationActive={false} type="monotone" dataKey="Median" stroke="#4338ca" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
