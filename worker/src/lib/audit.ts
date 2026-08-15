import type { SessionUser } from '../env';

export async function writeAudit(
  db: D1Database,
  actor: SessionUser | null,
  action: string,
  target?: string,
  detail?: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (actor_id, actor_name, action, target, detail)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      actor?.id ?? null,
      actor?.username ?? 'anonymous',
      action,
      target ?? null,
      detail === undefined ? null : JSON.stringify(detail),
    )
    .run();
}
