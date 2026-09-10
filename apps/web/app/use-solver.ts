'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoalSeekResult, MonteCarloResult } from '@retirement/engine';
import type { WorkerJob, WorkerReply } from './mc.worker';

type Pending = { id: number; label: string };

/**
 * Omit that distributes over a union. Plain `Omit<WorkerJob, 'id'>` collapses the union
 * to the keys its members share, which loses every field that makes a job a job.
 */
type JobWithoutId = WorkerJob extends infer T ? (T extends WorkerJob ? Omit<T, 'id'> : never) : never;

/**
 * One worker for the page, and a promise-shaped way to ask it things.
 *
 * Every job carries an id and only the newest id's reply is kept, so a run superseded by
 * a keystroke is discarded rather than landing later and overwriting a fresher answer.
 * That is the whole cancellation story: the worker cannot be interrupted mid-run, but its
 * stale output can be ignored, which from the page's point of view is the same thing.
 */
export function useSolver() {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(1);
  const waiting = useRef(new Map<number, (r: WorkerReply) => void>());
  const [busy, setBusy] = useState<Pending | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./mc.worker.ts', import.meta.url));
    workerRef.current = worker;
    // A worker that fails to start fails silently otherwise, and the page just never
    // gets its answer.
    worker.onerror = (e) => {
      console.error('[solver] worker failed', e.message, e.filename, e.lineno);
    };
    worker.onmessageerror = () => console.error('[solver] could not clone the job');
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const resolve = waiting.current.get(e.data.id);
      waiting.current.delete(e.data.id);
      resolve?.(e.data);
    };
    const pending = waiting.current;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pending.clear();
    };
  }, []);

  const send = useCallback((job: JobWithoutId, label: string): Promise<WorkerReply> => {
    const worker = workerRef.current;
    const id = nextId.current++;
    if (!worker) return Promise.resolve({ id, kind: 'error', message: 'worker not ready' });
    setBusy({ id, label });
    return new Promise<WorkerReply>((resolve) => {
      waiting.current.set(id, (reply) => {
        setBusy((b) => (b?.id === id ? null : b));
        resolve(reply);
      });
      worker.postMessage({ ...job, id } as WorkerJob);
    });
  }, []);

  return { send, busy };
}

/**
 * The headline age, re-solved in the background after every edit.
 *
 * Debounced, because a keystroke a character is not a question worth asking. It is NOT
 * skipped when `document.hidden` is set: this project has already been caught by that
 * once, with a requestAnimationFrame that never fired because the page reported itself
 * hidden while plainly on screen. Hidden is not the same as unwatched, and a tab nobody
 * is looking at is not being edited either, so there is nothing to save by skipping.
 *
 * The run count is deliberately lower than the button's: this has to feel instant, and
 * the button is still there for the verified number.
 */
export function useBackgroundAge(
  key: string,
  solve: () => Promise<GoalSeekResult<number> | null>,
  enabled: boolean,
): GoalSeekResult<number> | null {
  // The key is stored WITH the answer rather than the answer being cleared when the key
  // changes. Same effect on screen - an answer for a scenario you have since edited is
  // not shown - without a setState in the effect body, and with no window in which the
  // old figure is displayed against the new inputs.
  const [answer, setAnswer] = useState<{ key: string; result: GoalSeekResult<number> | null }>({
    key: '',
    result: null,
  });
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const token = ++latest.current;
    const timer = setTimeout(async () => {
      const result = await solve();
      // A newer edit has already asked its own question; this answer is stale.
      if (token === latest.current) setAnswer({ key, result });
    }, 600);
    return () => clearTimeout(timer);
    // `solve` closes over the scenario, which `key` already encodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return answer.key === key ? answer.result : null;
}

export type { MonteCarloResult };
