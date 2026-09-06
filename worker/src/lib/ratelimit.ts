const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

/**
 * Throttling is keyed per caller, not purely per ip.
 *
 * When the console is served through a host that proxies the api (Vercel
 * rewrites /v1/* to this Worker), every request reaches Cloudflare from the
 * proxy's address, so `CF-Connecting-IP` is the same for all staff. Keyed on ip
 * alone, one person mistyping their password five times would lock out the
 * whole school for fifteen minutes. See `rateKey` in routes/auth.ts.
 */

export type LoginRateCheck = { allowed: boolean; retryAfterSeconds: number };

/**
 * Login-rate check plus how many seconds remain until the oldest attempt in
 * the window ages out, so a 429 can tell the operator when to retry instead
 * of a flat, ever-resetting window length.
 */
export async function checkLoginRate(db: D1Database, key: string): Promise<LoginRateCheck> {
  const { results } = await db
    .prepare(
      `SELECT at FROM login_attempts WHERE ip = ? AND at > datetime('now', ?) ORDER BY at ASC`,
    )
    .bind(key, `-${WINDOW_MINUTES} minutes`)
    .all<{ at: string }>();

  const oldest = results[0];
  if (results.length < MAX_FAILURES || !oldest) return { allowed: true, retryAfterSeconds: 0 };

  const oldestMs = Date.parse(`${oldest.at.replace(' ', 'T')}Z`);
  const retryAfterMs = oldestMs + WINDOW_MINUTES * 60 * 1000 - Date.now();
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

export async function recordLoginFailure(db: D1Database, key: string): Promise<void> {
  await db.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(key).run();
}

export async function sweepLoginAttempts(db: D1Database): Promise<void> {
  await db
    .prepare(`DELETE FROM login_attempts WHERE at <= datetime('now', ?)`)
    .bind(`-${WINDOW_MINUTES} minutes`)
    .run();
}
