import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { requireAuth } from '../lib/middleware';
import { writeAudit } from '../lib/audit';
import { markDirty } from './slots';
import { photoSrc } from '../render/gallery';
import { buildEventPage, EventPageError, slugify } from '../render/eventPage';
import { createGitHubClient } from '../github/client';
import {
  MAX_PHOTOS_PER_BATCH,
  checkEventCount,
  checkPhotoBatch,
} from '../lib/galleryLimits';

/**
 * Gallery events (Phase 3).
 *
 * Every write marks the affected page(s) dirty rather than committing, so a
 * change reaches the site through the same single publish step as a photo
 * slot. Removing an event touches two pages: its category page (the tile) and,
 * on a permanent delete, the event page itself.
 */
export const gallery = new Hono<{ Bindings: Env; Variables: Vars }>();

gallery.use('*', requireAuth);

  const UNMANAGED =
    'The photos on this event\'s page are arranged in a special way, so they ' +
    'cannot be changed here. Please ask your developer.';

type EventRow = {
  id: number;
  category: string;
  slug: string;
  title: string;
  page_path: string;
  href: string;
  cover_src: string;
  new_tab: number;
  visible: number;
  position: number;
  page_owned: number;
  photos_managed: number;
};

const shapeEvent = (row: EventRow, photos: number) => ({
  id: row.id,
  category: row.category,
  slug: row.slug,
  title: row.title,
  pagePath: row.page_path,
  href: row.href,
  coverSrc: row.cover_src,
  visible: row.visible === 1,
  position: row.position,
  /** False for the pages that already existed; only an owned page may be deleted. */
  pageOwned: row.page_owned === 1,
  /**
   * False when the event page groups its photos under visible subheadings, so
   * the list cannot be regenerated without deleting them. The tile is still
   * managed; only the photos are off limits.
   */
  photosManaged: row.photos_managed === 1,
  photoCount: photos,
});

/** Categories, with how many events each holds. */
gallery.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.label, c.page_path,
            COUNT(e.id) AS events,
            SUM(CASE WHEN e.visible = 1 THEN 1 ELSE 0 END) AS shown
     FROM gallery_categories c
     LEFT JOIN gallery_events e ON e.category = c.id
     GROUP BY c.id ORDER BY c.label`,
  ).all<{ id: string; label: string; page_path: string; events: number; shown: number }>();

  return c.json(
    results.map((r) => ({
      id: r.id,
      label: r.label,
      pagePath: r.page_path,
      eventCount: r.events ?? 0,
      shownCount: r.shown ?? 0,
    })),
  );
});

/** Events in one category, in display order. */
gallery.get('/categories/:id/events', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(p.id) AS photos
     FROM gallery_events e
     LEFT JOIN gallery_photos p ON p.event_id = e.id
     WHERE e.category = ?
     GROUP BY e.id ORDER BY e.position, e.id`,
  )
    .bind(id)
    .all<EventRow & { photos: number }>();

  return c.json(results.map((r) => shapeEvent(r, r.photos ?? 0)));
});

/** One event with its photos, in display order. */
gallery.get('/events/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const event = await c.env.DB.prepare('SELECT * FROM gallery_events WHERE id = ?')
    .bind(id)
    .first<EventRow>();
  if (!event) return c.json({ error: 'not found' }, 404);

  const { results: photos } = await c.env.DB.prepare(
    'SELECT id, src, r2_key, position FROM gallery_photos WHERE event_id = ? ORDER BY position, id',
  )
    .bind(id)
    .all<{ id: number; src: string; r2_key: string | null; position: number }>();

  return c.json({
    ...shapeEvent(event, photos.length),
    photos: photos.map((p) => ({
      id: p.id,
      src: photoSrc(p, c.env.R2_PUBLIC_BASE),
      position: p.position,
    })),
  });
});

/**
 * Create an event: a new page cloned from the category's template, plus a tile
 * on the category page. Both files land in the next publish.
 *
 * The event starts hidden and with no photos, so a half-finished event is
 * never visible to a visitor. Adding its first photo and unhiding it are
 * separate, deliberate steps.
 */
