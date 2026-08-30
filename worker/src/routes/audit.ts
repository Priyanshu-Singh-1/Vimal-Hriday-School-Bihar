import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { requireAuth, requireOwner } from '../lib/middleware';
import { pageLabel } from './pages';

export const audit = new Hono<{ Bindings: Env; Variables: Vars }>();

audit.use('*', requireAuth, requireOwner);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type AuditRow = {
  id: number;
  created_at: string;
  actor_name: string;
  action: string;
  target: string | null;
  detail: string | null;
  page_path: string | null;
};

/** Parse the stored detail JSON, never throwing on malformed input. */
function parseDetail(detail: string | null): unknown {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

audit.get('/', async (c) => {
  const limitParam = Number(c.req.query('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.trunc(limitParam), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const beforeParam = Number(c.req.query('before'));
  const before = Number.isFinite(beforeParam) ? beforeParam : null;

  const where = before !== null ? 'WHERE audit_log.id < ?' : '';
  const binds = before !== null ? [before, limit + 1] : [limit + 1];

  const { results } = await c.env.DB.prepare(
    `SELECT audit_log.id, audit_log.created_at, audit_log.actor_name, audit_log.action,
            audit_log.target, audit_log.detail, slots.page_path
     FROM audit_log
     LEFT JOIN slots ON audit_log.target = slots.id
     ${where}
     ORDER BY audit_log.id DESC
     LIMIT ?`,
  )
    .bind(...binds)
    .all<AuditRow>();

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;

  const entries = page.map((row) => ({
    id: row.id,
    at: row.created_at,
    actor: row.actor_name,
    action: row.action,
    target: row.target,
    detail: parseDetail(row.detail),
    pagePath: row.page_path,
    pageLabel: row.page_path ? pageLabel(row.page_path) : null,
  }));

  const lastEntry = entries[entries.length - 1];
  const nextBefore = hasMore && lastEntry ? lastEntry.id : null;

  return c.json({ entries, nextBefore });
});
