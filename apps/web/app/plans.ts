'use client';

import type { FormInputs } from './inputs';

/**
 * Talking to the laptop app.
 *
 * The web app has to work in both worlds: run from `npm run app` there is a local process
 * keeping plans in files, and served as a static site there is not. So every call goes
 * through here, and `probe()` decides which world we are in exactly once. Nothing else in
 * the app needs to know.
 */

export interface PlanSummary {
  slug: string;
  name: string;
  savedAt: string;
  revisions: number;
}

export interface RevisionSummary {
  id: string;
  savedAt: string;
}

export interface PlanRecord {
  slug?: string;
  name: string;
  savedAt: string;
  inputs: Record<string, unknown>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Is there a local process to save to? Answered once, and never guessed at. */
export async function probe(): Promise<{ dataDir: string } | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; dataDir?: string };
    return body.ok ? { dataDir: body.dataDir ?? '' } : null;
  } catch {
    // A static host answers this with the app's own 404 page, not JSON. Either way:
    // there is nowhere to save, and the app carries on as it always has.
    return null;
  }
}

export const listPlans = () => api<PlanSummary[]>('/plans');
export const readPlan = (slug: string) => api<PlanRecord>(`/plans/${encodeURIComponent(slug)}`);
export const listRevisions = (slug: string) =>
  api<RevisionSummary[]>(`/plans/${encodeURIComponent(slug)}/revisions`);
export const readRevision = (slug: string, id: string) =>
  api<PlanRecord>(`/plans/${encodeURIComponent(slug)}/revisions/${encodeURIComponent(id)}`);
export const deletePlan = (slug: string) =>
  api<{ ok: true }>(`/plans/${encodeURIComponent(slug)}`, { method: 'DELETE' });

export const savePlan = (slug: string, name: string, inputs: FormInputs) =>
  api<PlanRecord>(`/plans/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body: JSON.stringify({ name, inputs }),
  });

/**
 * The same rule the server uses, so the name you type and the folder it lands in agree
 * before anything is sent. Duplicated on purpose - the server validates regardless, and
 * a client that guessed differently would be a confusing way to find that out.
 */
export function toSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'plan';
}

/** "3 days ago", for a list of saves where the exact second is never the point. */
export function whenever(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
