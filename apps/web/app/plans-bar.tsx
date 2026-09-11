'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Ruleset } from '@retirement/engine';
import { mergeInputs, type FormInputs } from './inputs';
import {
  deletePlan,
  listPlans,
  listRevisions,
  probe,
  readPlan,
  readRevision,
  savePlan,
  toSlug,
  whenever,
  type PlanSummary,
  type RevisionSummary,
} from './plans';

/**
 * Saved plans, when the app is running on your laptop.
 *
 * Renders nothing at all when there is no local process behind it, so the deployed static
 * site is exactly as it was. Everything here is about one idea: a plan is a document you
 * come back to, and every version of it is kept.
 */
export function PlansBar({
  form,
  setForm,
  onLoad,
  ruleset,
}: {
  form: FormInputs;
  setForm: (f: FormInputs) => void;
  /** Called after a plan or a revision replaces the form, so results can be cleared. */
  onLoad: () => void;
  ruleset: Ruleset;
}) {
  const [available, setAvailable] = useState<{ dataDir: string } | null>(null);
  const [open, setOpen] = useState<null | 'plans' | 'history'>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [current, setCurrent] = useState<{ slug: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set while an older version is on screen. Without it the bar says "Saved" - true of
  // the form, but not of the file, which still holds the newer version. Saying which of
  // the two you are looking at is the whole job of this bar.
  const [viewing, setViewing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * What the form looked like when it was last saved or loaded, so "unsaved" is a fact
   * rather than a flag someone has to remember to set.
   *
   * State, not a ref. A ref read during render is invisible to React - nothing re-renders
   * when it changes, so the dot would only appear when something else happened to force a
   * render, and would be wrong until then.
   */
  const [clean, setClean] = useState<string | null>(null);
  const dirty = current !== null && clean !== null && clean !== JSON.stringify(form);

  useEffect(() => {
    probe().then(setAvailable);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setPlans(await listPlans());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (available) void refresh();
  }, [available, refresh]);

  if (!available) return null;

  const load = (
    record: { name: string; inputs: Record<string, unknown>; savedAt?: string },
    slug: string,
    fromRevision = false,
  ) => {
    // Through mergeInputs, so a plan saved by an older version of the app opens rather
    // than breaking: unknown keys are dropped and missing ones take today's defaults.
    const merged = mergeInputs(record.inputs as Partial<FormInputs>, ruleset);
    setForm(merged);
    setClean(JSON.stringify(merged));
    setCurrent({ slug, name: record.name });
    setViewing(fromRevision ? (record.savedAt ?? null) : null);
    setOpen(null);
    setError(null);
    onLoad();
  };

  const save = async (name: string, slug: string) => {
    setSaving(true);
    setError(null);
    try {
      await savePlan(slug, name, form);
      setClean(JSON.stringify(form));
      setCurrent({ slug, name });
      setViewing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveAs = async () => {
    const name = window.prompt('Name this plan', current ? `${current.name} copy` : 'Our plan');
    if (!name?.trim()) return;
    await save(name.trim(), toSlug(name));
    setOpen(null);
  };

  const openHistory = async () => {
    if (!current) return;
    try {
      setRevisions(await listRevisions(current.slug));
      setOpen('history');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="plans-bar">
      <span className="plans-name" title={current ? `Saved in ${available.dataDir}` : undefined}>
        {current ? current.name : 'Unsaved plan'}
        {dirty && <span className="plans-dot" title="Changed since the last save" />}
      </span>

      {viewing && (
        <span className="chip chip-assume" title="The saved plan still holds the newer version">
          version of{' '}
          {new Date(viewing).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
      )}

      <button
        className="btn btn-sm"
        disabled={saving}
        onClick={() => (current ? save(current.name, current.slug) : saveAs())}
      >
        {saving
          ? 'Saving…'
          : viewing
            ? 'Make current'
            : current
              ? dirty
                ? 'Save'
                : 'Saved'
              : 'Save…'}
      </button>

      <button
        className="btn btn-sm"
        onClick={() => {
          setOpen(open === 'plans' ? null : 'plans');
          void refresh();
        }}
      >
        Plans
      </button>

      {current && (
        <button className="btn btn-sm" onClick={openHistory}>
          History
        </button>
      )}

      {open && (
        <>
          {/* Click anywhere else to dismiss. */}
          <button className="plans-scrim" aria-label="Close" onClick={() => setOpen(null)} />
          <div className="plans-panel">
            {open === 'plans' ? (
              <>
                <div className="plans-panel-head">
                  <span className="legend">Saved plans</span>
                  <button className="btn btn-sm" onClick={saveAs}>
                    Save current as…
                  </button>
                </div>
                {plans.length === 0 ? (
                  <p className="help mb-0">
                    Nothing saved yet. “Save current as…” keeps this plan in{' '}
                    <span className="figure">{available.dataDir}</span>.
                  </p>
                ) : (
                  <ul className="plans-list">
                    {plans.map((p) => (
                      <li key={p.slug}>
                        <button
                          className="plans-row"
                          onClick={async () => {
                            try {
                              load(await readPlan(p.slug), p.slug);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <span className="plans-row-name">{p.name}</span>
                          <span className="plans-row-meta">
                            {whenever(p.savedAt)} · {p.revisions}{' '}
                            {p.revisions === 1 ? 'version' : 'versions'}
                          </span>
                        </button>
                        <button
                          className="plans-remove"
                          title={`Delete ${p.name} and its history`}
                          onClick={async () => {
                            if (!window.confirm(`Delete “${p.name}” and every saved version?`)) return;
                            await deletePlan(p.slug);
                            if (current?.slug === p.slug) setCurrent(null);
                            await refresh();
                          }}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="help mb-0 mt-3">
                  Files in <span className="figure">{available.dataDir}</span> — plain JSON, yours
                  to copy, back up or keep in git.
                </p>
              </>
            ) : (
              <>
                <div className="plans-panel-head">
                  <span className="legend">History of {current?.name}</span>
                </div>
                <ul className="plans-list">
                  {revisions.map((rev, i) => (
                    <li key={rev.id}>
                      <button
                        className="plans-row"
                        onClick={async () => {
                          if (!current) return;
                          try {
                            load(await readRevision(current.slug, rev.id), current.slug, true);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        <span className="plans-row-name">
                          {new Date(rev.savedAt).toLocaleString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="plans-row-meta">
                          {i === 0 ? 'latest' : whenever(rev.savedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="help mb-0 mt-3">
                  Opening a version loads it into the form and nothing else — the saved plan
                  still holds the newest one until you press <b>Make current</b>, which keeps
                  the newer version in the history rather than discarding it.
                </p>
              </>
            )}
            {error && <p className="mt-2 text-xs text-bad">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
