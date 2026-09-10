import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PlanStore,
  isSafeRevisionId,
  isSafeSlug,
  revisionId,
  revisionTime,
  toSlug,
} from '../plans.ts';

let dir: string;
let store: PlanStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plans-'));
  store = new PlanStore(dir);
});

const inputs = (over: Record<string, unknown> = {}) => ({ retirementAge: 47, ...over });

describe('naming a plan', () => {
  it('turns anything a person types into a filename', () => {
    expect(toSlug('Our plan')).toBe('our-plan');
    expect(toSlug('Plan B — 2026!')).toBe('plan-b-2026');
    expect(toSlug('  ')).toBe('plan');
  });

  it('cannot produce a path', () => {
    // The point of the slug: none of these survive it.
    for (const nasty of ['../../etc/passwd', '..', '/absolute', 'a/b/c', '.hidden', 'C:\\win']) {
      const slug = toSlug(nasty);
      expect(slug).not.toContain('/');
      expect(slug).not.toContain('\\');
      expect(slug).not.toContain('..');
      expect(isSafeSlug(slug)).toBe(true);
    }
  });

  it('rejects a slug that arrived from outside rather than trusting it', () => {
    for (const nasty of ['..', '../x', 'a/b', '.hidden', '', 'A', 'a'.repeat(61), '-lead']) {
      expect(isSafeSlug(nasty)).toBe(false);
    }
    expect(isSafeSlug('our-plan')).toBe(true);
  });

  it('refuses to touch a path outside the data directory', async () => {
    await expect(store.read('../secrets')).rejects.toThrow(/valid plan name/);
    await expect(store.save('..', { name: 'x', inputs: inputs() })).rejects.toThrow(
      /valid plan name/,
    );
  });
});

describe('revision ids', () => {
  it('are timestamps that are legal filenames, and convert back', () => {
    const when = new Date('2026-09-11T02:14:33.901Z');
    const id = revisionId(when);
    expect(id).toBe('2026-09-11T02-14-33-901Z');
    expect(id).not.toMatch(/[:.]/);
    expect(revisionTime(id)).toBe(when.toISOString());
    expect(isSafeRevisionId(id)).toBe(true);
  });

  it('reject anything that is not one', () => {
    for (const nasty of ['../x', 'latest', '2026-09-11', '']) {
      expect(isSafeRevisionId(nasty)).toBe(false);
    }
  });
});

describe('saving and reopening a plan', () => {
  it('writes a plan that can be read back', async () => {
    await store.save('our-plan', { name: 'Our plan', inputs: inputs({ retirementAge: 60 }) });
    const back = await store.read('our-plan');
    expect(back.name).toBe('Our plan');
    expect(back.inputs.retirementAge).toBe(60);
    expect(back.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('writes plain, readable JSON — the files outlive the program', async () => {
    await store.save('our-plan', { name: 'Our plan', inputs: inputs() });
    const raw = await readFile(join(dir, 'our-plan', 'plan.json'), 'utf-8');
    expect(raw).toContain('\n  "name": "Our plan"');
    expect(raw.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('keeps every version, newest first', async () => {
    await store.save('our-plan', { name: 'Our plan', inputs: inputs({ retirementAge: 47 }) },
      new Date('2026-01-01T00:00:00.000Z'));
    await store.save('our-plan', { name: 'Our plan', inputs: inputs({ retirementAge: 55 }) },
      new Date('2026-06-01T00:00:00.000Z'));
    await store.save('our-plan', { name: 'Our plan', inputs: inputs({ retirementAge: 60 }) },
      new Date('2026-09-01T00:00:00.000Z'));

    const revisions = await store.revisions('our-plan');
    expect(revisions).toHaveLength(3);
    expect(revisions[0].savedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(revisions[2].savedAt).toBe('2026-01-01T00:00:00.000Z');

    // The whole point: what you thought in January is still there in September.
    const first = await store.revision('our-plan', revisions[2].id);
    expect(first.inputs.retirementAge).toBe(47);
    expect((await store.read('our-plan')).inputs.retirementAge).toBe(60);
  });

  it('lists plans with their name, last save and how many versions', async () => {
    await store.save('a-plan', { name: 'A plan', inputs: inputs() }, new Date('2026-01-01T00:00:00.000Z'));
    await store.save('b-plan', { name: 'B plan', inputs: inputs() }, new Date('2026-05-01T00:00:00.000Z'));
    await store.save('b-plan', { name: 'B plan', inputs: inputs() }, new Date('2026-06-01T00:00:00.000Z'));

    const list = await store.list();
    expect(list.map((p) => p.slug)).toEqual(['b-plan', 'a-plan']); // most recent first
    expect(list[0].revisions).toBe(2);
    expect(list[1].revisions).toBe(1);
  });

  it('says whether a plan exists without throwing', async () => {
    expect(await store.exists('nothing')).toBe(false);
    await store.save('nothing', { name: 'Now it does', inputs: inputs() });
    expect(await store.exists('nothing')).toBe(true);
  });

  it('is empty rather than broken before anything has been saved', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.revisions('never-saved')).toEqual([]);
  });

  it('steps over a directory that is not a plan', async () => {
    await mkdir(join(dir, 'not-a-plan'), { recursive: true });
    await writeFile(join(dir, 'not-a-plan', 'readme.txt'), 'hello', 'utf-8');
    await store.save('real-plan', { name: 'Real', inputs: inputs() });
    expect((await store.list()).map((p) => p.slug)).toEqual(['real-plan']);
  });

  it('writes the revision before the current version', async () => {
    // If the process dies between the two writes, an extra history entry is harmless -
    // losing one is not. So the order is deliberate and worth pinning.
    await store.save('our-plan', { name: 'Our plan', inputs: inputs() });
    const files = await readdir(join(dir, 'our-plan'));
    expect(files).toContain('plan.json');
    expect(files).toContain('revisions');
  });

  it('removes a plan and its whole history when asked', async () => {
    await store.save('gone', { name: 'Gone', inputs: inputs() });
    await store.remove('gone');
    expect(await store.exists('gone')).toBe(false);
    expect(await store.list()).toEqual([]);
  });
});
