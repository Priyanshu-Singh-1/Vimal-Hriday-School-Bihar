const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

export async function checkLoginRate(db: D1Database, ip: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
       WHERE ip = ? AND at > datetime('now', ?)`,
    )
    .bind(ip, `-${WINDOW_MINUTES} minutes`)
    .first<{ n: number }>();
  return (row?.n ?? 0) < MAX_FAILURES;
}

export async function recordLoginFailure(db: D1Database, ip: string): Promise<void> {
  await db.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(ip).run();
}

export async function sweepLoginAttempts(db: D1Database): Promise<void> {
  await db
    .prepare(`DELETE FROM login_attempts WHERE at <= datetime('now', ?)`)
    .bind(`-${WINDOW_MINUTES} minutes`)
    .run();
}
