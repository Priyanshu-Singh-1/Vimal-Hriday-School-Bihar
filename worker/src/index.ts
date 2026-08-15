import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Vars } from './env';
import { auth } from './routes/auth';
import { users } from './routes/users';
import { uploads } from './routes/uploads';
import { slots } from './routes/slots';
import { pages } from './routes/pages';
import { publish, publishPending, sweepUnboundAssets } from './routes/publish';
import { sweepLoginAttempts } from './lib/ratelimit';

// strict: false so `/v1/users` and `/v1/users/` both match. Hono is strict by
// default; the top-level app's extractor governs matching for mounted routers too.
const app = new Hono<{ Bindings: Env; Variables: Vars }>({ strict: false });

app.use('/v1/*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const isAllowed = (origin: string) =>
    allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return cors({
    origin: (origin) => (origin && isAllowed(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'If-Match'],
    maxAge: 600,
  })(c, next);
});

app.get('/v1/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM sections').first<{ n: number }>();
  return c.json({ ok: true, sections: row?.n ?? 0 });
});

app.route('/v1/auth', auth);
app.route('/v1/users', users);
app.route('/v1/uploads', uploads);
app.route('/v1/slots', slots);
app.route('/v1/pages', pages);
app.route('/v1/publish', publish);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await sweepLoginAttempts(env.DB);
        await sweepUnboundAssets(env);
        try {
          await publishPending(env, null);
        } catch (err) {
          console.error('scheduled publish failed, will retry next tick', err);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
