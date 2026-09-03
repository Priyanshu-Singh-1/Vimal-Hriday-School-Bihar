import { Hono } from 'hono';
import type { Env, SessionUser, Vars } from '../env';
import { requireAuth } from '../lib/middleware';
import { writeAudit } from '../lib/audit';
import { renderPage } from '../render/page';
import { createGitHubClient, type FileChange } from '../github/client';

const UNBOUND_TTL = '-1 day';

export const publish = new Hono<{ Bindings: Env; Variables: Vars }>();

publish.use('*', requireAuth);

/**
 * Render every dirty page and commit the ones that actually changed, in a
 * single commit. D1 is authoritative, so a failure leaves the page dirty for
 * the next attempt rather than losing the edit.
 */
export async function publishPending(
  env: Env,
  actor: SessionUser | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ commit: string | null; pages: string[]; failed: string[] }> {
  const { results } = await env.DB.prepare(
    'SELECT page_path FROM pending_publish ORDER BY page_path',
  ).all<{ page_path: string }>();
  if (!results.length) return { commit: null, pages: [], failed: [] };

  const gh = createGitHubClient(env, fetchImpl);
  const dirty = results.map((r) => r.page_path);
  const changes: FileChange[] = [];
  const clean: string[] = [];
  const failed: string[] = [];

  // Creating or deleting an event page is the only case where a dirty page is
  // not simply "read it, render it, commit it".
  const { results: opRows } = await env.DB.prepare(
    'SELECT page_path, op, html FROM pending_page_ops',
  ).all<{ page_path: string; op: 'create' | 'delete'; html: string | null }>();
  const ops = new Map(opRows.map((r) => [r.page_path, r]));

  for (const path of dirty) {
    try {
      const op = ops.get(path);

      if (op?.op === 'delete') {
        // A null content becomes a null-sha tree entry, which removes the file.
        changes.push({ path, content: null });
        continue;
      }

      // A page being created has no committed version to read.
      const current = op?.op === 'create' && op.html !== null ? op.html : await gh.readFile(path);
      const rendered = await renderPage(env.DB, path, current, env.R2_PUBLIC_BASE);
      if (rendered === current && op?.op !== 'create') clean.push(path);
      else changes.push({ path, content: rendered });
    } catch (err) {
      failed.push(path);
      await recordFailure(env, path, err);
    }
  }

  // Pages already matching need no commit; stop tracking them.
  for (const path of clean) {
    await env.DB.prepare('DELETE FROM pending_publish WHERE page_path = ?').bind(path).run();
    await env.DB.prepare('DELETE FROM pending_page_ops WHERE page_path = ?').bind(path).run();
  }

  if (!changes.length) return { commit: null, pages: [], failed };

  const message =
    `chore(content): publish ${changes.length} page${changes.length === 1 ? '' : 's'}\n\n` +
    changes.map((c) => `- ${c.path}`).join('\n') +
    `\n\nBy: ${actor?.username ?? 'scheduled'}`;

  let commit: string | null;
  try {
    commit = await gh.commitFiles(changes, message);
  } catch (err) {
    for (const c of changes) await recordFailure(env, c.path, err);
    throw err;
  }

  for (const c of changes) {
    await env.DB.prepare('DELETE FROM pending_publish WHERE page_path = ?').bind(c.path).run();
    await env.DB.prepare('DELETE FROM pending_page_ops WHERE page_path = ?').bind(c.path).run();
  }
  await writeAudit(env.DB, actor, 'publish', commit ?? undefined, {
    pages: changes.map((c) => c.path),
  });

  return { commit, pages: changes.map((c) => c.path), failed };
}

async function recordFailure(env: Env, path: string, err: unknown): Promise<void> {
  await env.DB.prepare(
    `UPDATE pending_publish SET attempts = attempts + 1, last_error = ? WHERE page_path = ?`,
  )
    .bind(String(err instanceof Error ? err.message : err).slice(0, 500), path)
    .run();
}

/** Uploads never bound to a slot are removed after a day, in R2 and in D1. */
export async function sweepUnboundAssets(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT r2_key, thumb_key FROM assets
     WHERE bound = 0 AND created_at <= datetime('now', ?)`,
  )
    .bind(UNBOUND_TTL)
    .all<{ r2_key: string; thumb_key: string | null }>();

  for (const row of results) {
    await env.BUCKET.delete(row.r2_key);
    if (row.thumb_key) await env.BUCKET.delete(row.thumb_key);
    await env.DB.prepare('DELETE FROM assets WHERE r2_key = ?').bind(row.r2_key).run();
  }
  return results.length;
}

publish.get('/pending', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT page_path, marked_at, attempts, last_error FROM pending_publish ORDER BY page_path',
  ).all<{ page_path: string; marked_at: string; attempts: number; last_error: string | null }>();
  return c.json({
    count: results.length,
    pages: results.map((r) => ({
      pagePath: r.page_path,
      markedAt: r.marked_at,
      attempts: r.attempts,
      lastError: r.last_error,
    })),
  });
});

publish.post('/', async (c) => {
  try {
    return c.json(await publishPending(c.env, c.var.user));
  } catch (err) {
    return c.json(
      { error: 'publish failed, pages remain pending and will be retried', detail: String(err) },
      502,
    );
  }
});
