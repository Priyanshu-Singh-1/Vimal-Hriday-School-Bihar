import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { hashPassword } from '../lib/password';
import { writeAudit } from '../lib/audit';
import { requireAuth, requireOwner } from '../lib/middleware';

const MIN_PASSWORD = 10;

export const users = new Hono<{ Bindings: Env; Variables: Vars }>();

users.use('*', requireAuth, requireOwner);

async function ownerCount(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='owner'`).first<{ n: number }>();
  return row?.n ?? 0;
}

users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, role, created_at, last_login_at FROM users ORDER BY id`,
  ).all();
  return c.json(results);
});

// Account creation is intentionally backend-only in Phase 1 (deliberate security
// decision by the product owner): there is no POST / here. New accounts are
// provisioned from the backend via `tools/bin/create-user.mjs`.

users.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  let body: { role?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (body.role !== 'owner' && body.role !== 'editor') {
    return c.json({ error: 'role must be owner or editor' }, 400);
  }

  const target = await c.env.DB.prepare('SELECT id, username, role FROM users WHERE id = ?')
    .bind(id).first<{ id: number; username: string; role: string }>();
  if (!target) return c.json({ error: 'not found' }, 404);

  if (target.role === 'owner' && body.role === 'editor' && (await ownerCount(c.env.DB)) <= 1) {
    return c.json({ error: 'cannot demote the last owner' }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(body.role, id).run();
  await writeAudit(c.env.DB, c.var.user, 'user.role_change', target.username, {
    from: target.role, to: body.role,
  });
  return c.json({ ok: true });
});

users.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (id === c.var.user.id) return c.json({ error: 'cannot delete yourself' }, 400);

  const target = await c.env.DB.prepare('SELECT id, username, role FROM users WHERE id = ?')
    .bind(id).first<{ id: number; username: string; role: string }>();
  if (!target) return c.json({ error: 'not found' }, 404);

  if (target.role === 'owner' && (await ownerCount(c.env.DB)) <= 1) {
    return c.json({ error: 'cannot delete the last owner' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await writeAudit(c.env.DB, c.var.user, 'user.delete', target.username);
  return c.json({ ok: true });
});

users.post('/:id/password', async (c) => {
  const id = Number(c.req.param('id'));
  let body: { newPassword?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (typeof body.newPassword !== 'string' || body.newPassword.length < MIN_PASSWORD) {
    return c.json({ error: `password must be at least ${MIN_PASSWORD} characters` }, 400);
  }

  const target = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
    .bind(id).first<{ id: number; username: string }>();
  if (!target) return c.json({ error: 'not found' }, 404);

  const next = await hashPassword(body.newPassword);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, salt = ?, iterations = ?,
     token_version = token_version + 1 WHERE id = ?`,
  ).bind(next.hash, next.salt, next.iterations, id).run();

  await writeAudit(c.env.DB, c.var.user, 'user.password_reset', target.username);
  return c.json({ ok: true });
});
