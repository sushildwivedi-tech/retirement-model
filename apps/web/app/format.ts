export const money = (n: number): string =>
  n === 0
    ? '—'
    : new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: 'AUD',
        maximumFractionDigits: 0,
      }).format(n);

export const compact = (n: number): string =>
  new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
