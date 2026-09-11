import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlanStore, isSafeSlug, toSlug } from './plans.ts';

/**
 * The laptop app.
 *
 * One process that serves the built web app and gives it somewhere to keep plans. It
 * binds to 127.0.0.1 only: this reads and writes files in a folder on your machine, and
 * nothing on the network has any business reaching it.
 *
 * The web app works perfectly well without this - it falls back to the per-visit
 * behaviour it has always had when /api/health does not answer - so the deployed static
 * site is unaffected by any of it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const webRoot = resolve(repoRoot, 'apps', 'web', 'out');
const dataDir = resolve(process.env.RETIREMENT_PLANS_DIR ?? join(repoRoot, 'plans'));
const port = Number(process.env.PORT ?? 4173);

const store = new PlanStore(dataDir);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
};

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A scenario is a few kilobytes. Anything approaching a megabyte is a mistake or an
    // attempt at one, and there is no reason to hold it in memory to find out which.
    if (size > 1_000_000) throw new Error('That is too large to be a plan.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

/** Static files from the exported site, with the extensionless routes it produces. */
async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const clean = pathname.replace(/\/+$/, '') || '/index';
  const candidates =
    extname(clean) === ''
      ? [`${clean}.html`, join(clean, 'index.html')]
      : [clean];
  for (const candidate of candidates) {
    const file = resolve(webRoot, `.${candidate}`);
    // Never serve anything outside the built site, whatever the URL claims.
    if (file !== webRoot && !file.startsWith(webRoot + '/')) continue;
    try {
      return { body: await readFile(file), type: MIME[extname(file)] ?? 'application/octet-stream' };
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const path = url.pathname;

  try {
    if (path === '/api/health') {
      return json(res, 200, { ok: true, dataDir });
    }

    if (path === '/api/plans' && req.method === 'GET') {
      return json(res, 200, await store.list());
    }

    // /api/plans/:slug and /api/plans/:slug/revisions[/:id]
    const parts = path.split('/').filter(Boolean); // api, plans, slug, ...
    if (parts[0] === 'api' && parts[1] === 'plans' && parts[2]) {
      const slug = decodeURIComponent(parts[2]);
      if (!isSafeSlug(slug)) return json(res, 400, { error: 'Not a valid plan name.' });

      if (parts[3] === 'revisions' && parts[4] && req.method === 'GET') {
        return json(res, 200, await store.revision(slug, decodeURIComponent(parts[4])));
      }
      if (parts[3] === 'revisions' && !parts[4] && req.method === 'GET') {
        return json(res, 200, await store.revisions(slug));
      }
      if (parts.length === 3) {
        if (req.method === 'GET') return json(res, 200, await store.read(slug));
        if (req.method === 'PUT') {
          const body = (await readBody(req)) as { name?: string; inputs?: Record<string, unknown> };
          if (!body || typeof body.inputs !== 'object' || body.inputs === null) {
            return json(res, 400, { error: 'A plan needs its inputs.' });
          }
          const saved = await store.save(slug, {
            name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : slug,
            inputs: body.inputs,
          });
          return json(res, 200, { slug, ...saved });
        }
        if (req.method === 'DELETE') {
          await store.remove(slug);
          return json(res, 200, { ok: true });
        }
      }
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: 'No such endpoint.' });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: 'Method not allowed.' });
    }

    const file = await serveStatic(path);
    if (file) {
      res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : file.body);
    }

    const notFound = await serveStatic('/404');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(notFound?.body ?? 'Not found');
  } catch (err) {
    const message = (err as Error).message;
    // A missing plan is a 404, not a crash; everything else is genuinely ours.
    const missing = /ENOENT/.test(message);
    return json(res, missing ? 404 : 500, { error: missing ? 'No such plan.' : message });
  }
});

/**
 * The one failure an ordinary run actually hits: the app is already open in another
 * terminal. A stack trace is a poor way to say so, and the useful answer differs
 * depending on whether the thing holding the port is this app or something else - so ask
 * it, and say which.
 */
server.on('error', async (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') {
    console.error(`\n  Could not start: ${err.message}\n`);
    process.exit(1);
  }
  let ours = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    ours = res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    /* whatever is there, it is not answering as us */
  }
  console.error(
    ours
      ? `\n  Already running.\n\n  Open        http://127.0.0.1:${port}\n  Stop it     kill $(lsof -nP -iTCP:${port} -sTCP:LISTEN -t)\n`
      : `\n  Port ${port} is in use by something else.\n\n  See what    lsof -nP -iTCP:${port} -sTCP:LISTEN\n  Or move     PORT=${port + 1} npm run app\n`,
  );
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`
  Retirement model

  Open        http://127.0.0.1:${port}
  Plans kept  ${dataDir}

  Every save keeps a dated copy, so a plan can be revisited and revised for years.
  Stop with Ctrl+C.
`);
});

export { toSlug };