gallery.post('/categories/:id/events', async (c) => {
  const categoryId = c.req.param('id');
  let body: { title?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return c.json({ error: 'Please type a name for this event.' }, 400);
  if (title.length > 120) {
    return c.json({ error: 'That name is too long. Please use 120 letters or fewer.' }, 400);
  }

  const category = await c.env.DB.prepare(
    'SELECT id, page_path, template_page, event_dir, indent, close_indent FROM gallery_categories WHERE id = ?',
  )
    .bind(categoryId)
    .first<{
      id: string;
      page_path: string;
      template_page: string;
      event_dir: string;
      indent: string;
      close_indent: string;
    }>();
  if (!category) return c.json({ error: 'not found' }, 404);

  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM gallery_events WHERE category = ?',
  )
    .bind(categoryId)
    .first<{ n: number }>();
  const tooMany = checkEventCount(count?.n ?? 0);
  if (tooMany) return c.json({ error: tooMany.error }, tooMany.status);

  const slug = slugify(title);
  if (!slug) {
    return c.json({ error: 'Please use some letters or numbers in the name.' }, 400);
  }

  const clash = await c.env.DB.prepare(
    'SELECT id FROM gallery_events WHERE category = ? AND slug = ?',
  )
    .bind(categoryId, slug)
    .first<{ id: number }>();
  if (clash) {
    return c.json({ error: 'There is already an event with that name. Please choose another.' }, 409);
  }

  const pagePath = `${category.event_dir}/${slug}.html`;

  // Clone the template so a generated page inherits the site's current
  // navigation and footer rather than a copy frozen in this Worker.
  let built;
  try {
    const gh = createGitHubClient(c.env);
    const template = await gh.readFile(category.template_page);
    built = buildEventPage(template, slug, title);
  } catch (err) {
    if (err instanceof EventPageError) {
      return c.json({ error: 'The website template could not be read. Please tell your developer.' }, 500);
    }
    return c.json({ error: 'The website could not be reached. Please try again.' }, 502);
  }

  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), 0) AS p FROM gallery_events WHERE category = ?',
  )
    .bind(categoryId)
    .first<{ p: number }>();

  // The tile href is relative to the category page, which sits in the same
  // directory as the event pages for every category shipped so far.
  const href = `${slug}.html`;

  const inserted = await c.env.DB.prepare(
    `INSERT INTO gallery_events
       (category, slug, title, page_path, href, cover_src, new_tab, visible, position,
        indent, close_indent, page_owned, has_title_region, created_by)
     VALUES (?, ?, ?, ?, ?, '', 1, 0, ?, ?, ?, 1, 1, ?)
     RETURNING id`,
  )
    .bind(
      categoryId,
      slug,
      title,
      pagePath,
      href,
      (max?.p ?? 0) + 1,
      built.indent,
      built.closeIndent,
      c.var.user.id,
    )
    .first<{ id: number }>();

  await c.env.DB.prepare(
    `INSERT INTO pending_page_ops (page_path, op, html) VALUES (?, 'create', ?)
     ON CONFLICT(page_path) DO UPDATE SET op = 'create', html = excluded.html`,
  )
    .bind(pagePath, built.html)
    .run();

  await markDirty(c.env.DB, pagePath);
  await markDirty(c.env.DB, category.page_path);

  await writeAudit(c.env.DB, c.var.user, 'gallery.event.create', slug, { title, pagePath });

  return c.json({ id: inserted?.id, slug, pagePath, title, visible: false }, 201);
});

