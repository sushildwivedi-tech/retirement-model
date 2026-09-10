import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/**
 * Saved plans on disk.
 *
 * One directory per plan, holding the current version and every version it has had:
 *
 *   <dataDir>/<slug>/plan.json
 *   <dataDir>/<slug>/revisions/2026-09-11T02-14-33-901Z.json
 *
 * Plain JSON, one file per save, deliberately. A retirement plan is revisited over years,
 * and the thing most likely to outlive this program is the files - so they are readable
 * in any text editor, diffable, copyable to another machine, and safe to put in git. No
 * database, no schema migration, nothing to be locked out of.
 */

export interface PlanRecord {
  /** What the plan is called, as typed. */
  name: string;
  /** ISO timestamp of this save. */
  savedAt: string;
  /** The form values. Kept opaque here: the store's job is to keep them, not read them. */
  inputs: Record<string, unknown>;
}

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

/**
 * A file-system-safe name for a plan.
 *
 * Everything outside a-z, 0-9 and a dash is replaced, so a name can be anything a person
 * wants to type without any of it reaching a path. `..`, slashes, leading dots and
 * Windows device names cannot survive this.
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

/** A slug that arrived from outside, checked rather than trusted. */
export function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(slug);
}

/** Revision ids are timestamps, and are checked the same way before touching a path. */
export function isSafeRevisionId(id: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z$/.test(id);
}

/** `2026-09-11T02:14:33.901Z` -> `2026-09-11T02-14-33-901Z`, which is a legal filename. */
export function revisionId(when: Date): string {
  return when.toISOString().replace(/[:.]/g, '-');
}

/** And back again, so a revision can say when it was taken. */
export function revisionTime(id: string): string {
  const [date, rest] = id.split('T');
  const [h, m, s, ms] = rest.replace(/Z$/, '').split('-');
  return `${date}T${h}:${m}:${s}.${ms}Z`;
}

export class PlanStore {
  // A plain field, not a constructor parameter property: Node runs this file by stripping
  // types, and stripping cannot invent the assignment a parameter property implies.
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * The directory a plan lives in.
   *
   * Belt and braces: the slug is validated, and then the resolved path is checked to be
   * inside the data directory. Either check alone would do; both together mean a bug in
   * one cannot turn a request into a write somewhere else on the disk.
   */
  private dirFor(slug: string): string {
    if (!isSafeSlug(slug)) throw new Error(`Not a valid plan name: ${slug}`);
    const dir = resolve(this.dataDir, slug);
    const root = resolve(this.dataDir);
    if (dir !== root && !dir.startsWith(root + sep)) {
      throw new Error(`Refusing to write outside ${root}`);
    }
    return dir;
  }

  async list(): Promise<PlanSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dataDir);
    } catch {
      return [];
    }
    const out: PlanSummary[] = [];
    for (const slug of entries) {
      if (!isSafeSlug(slug)) continue;
      try {
        const record = await this.read(slug);
        out.push({
          slug,
          name: record.name,
          savedAt: record.savedAt,
          revisions: (await this.revisions(slug)).length,
        });
      } catch {
        // A directory that is not a plan, or a half-written one. Skipping it is better
        // than failing the whole list.
      }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async read(slug: string): Promise<PlanRecord> {
    const raw = await readFile(join(this.dirFor(slug), 'plan.json'), 'utf-8');
    return JSON.parse(raw) as PlanRecord;
  }

  async exists(slug: string): Promise<boolean> {
    try {
      await stat(join(this.dirFor(slug), 'plan.json'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write the plan, and keep the version it had.
   *
   * The revision is written first. If the process dies between the two writes the history
   * has an extra entry, which is harmless; the other order would lose one.
   */
  async save(
    slug: string,
    record: Omit<PlanRecord, 'savedAt'>,
    when: Date = new Date(),
  ): Promise<PlanRecord> {
    const dir = this.dirFor(slug);
    await mkdir(join(dir, 'revisions'), { recursive: true });
    const saved: PlanRecord = { ...record, savedAt: when.toISOString() };
    const body = JSON.stringify(saved, null, 2) + '\n';
    await writeFile(join(dir, 'revisions', `${revisionId(when)}.json`), body, 'utf-8');
    await writeFile(join(dir, 'plan.json'), body, 'utf-8');
    return saved;
  }

  async revisions(slug: string): Promise<RevisionSummary[]> {
    let files: string[];
    try {
      files = await readdir(join(this.dirFor(slug), 'revisions'));
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter(isSafeRevisionId)
      .sort((a, b) => b.localeCompare(a))
      .map((id) => ({ id, savedAt: revisionTime(id) }));
  }

  async revision(slug: string, id: string): Promise<PlanRecord> {
    if (!isSafeRevisionId(id)) throw new Error(`Not a valid revision: ${id}`);
    const raw = await readFile(join(this.dirFor(slug), 'revisions', `${id}.json`), 'utf-8');
    return JSON.parse(raw) as PlanRecord;
  }

  /** Removes the plan and its whole history. The caller is expected to have asked first. */
  async remove(slug: string): Promise<void> {
    await rm(this.dirFor(slug), { recursive: true, force: true });
  }
}
