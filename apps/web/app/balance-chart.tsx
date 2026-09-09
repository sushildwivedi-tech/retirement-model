'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearRow } from '@retirement/engine';
import { compact, money } from './format';

/**
 * Stacked spendable balances by age. The home is drawn separately - it is not spendable.
 *
 * Entrance animation is off: the projection re-runs on every keystroke, so an animated
 * reveal would restart constantly, and it stalls outright when the tab renders hidden.
 */
export default function BalanceChart({ rows, personId }: { rows: YearRow[]; personId: string }) {
  const data = rows.map((r) => ({
    age: r.ages[personId],
    Cash: r.balances.cash,
    Investments: r.balances.investments,
    Super: r.balances.superAccumulation + r.balances.superPension,
    Home: r.balances.primaryResidence,
  }));

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="age" tick={{ fontSize: 12 }} label={{ value: 'Age', position: 'insideBottom', offset: -4, fontSize: 12 }} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 12 }} width={56} />
          <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(l) => `Age ${l}`} />
          <Legend />
          <Area isAnimationActive={false} type="monotone" dataKey="Cash" stackId="spendable" stroke="#0891b2" fill="#67e8f9" />
          <Area isAnimationActive={false} type="monotone" dataKey="Investments" stackId="spendable" stroke="#4338ca" fill="#a5b4fc" />
          <Area isAnimationActive={false} type="monotone" dataKey="Super" stackId="spendable" stroke="#047857" fill="#6ee7b7" />
          <Area isAnimationActive={false} type="monotone" dataKey="Home" stackId="home" stroke="#94a3b8" fill="#e2e8f0" fillOpacity={0.6} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
