import type { MiddlewareHandler } from 'hono';
import type { Env, SessionUser, Vars } from '../env';
import { verifySession } from './jwt';
import { resolveDisplayName } from './displayName';

type Ctx = { Bindings: Env; Variables: Vars };

export const requireAuth: MiddlewareHandler<Ctx> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const claims = await verifySession(c.env.JWT_SECRET, token);
  if (!claims) return c.json({ error: 'unauthorized' }, 401);

  const row = await c.env.DB.prepare(
    'SELECT id, username, role, token_version, display_name FROM users WHERE id = ?',
  )
    .bind(claims.sub)
    .first<{
      id: number; username: string; role: 'owner' | 'editor'; token_version: number;
      display_name: string | null;
    }>();

  if (!row || row.token_version !== claims.tv) return c.json({ error: 'unauthorized' }, 401);

  const user: SessionUser = {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: resolveDisplayName(row.display_name, row.username),
  };
  c.set('user', user);
  await next();
};

export const requireOwner: MiddlewareHandler<Ctx> = async (c, next) => {
  if (c.var.user.role !== 'owner') return c.json({ error: 'forbidden' }, 403);
  await next();
};