/** Rename an event. The title shows on the category tile and the event page. */
gallery.patch('/events/:id', async (c) => {
  const id = Number(c.req.param('id'));
  let body: { title?: unknown; visible?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }

  const event = await c.env.DB.prepare('SELECT * FROM gallery_events WHERE id = ?')
    .bind(id)
    .first<EventRow>();
  if (!event) return c.json({ error: 'not found' }, 404);

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return c.json({ error: 'Please type a name for this event.' }, 400);
    if (title.length > 120) {
      return c.json({ error: 'That name is too long. Please use 120 letters or fewer.' }, 400);
    }
    sets.push('title = ?');
    binds.push(title);
  }

  if (body.visible !== undefined) {
    sets.push('visible = ?');
    binds.push(body.visible ? 1 : 0);
  }

  if (!sets.length) return c.json({ error: 'nothing to change' }, 400);

  binds.push(id);
  await c.env.DB.prepare(`UPDATE gallery_events SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  // A title or visibility change rewrites the category page's tile grid.
  await markDirty(c.env.DB, event.page_path);
  const category = await c.env.DB.prepare('SELECT page_path FROM gallery_categories WHERE id = ?')
    .bind(event.category)
    .first<{ page_path: string }>();
  if (category) await markDirty(c.env.DB, category.page_path);

  await writeAudit(c.env.DB, c.var.user, 'gallery.event.update', event.slug, {
    title: body.title === undefined ? undefined : String(body.title).trim(),
    visible: body.visible === undefined ? undefined : Boolean(body.visible),
    pagePath: event.page_path,
  });

  return c.json({ ok: true });
});

/**
 * Remove an event.
 *
 * `?mode=hide` unlists it: the tile renders commented out, which is how the
 * site already takes an event down, and any direct link still works.
 * `?mode=delete` also deletes the event page, and is refused for a page this
 * console did not create.
 */
gallery.delete('/events/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const mode = c.req.query('mode') === 'delete' ? 'delete' : 'hide';

  const event = await c.env.DB.prepare('SELECT * FROM gallery_events WHERE id = ?')
    .bind(id)
    .first<EventRow>();
  if (!event) return c.json({ error: 'not found' }, 404);

  const category = await c.env.DB.prepare('SELECT page_path FROM gallery_categories WHERE id = ?')
    .bind(event.category)
    .first<{ page_path: string }>();

  if (mode === 'hide') {
    await c.env.DB.prepare('UPDATE gallery_events SET visible = 0 WHERE id = ?').bind(id).run();
    if (category) await markDirty(c.env.DB, category.page_path);
    await writeAudit(c.env.DB, c.var.user, 'gallery.event.hide', event.slug, {
      pagePath: event.page_path,
    });
    return c.json({ ok: true, mode });
  }

  if (event.page_owned !== 1) {
    return c.json(
      {
        error:
          'This event page was part of the website before, so it cannot be deleted here. ' +
          'You can hide it instead, and it will no longer show in the gallery.',
      },
      409,
    );
  }

  await c.env.DB.prepare('DELETE FROM gallery_events WHERE id = ?').bind(id).run();
  if (category) await markDirty(c.env.DB, category.page_path);
  // Publishing turns a `deleted` row into a null-sha tree entry, which removes
  // the file. Recorded separately from the tile change because the page is a
  // second file in the same commit.
  await c.env.DB.prepare(
    `INSERT INTO pending_publish (page_path) VALUES (?)
     ON CONFLICT(page_path) DO UPDATE SET marked_at = datetime('now')`,
  )
    .bind(event.page_path)
    .run();

  await writeAudit(c.env.DB, c.var.user, 'gallery.event.delete', event.slug, {
    pagePath: event.page_path,
  });

  return c.json({ ok: true, mode });
});

/** Reorder the events in a category. */
gallery.post('/categories/:id/order', async (c) => {
  const categoryId = c.req.param('id');
  let body: { ids?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (!Array.isArray(body.ids)) return c.json({ error: 'ids must be an array' }, 400);

  const { results } = await c.env.DB.prepare('SELECT id FROM gallery_events WHERE category = ?')
    .bind(categoryId)
    .all<{ id: number }>();
  const known = new Set(results.map((r) => r.id));

  const ids = (body.ids as unknown[]).map(Number);
  if (ids.length !== known.size || ids.some((id: number) => !known.has(id))) {
    return c.json({ error: 'ids must list every event in this category exactly once' }, 400);
  }

  for (const [i, id] of ids.entries()) {
    await c.env.DB.prepare('UPDATE gallery_events SET position = ? WHERE id = ?')
      .bind(i + 1, id)
      .run();
  }

  const category = await c.env.DB.prepare('SELECT page_path FROM gallery_categories WHERE id = ?')
    .bind(categoryId)
    .first<{ page_path: string }>();
  if (category) await markDirty(c.env.DB, category.page_path);

  await writeAudit(c.env.DB, c.var.user, 'gallery.category.reorder', categoryId, { count: ids.length });
  return c.json({ ok: true });
});

/** Attach already-uploaded photos to an event. */
gallery.post('/events/:id/photos', async (c) => {
  const id = Number(c.req.param('id'));
  let body: { r2Keys?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }

  const event = await c.env.DB.prepare('SELECT * FROM gallery_events WHERE id = ?')
    .bind(id)
    .first<EventRow>();
  if (!event) return c.json({ error: 'not found' }, 404);

  if (event.photos_managed !== 1) return c.json({ error: UNMANAGED }, 409);

  if (!Array.isArray(body.r2Keys)) return c.json({ error: 'r2Keys must be an array' }, 400);
  const keys = (body.r2Keys as unknown[]).filter((k): k is string => typeof k === 'string' && k.length > 0);

  const existing = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM gallery_photos WHERE event_id = ?',
  )
    .bind(id)
    .first<{ n: number }>();

  const refusal = checkPhotoBatch(existing?.n ?? 0, keys.length);
  if (refusal) return c.json({ error: refusal.error }, refusal.status);

  // Every key must be a real uploaded asset, so a typo cannot bake a dead
  // image url into the page.
  const placeholders = keys.map(() => '?').join(', ');
  const { results: assets } = await c.env.DB.prepare(
    `SELECT r2_key FROM assets WHERE r2_key IN (${placeholders})`,
  )
    .bind(...keys)
    .all<{ r2_key: string }>();
  if (assets.length !== keys.length) {
    return c.json({ error: 'Some of those photos are no longer available. Please try again.' }, 400);
  }

  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), 0) AS p FROM gallery_photos WHERE event_id = ?',
  )
    .bind(id)
    .first<{ p: number }>();

  let position = max?.p ?? 0;
  for (const key of keys) {
    position += 1;
    await c.env.DB.prepare(
      `INSERT INTO gallery_photos (event_id, src, r2_key, position, added_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, '', key, position, c.var.user.id)
      .run();
    await c.env.DB.prepare('UPDATE assets SET bound = 1 WHERE r2_key = ?').bind(key).run();
  }

  await markDirty(c.env.DB, event.page_path);
  await writeAudit(c.env.DB, c.var.user, 'gallery.photo.add', event.slug, {
    count: keys.length,
    pagePath: event.page_path,
  });

  return c.json({ ok: true, added: keys.length, limit: MAX_PHOTOS_PER_BATCH }, 201);
});

