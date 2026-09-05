import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { requireAuth } from '../lib/middleware';
import { writeAudit } from '../lib/audit';
import type { SlotRow } from '../render/slot';
import { slotAbsoluteSrc } from '../lib/urls';

export const slots = new Hono<{ Bindings: Env; Variables: Vars }>();

slots.use('*', requireAuth);

/** Record that a page's committed HTML no longer matches the database. */
export async function markDirty(db: D1Database, pagePath: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pending_publish (page_path) VALUES (?)
       ON CONFLICT(page_path) DO UPDATE SET marked_at = datetime('now')`,
    )
    .bind(pagePath)
    .run();
}

const SELECT = `SELECT id, page_path, label, optional, r2_key, original_src, alt, updated_at
                FROM slots`;

type SlotWithMeta = SlotRow & { updated_at: string };

function shape(row: SlotWithMeta, r2Base: string, siteBase: string) {
  return {
    id: row.id,
    pagePath: row.page_path,
    label: row.label,
    optional: row.optional,
    alt: row.alt,
    r2Key: row.r2_key,
    src: slotAbsoluteSrc(row, r2Base, siteBase),
    updatedAt: row.updated_at,
  };
}

slots.get('/', async (c) => {
  const page = c.req.query('page');
  if (!page) return c.json({ error: 'page query parameter is required' }, 400);
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE page_path = ? ORDER BY id`)
    .bind(page)
    .all<SlotWithMeta>();
  return c.json(results.map((r) => shape(r, c.env.R2_PUBLIC_BASE, c.env.SITE_BASE)));
});

async function load(db: D1Database, id: string): Promise<SlotWithMeta | null> {
  return db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<SlotWithMeta>();
}

slots.put('/:id', async (c) => {
  const id = c.req.param('id');
  let body: { r2Key?: unknown; alt?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  const { r2Key, alt } = body;
  if (typeof r2Key !== 'string' || !r2Key) return c.json({ error: 'r2Key is required' }, 400);
  if (alt !== undefined && typeof alt !== 'string') return c.json({ error: 'alt must be a string' }, 400);

  const slot = await load(c.env.DB, id);
  if (!slot) return c.json({ error: 'unknown slot' }, 404);

  const ifMatch = c.req.header('If-Match');
  if (ifMatch && ifMatch !== slot.updated_at) {
    return c.json(
      { error: 'slot changed since it was loaded', current: shape(slot, c.env.R2_PUBLIC_BASE, c.env.SITE_BASE) },
      409,
    );
  }

  const asset = await c.env.DB.prepare('SELECT r2_key FROM assets WHERE r2_key = ?').bind(r2Key).first();
  if (!asset) return c.json({ error: 'unknown r2Key — upload the image first' }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE slots SET r2_key = ?, alt = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
    ).bind(r2Key, typeof alt === 'string' ? alt : slot.alt, c.var.user.id, id),
    c.env.DB.prepare('UPDATE assets SET bound = 1 WHERE r2_key = ?').bind(r2Key),
  ]);
  await markDirty(c.env.DB, slot.page_path);
  await writeAudit(c.env.DB, c.var.user, 'slot.update', id, { r2Key, from: slot.r2_key });

  const updated = await load(c.env.DB, id);
  return c.json(shape(updated!, c.env.R2_PUBLIC_BASE, c.env.SITE_BASE));
});

slots.post('/:id/revert', async (c) => {
  const id = c.req.param('id');
  const slot = await load(c.env.DB, id);
  if (!slot) return c.json({ error: 'unknown slot' }, 404);

  await c.env.DB.prepare(
    `UPDATE slots SET r2_key = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
  ).bind(c.var.user.id, id).run();
  await markDirty(c.env.DB, slot.page_path);
  await writeAudit(c.env.DB, c.var.user, 'slot.revert', id, { from: slot.r2_key });

  const updated = await load(c.env.DB, id);
  return c.json(shape(updated!, c.env.R2_PUBLIC_BASE, c.env.SITE_BASE));
});

slots.delete('/:id/image', async (c) => {
  const id = c.req.param('id');
  const slot = await load(c.env.DB, id);
  if (!slot) return c.json({ error: 'unknown slot' }, 404);
  if (!slot.optional) return c.json({ error: 'this slot is required and cannot be emptied' }, 400);

  await c.env.DB.prepare(
    `UPDATE slots SET r2_key = NULL, alt = '', updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
  ).bind(c.var.user.id, id).run();
  await markDirty(c.env.DB, slot.page_path);
  await writeAudit(c.env.DB, c.var.user, 'slot.clear', id);
  return c.json({ ok: true });
});
