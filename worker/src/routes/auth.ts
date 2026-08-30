import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { hashPassword, verifyPassword } from '../lib/password';
import { signSession } from '../lib/jwt';
import { checkLoginRate, recordLoginFailure } from '../lib/ratelimit';
import { writeAudit } from '../lib/audit';
import { requireAuth } from '../lib/middleware';
import { resolveDisplayName } from '../lib/displayName';

const MIN_PASSWORD = 10;

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>();

auth.post('/login', async (c) => {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return c.json({ error: 'invalid body' }, 400);
  }

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const rate = await checkLoginRate(c.env.DB, ip);
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds));
    return c.json({ error: 'too many attempts', retryAfterSeconds: rate.retryAfterSeconds }, 429);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, username, password_hash, salt, iterations, role, token_version, display_name
     FROM users WHERE username = ?`,
  )
    .bind(username)
    .first<{
      id: number; username: string; password_hash: string; salt: string;
      iterations: number; role: 'owner' | 'editor'; token_version: number;
      display_name: string | null;
    }>();

  // Hash even when the user is unknown so the timing profile does not leak existence.
  const ok = row
    ? await verifyPassword(password, row.password_hash, row.salt, row.iterations)
    : (await hashPassword(password), false);

  if (!row || !ok) {
    await recordLoginFailure(c.env.DB, ip);
    return c.json({ error: 'invalid credentials' }, 401);
  }

  const token = await signSession(c.env.JWT_SECRET, {
    id: row.id, username: row.username, role: row.role, tv: row.token_version,
  });
  await c.env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(row.id).run();
  await writeAudit(
    c.env.DB,
    { id: row.id, username: row.username, role: row.role, displayName: resolveDisplayName(row.display_name, row.username) },
    'auth.login',
  );

  return c.json({
    token,
    user: {
      id: row.id,
      username: row.username,
      role: row.role,
      displayName: resolveDisplayName(row.display_name, row.username),
    },
    expiresAt: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  });
});

auth.get('/me', requireAuth, (c) => c.json(c.var.user));

auth.post('/logout', requireAuth, async (c) => {
  await c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
    .bind(c.var.user.id).run();
  await writeAudit(c.env.DB, c.var.user, 'auth.logout');
  return c.json({ ok: true });
});

auth.post('/password', requireAuth, async (c) => {
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (newPassword.length < MIN_PASSWORD) {
    return c.json({ error: `password must be at least ${MIN_PASSWORD} characters` }, 400);
  }

  const row = await c.env.DB.prepare(
    'SELECT password_hash, salt, iterations FROM users WHERE id = ?',
  )
    .bind(c.var.user.id)
    .first<{ password_hash: string; salt: string; iterations: number }>();
  if (!row) return c.json({ error: 'unauthorized' }, 401);

  if (!(await verifyPassword(currentPassword, row.password_hash, row.salt, row.iterations))) {
    return c.json({ error: 'current password incorrect' }, 403);
  }

  const next = await hashPassword(newPassword);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, salt = ?, iterations = ?,
     token_version = token_version + 1 WHERE id = ?`,
  )
    .bind(next.hash, next.salt, next.iterations, c.var.user.id)
    .run();
  await writeAudit(c.env.DB, c.var.user, 'auth.password_change');
  return c.json({ ok: true });
});