/** Remove one photo from an event. */
gallery.delete('/events/:eventId/photos/:photoId', async (c) => {
  const eventId = Number(c.req.param('eventId'));
  const photoId = Number(c.req.param('photoId'));

  const event = await c.env.DB.prepare('SELECT * FROM gallery_events WHERE id = ?')
    .bind(eventId)
    .first<EventRow>();
  if (!event) return c.json({ error: 'not found' }, 404);

  if (event.photos_managed !== 1) return c.json({ error: UNMANAGED }, 409);

  const photo = await c.env.DB.prepare(
    'SELECT id, r2_key FROM gallery_photos WHERE id = ? AND event_id = ?',
  )
    .bind(photoId, eventId)
    .first<{ id: number; r2_key: string | null }>();
  if (!photo) return c.json({ error: 'not found' }, 404);

  const remaining = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM gallery_photos WHERE event_id = ?',
  )
    .bind(eventId)
    .first<{ n: number }>();
  if ((remaining?.n ?? 0) <= 1) {
    return c.json(
      {
        error:
          'An event needs at least one photo. Please add another photo first, ' +
          'or hide the whole event.',
      },
      409,
    );
  }

  await c.env.DB.prepare('DELETE FROM gallery_photos WHERE id = ?').bind(photoId).run();
  // The asset stays in R2; the unbound sweep reclaims it if nothing else uses it.
  if (photo.r2_key) {
    const stillUsed = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM gallery_photos WHERE r2_key = ?',
    )
      .bind(photo.r2_key)
      .first<{ n: number }>();
    if ((stillUsed?.n ?? 0) === 0) {
      await c.env.DB.prepare('UPDATE assets SET bound = 0 WHERE r2_key = ?')
        .bind(photo.r2_key)
        .run();
    }
  }

  await markDirty(c.env.DB, event.page_path);
  await writeAudit(c.env.DB, c.var.user, 'gallery.photo.remove', event.slug, {
    pagePath: event.page_path,
  });

  return c.json({ ok: true });
});

/** Reorder an event's photos. */
gallery.post('/events/:id/photos/order', async (c) => {
  const id = Number(c.req.param('id'));
  let body: { ids?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (!Array.isArray(body.ids)) return c.json({ error: 'ids must be an array' }, 400);

  const event = await c.env.DB.prepare('SELECT * FROM gallery_events WHERE id = ?')
    .bind(id)
    .first<EventRow>();
  if (!event) return c.json({ error: 'not found' }, 404);

  if (event.photos_managed !== 1) return c.json({ error: UNMANAGED }, 409);

  const { results } = await c.env.DB.prepare('SELECT id FROM gallery_photos WHERE event_id = ?')
    .bind(id)
    .all<{ id: number }>();
  const known = new Set(results.map((r) => r.id));

  const ids = (body.ids as unknown[]).map(Number);
  if (ids.length !== known.size || ids.some((p: number) => !known.has(p))) {
    return c.json({ error: 'ids must list every photo in this event exactly once' }, 400);
  }

  for (const [i, photoId] of ids.entries()) {
    await c.env.DB.prepare('UPDATE gallery_photos SET position = ? WHERE id = ?')
      .bind(i + 1, photoId)
      .run();
  }

  await markDirty(c.env.DB, event.page_path);
  await writeAudit(c.env.DB, c.var.user, 'gallery.photo.reorder', event.slug, {
    count: ids.length,
    pagePath: event.page_path,
  });
  return c.json({ ok: true });
});
