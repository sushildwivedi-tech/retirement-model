'use client';

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearRow } from '@retirement/engine';
import { compact, money } from './format';
import { fiveYearTicks } from './chart-ticks';

/**
 * Spending composition through retirement.
 *
 * The point of the chart is the crossing story the build plan describes: baseline
 * spending steps DOWN through go-go / slow-go / no-go while health costs climb, and
 * aged care, if switched on, dwarfs both.
 */
export default function HealthChart({ rows, personId }: { rows: YearRow[]; personId: string }) {
  const data = rows
    .filter((r) => r.spending.total > 0)
    .map((r) => ({
      age: r.ages[personId],
      Baseline: r.spending.baseline,
      Health: r.spending.health,
      'Health insurance': r.spending.privateHealthInsurance,
      'Aged care': r.spending.agedCare,
      'One-off': r.spending.oneOff,
      'Age Pension': r.agePension,
    }));

  if (data.length === 0) {
    return <p className="p-4 text-sm text-slate-500">No retirement years in this projection yet.</p>;
  }

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="age"
            ticks={fiveYearTicks(data.map((d) => d.age))}
            tick={{ fontSize: 12 }}
            label={{ value: 'Age', position: 'insideBottom', offset: -4, fontSize: 12 }}
          />
          <YAxis tickFormatter={compact} tick={{ fontSize: 12 }} width={56} />
          <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(l) => `Age ${l}`} />
          <Legend />
          <Bar isAnimationActive={false} dataKey="Baseline" stackId="s" fill="#cbd5e1" />
          <Bar isAnimationActive={false} dataKey="Health" stackId="s" fill="#fb923c" />
          <Bar isAnimationActive={false} dataKey="Health insurance" stackId="s" fill="#fcd34d" />
          <Bar isAnimationActive={false} dataKey="Aged care" stackId="s" fill="#f87171" />
          <Bar isAnimationActive={false} dataKey="One-off" stackId="s" fill="#a78bfa" />
          <Line
            isAnimationActive={false}
            type="monotone"
            dataKey="Age Pension"
            stroke="#047857"
            strokeWidth={2}
            dot={false}
          />
          <Area isAnimationActive={false} dataKey="__none" fill="none" stroke="none" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
