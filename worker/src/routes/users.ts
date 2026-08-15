import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { hashPassword } from '../lib/password';
import { writeAudit } from '../lib/audit';
import { requireAuth, requireOwner } from '../lib/middleware';

const MIN_PASSWORD = 10;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/i;

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

users.post('/', async (c) => {
  let body: { username?: unknown; password?: unknown; role?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  const { username, password, role } = body;
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return c.json({ error: 'invalid username' }, 400);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return c.json({ error: `password must be at least ${MIN_PASSWORD} characters` }, 400);
  }
  if (role !== 'owner' && role !== 'editor') {
    return c.json({ error: 'role must be owner or editor' }, 400);
  }

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) return c.json({ error: 'username already exists' }, 409);

  const { hash, salt, iterations } = await hashPassword(password);
  const row = await c.env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, iterations, role)
     VALUES (?,?,?,?,?) RETURNING id, username, role, created_at`,
  ).bind(username, hash, salt, iterations, role).first();

  await writeAudit(c.env.DB, c.var.user, 'user.create', username, { role });
  return c.json(row, 201);
});

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
