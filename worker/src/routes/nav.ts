import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { requireAuth } from '../lib/middleware';
import { writeAudit } from '../lib/audit';
import { markDirty } from './slots';
import type { NavMenuKey } from '../render/nav';

export const nav = new Hono<{ Bindings: Env; Variables: Vars }>();

nav.use('*', requireAuth);

function isMenu(v: string): v is NavMenuKey {
  return v === 'the_school' || v === 'circulars';
}

type Row = {
  id: number;
  menu: NavMenuKey;
  label: string;
  href: string;
  new_tab: number;
  badge: number;
  position: number;
};

function shape(r: Row) {
  return {
    id: r.id,
    menu: r.menu,
    label: r.label,
    href: r.href,
    newTab: r.new_tab === 1,
    badge: r.badge === 1,
    position: r.position,
  };
}

async function markAllNavPagesDirty(db: D1Database): Promise<void> {
  const { results } = await db.prepare('SELECT page_path FROM nav_pages').all<{ page_path: string }>();
  for (const { page_path } of results) await markDirty(db, page_path);
}

type ParsedFields = { label?: string; href?: string; newTab?: boolean; badge?: boolean };

/** Shared validation for create (every field required) and update (only what's given). */
function validateBody(body: any, opts: { partial: boolean }): { error: string } | ParsedFields {
  const out: ParsedFields = {};

  if (!opts.partial || body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) return { error: 'Please type a name for this link.' };
    if (label.length > 120) return { error: 'That name is too long. Please use 120 letters or fewer.' };
    out.label = label;
  }

  if (!opts.partial || body.href !== undefined) {
    const href = typeof body.href === 'string' ? body.href.trim() : '';
    if (!href) return { error: 'Please enter a web address for this link.' };
    if (href.length > 2000) return { error: 'That web address is too long.' };
    out.href = href;
  }

  if (body.newTab !== undefined) out.newTab = Boolean(body.newTab);
  if (body.badge !== undefined) out.badge = Boolean(body.badge);

  return out;
}

/** Every item in both menus, grouped. */
nav.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, menu, label, href, new_tab, badge, position FROM nav_menu_items ORDER BY menu, position, id',
  ).all<Row>();

  const byMenu: Record<NavMenuKey, ReturnType<typeof shape>[]> = { the_school: [], circulars: [] };
  for (const row of results) byMenu[row.menu].push(shape(row));
  return c.json(byMenu);
});

/** Add a link to the end of one menu. */
nav.post('/:menu', async (c) => {
  const menu = c.req.param('menu');
  if (!isMenu(menu)) return c.json({ error: 'unknown menu' }, 404);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }

  const parsed = validateBody(body, { partial: false });
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), 0) AS p FROM nav_menu_items WHERE menu = ?',
  )
    .bind(menu)
    .first<{ p: number }>();
  const position = (max?.p ?? 0) + 1;
  const newTab = parsed.newTab === false ? 0 : 1;
  const badge = parsed.badge === false ? 0 : 1;

  const inserted = await c.env.DB.prepare(
    `INSERT INTO nav_menu_items (menu, label, href, new_tab, badge, position, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(menu, parsed.label, parsed.href, newTab, badge, position, c.var.user.id)
    .first<{ id: number }>();

  await markAllNavPagesDirty(c.env.DB);
  await writeAudit(c.env.DB, c.var.user, 'nav.item.create', String(inserted?.id), {
    menu,
    label: parsed.label,
  });

  return c.json(
    {
      id: inserted?.id,
      menu,
      label: parsed.label,
      href: parsed.href,
      newTab: newTab === 1,
      badge: badge === 1,
      position,
    },
    201,
  );
});

async function load(db: D1Database, id: number): Promise<Row | null> {
  return db
    .prepare('SELECT id, menu, label, href, new_tab, badge, position FROM nav_menu_items WHERE id = ?')
    .bind(id)
    .first<Row>();
}

/** Change a link's label, address, new-tab or badge setting. */
nav.patch('/items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await load(c.env.DB, id);
  if (!item) return c.json({ error: 'not found' }, 404);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }

  const parsed = validateBody(body, { partial: true });
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  if (!Object.keys(parsed).length) return c.json({ error: 'nothing to change' }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (parsed.label !== undefined) {
    sets.push('label = ?');
    binds.push(parsed.label);
  }
  if (parsed.href !== undefined) {
    sets.push('href = ?');
    binds.push(parsed.href);
  }
  if (parsed.newTab !== undefined) {
    sets.push('new_tab = ?');
    binds.push(parsed.newTab ? 1 : 0);
  }
  if (parsed.badge !== undefined) {
    sets.push('badge = ?');
    binds.push(parsed.badge ? 1 : 0);
  }
  sets.push("updated_at = datetime('now')");
  binds.push(id);

  await c.env.DB.prepare(`UPDATE nav_menu_items SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  await markAllNavPagesDirty(c.env.DB);
  await writeAudit(c.env.DB, c.var.user, 'nav.item.update', String(id), parsed);

  const updated = await load(c.env.DB, id);
  return c.json(shape(updated!));
});

/** Remove a link. The remaining links in its menu are renumbered so they stay 1..N. */
nav.delete('/items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await load(c.env.DB, id);
  if (!item) return c.json({ error: 'not found' }, 404);

  await c.env.DB.prepare('DELETE FROM nav_menu_items WHERE id = ?').bind(id).run();
  await c.env.DB.prepare('UPDATE nav_menu_items SET position = position - 1 WHERE menu = ? AND position > ?')
    .bind(item.menu, item.position)
    .run();

  await markAllNavPagesDirty(c.env.DB);
  await writeAudit(c.env.DB, c.var.user, 'nav.item.delete', String(id), {
    menu: item.menu,
    label: item.label,
  });

  return c.json({ ok: true });
});

/** Reorder every link within one menu. */
nav.post('/:menu/order', async (c) => {
  const menu = c.req.param('menu');
  if (!isMenu(menu)) return c.json({ error: 'unknown menu' }, 404);

  let body: { ids?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (!Array.isArray(body.ids)) return c.json({ error: 'ids must be an array' }, 400);

  const { results } = await c.env.DB.prepare('SELECT id FROM nav_menu_items WHERE menu = ?')
    .bind(menu)
    .all<{ id: number }>();
  const known = new Set(results.map((r) => r.id));

  const ids = (body.ids as unknown[]).map(Number);
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    return c.json({ error: 'ids must list every link in this menu exactly once' }, 400);
  }

  for (const [i, id] of ids.entries()) {
    await c.env.DB.prepare('UPDATE nav_menu_items SET position = ? WHERE id = ?')
      .bind(i + 1, id)
      .run();
  }

  await markAllNavPagesDirty(c.env.DB);
  await writeAudit(c.env.DB, c.var.user, 'nav.menu.reorder', menu, { count: ids.length });
  return c.json({ ok: true });
});
