'use client';

import {
  Area,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearRow } from '@retirement/engine';
import { compact, money } from './format';
import { fiveYearTicks } from './chart-ticks';

/**
 * Spendable balances by age: cash, investments and super, stacked.
 *
 * The home is deliberately NOT in the stack. It is usually the largest number in the
 * household and it is not spendable, so stacking it flattened the money that actually
 * funds retirement into a sliver at the bottom of the chart - the run-out year, which is
 * the whole point of the picture, became invisible. It is available as a line on its own
 * axis for anyone who wants to see it.
 *
 * Entrance animation is off: the projection re-runs on every keystroke, so an animated
 * reveal would restart constantly, and it stalls outright when the tab renders hidden.
 */
export default function BalanceChart({
  rows,
  personId,
  showHome = false,
  retirementAge,
  pensionAge,
}: {
  rows: YearRow[];
  personId: string;
  showHome?: boolean;
  retirementAge?: number;
  pensionAge?: number;
}) {
  const data = rows.map((r) => ({
    age: r.ages[personId],
    Cash: r.balances.cash,
    Investments: r.balances.investments,
    Super: r.balances.superAccumulation + r.balances.superPension,
    Home: r.balances.primaryResidence,
  }));
  const ticks = fiveYearTicks(data.map((d) => d.age));
  const hasHome = data.some((d) => d.Home > 0);

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 20, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="age"
            ticks={ticks}
            tick={{ fontSize: 12 }}
            label={{ value: 'Age', position: 'insideBottom', offset: -4, fontSize: 12 }}
          />
          <YAxis yAxisId="spendable" tickFormatter={compact} tick={{ fontSize: 12 }} width={56} />
          {showHome && hasHome && (
            <YAxis
              yAxisId="home"
              orientation="right"
              tickFormatter={compact}
              tick={{ fontSize: 11, fill: '#64748b' }}
              width={52}
            />
          )}
          <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(l) => `Age ${l}`} />
          <Legend />
          {retirementAge !== undefined && (
            <ReferenceLine
              yAxisId="spendable"
              x={retirementAge}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              label={{ value: 'stop work', position: 'top', fontSize: 10, fill: '#64748b' }}
            />
          )}
          {pensionAge !== undefined && (
            <ReferenceLine
              yAxisId="spendable"
              x={pensionAge}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              label={{ value: 'Age Pension', position: 'top', fontSize: 10, fill: '#64748b' }}
            />
          )}
          <Area yAxisId="spendable" isAnimationActive={false} type="monotone" dataKey="Cash" stackId="spendable" stroke="#0891b2" fill="#67e8f9" />
          <Area yAxisId="spendable" isAnimationActive={false} type="monotone" dataKey="Investments" stackId="spendable" stroke="#4338ca" fill="#a5b4fc" />
          <Area yAxisId="spendable" isAnimationActive={false} type="monotone" dataKey="Super" stackId="spendable" stroke="#047857" fill="#6ee7b7" />
          {showHome && hasHome && (
            <Line
              yAxisId="home"
              isAnimationActive={false}
              type="monotone"
              dataKey="Home"
              stroke="#94a3b8"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
