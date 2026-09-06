#!/usr/bin/env node
/**
 * Seeds one gallery category: wraps its imgCatList region in a sentinel pair
 * and prints the SQL for its events.
 *
 * Dry run by default — prints what it would do and changes nothing.
 * Pass --apply to write the html.
 *
 *   node tools/bin/seed-gallery.mjs celebrations
 *   node tools/bin/seed-gallery.mjs celebrations --apply > seed.sql
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findRegion, parseTiles, writeRegion, renderTiles, slugFromHref, resolveHref,
} from '../src/gallery.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Kept in step with the gallery_categories rows in migration 0005. */
export const CATEGORIES = {
  celebrations: {
    label: 'Celebrations',
    pagePath: 'pages/events/celebration.html',
    // Must match gallery_categories.indent / close_indent in migration 0005.
    indent: ' '.repeat(36),
    closeIndent: ' '.repeat(24),
  },
  // Migration 0006. Both pages use the same 24/36 shape as celebration.html.
  noncurricular: {
    label: 'Non-curricular activities',
    pagePath: 'pages/curriculum/noncurricular.html',
    indent: ' '.repeat(36),
    closeIndent: ' '.repeat(24),
  },
  cultural: {
    label: 'Cultural events',
    pagePath: 'pages/curriculum/cultural.html',
    indent: ' '.repeat(36),
    closeIndent: ' '.repeat(24),
  },
};

const sqlStr = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

export function planCategory(html, categoryId, pagePath, format, pageExists) {
  const region = findRegion(html);
  if (!region) throw new Error(`no imgCatList region in ${pagePath}`);

  const { tiles: allTiles, dropped } = parseTiles(region.body);

  // A tile whose event page no longer exists cannot be managed: showing it
  // would publish a link to a 404. Every one of these on the live site is
  // already commented out, so dropping it changes nothing a visitor sees.
  const missing = [];
  const tiles = allTiles.filter((t) => {
    const target = resolveHref(pagePath, t.href);
    if (pageExists && !pageExists(target)) {
      missing.push({ title: t.title, target, visible: t.visible });
      return false;
    }
    return true;
  });

  const events = tiles.map((t, i) => ({
    category: categoryId,
    slug: slugFromHref(t.href),
    title: t.title ?? slugFromHref(t.href),
    pagePath: resolveHref(pagePath, t.href),
    href: t.href,
    coverSrc: t.src,
    newTab: t.newTab ? 1 : 0,
    visible: t.visible ? 1 : 0,
    position: i + 1,
  }));

  const fmt = format || { indent: ' '.repeat(36), closeIndent: region.closeIndent };
  const inner = renderTiles(tiles, fmt);

  return {
    rewritten: writeRegion(html, `gallery-cat:${categoryId}`, inner),
    events,
    dropped,
    missing,
    closeIndent: region.closeIndent,
  };
}

export function eventsSql(events) {
  const lines = events.map(
    (e) =>
      `  (${sqlStr(e.category)}, ${sqlStr(e.slug)}, ${sqlStr(e.title)}, ${sqlStr(e.pagePath)}, ` +
      `${sqlStr(e.href)}, ${sqlStr(e.coverSrc)}, ${e.newTab}, ${e.visible}, ${e.position}, 0)`,
  );
  return (
    'INSERT INTO gallery_events\n' +
    '  (category, slug, title, page_path, href, cover_src, new_tab, visible, position, page_owned)\n' +
    'VALUES\n' +
    lines.join(',\n') +
    ';\n'
  );
}


/**
 * Plan one event page: wrap its photo region in a sentinel pair and read the
 * photos already on it.
 *
 * Runs for pages the loader codemod already converted (their sentinel is
 * present, so wrapping is a no-op) and for pages that always had a hardcoded
 * list. Both end up managed the same way.
 */
export function planEventPage(html, slug) {
  const region = findRegion(html);
  if (!region) return null;

  const { tiles, dropped } = parseTiles(region.body);

  // Visible content inside the region that is not a tile -- noticeBoard.html
  // groups its photos under <h2> subheadings -- cannot survive regenerating
  // the region from a flat photo list. Refuse to manage that page's photos
  // rather than deleting what a visitor can see.
  const unmanageable = dropped.filter((d) => !/^\s*<!--/.test(d) && d.trim());
  if (unmanageable.length) {
    return { managed: false, unmanageable, photos: [], dropped };
  }

  // Canonical formatting derived from the <ul>, so the bytes on disk are
  // exactly what the Worker will re-render.
  const closeIndent = region.closeIndent;
  const indent = closeIndent + '    ';
  const photoTiles = tiles.map((t) => ({ href: t.src, src: t.src, title: null, newTab: true }));

  return {
    managed: true,
    rewritten: writeRegion(html, `gallery-event:${slug}`, renderTiles(photoTiles, { indent, closeIndent })),
    photos: tiles.map((t, i) => ({ src: t.src, position: i + 1 })),
    indent,
    closeIndent,
    dropped,
  };
}

export function photosSql(categoryId, slug, photos) {
  if (!photos.length) return '';
  const idExpr = `(SELECT id FROM gallery_events WHERE category = ${sqlStr(categoryId)} AND slug = ${sqlStr(slug)})`;
  const rows = photos.map((p) => `  (${idExpr}, ${sqlStr(p.src)}, NULL, ${p.position})`);
  return (
    'INSERT INTO gallery_photos (event_id, src, r2_key, position)\nVALUES\n' +
    rows.join(',\n') +
    ';\n'
  );
}

/** Store the indentation the renderer must reproduce for this event page. */
export function eventFormatSql(categoryId, slug, indent, closeIndent) {
  return (
    `UPDATE gallery_events SET indent = ${sqlStr(indent)}, close_indent = ${sqlStr(closeIndent)}\n` +
    `WHERE category = ${sqlStr(categoryId)} AND slug = ${sqlStr(slug)};\n`
  );
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const id = args.find((a) => !a.startsWith('--'));

  const category = CATEGORIES[id];
  if (!category) {
    console.error(`unknown category ${JSON.stringify(id)}; known: ${Object.keys(CATEGORIES).join(', ')}`);
    process.exit(2);
  }

  const abs = join(REPO, category.pagePath);
  const html = readFileSync(abs, 'utf8');
  const plan = planCategory(
    html,
    id,
    category.pagePath,
    { indent: category.indent, closeIndent: category.closeIndent },
    (target) => existsSync(join(REPO, target)),
  );

  const added = plan.rewritten.length - html.length;
  const log = (m) => console.error(m);

  log(`${category.pagePath}`);
  log(`  sentinel gallery-cat:${id}   region rewritten to canonical form (${added >= 0 ? '+' : ''}${added} bytes)`);
  log(`  closeIndent ${JSON.stringify(plan.closeIndent)} (must match gallery_categories.close_indent)`);
  log(`  ${plan.events.length} events:`);
  for (const e of plan.events) {
    log(`    ${e.visible ? 'shown ' : 'hidden'} ${e.position}. ${e.title}  ->  ${e.pagePath}`);
  }
  if (plan.missing.length) {
    log(`  ${plan.missing.length} tile(s) skipped -- their event page no longer exists:`);
    for (const m of plan.missing) {
      log(`    ${m.visible ? 'WAS SHOWN' : 'hidden'}  ${m.title}  ->  ${m.target}`);
    }
  }
  if (plan.dropped.length) {
    log(`  ${plan.dropped.length} line(s) will be dropped when the region is next published:`);
    for (const d of plan.dropped) log(`    ${JSON.stringify(d.trim())}`);
  }

  if (apply) {
    writeFileSync(abs, plan.rewritten);
    log(`  written`);
  }

  let sql = eventsSql(plan.events);

  // Each event's own page: wrap its photo region and record the photos on it.
  // Without this the region would be regenerated from an empty table on the
  // first publish, silently emptying the page.
  for (const e of plan.events) {
    const eventAbs = join(REPO, e.pagePath);
    let eventHtml;
    try {
      eventHtml = readFileSync(eventAbs, 'utf8');
    } catch {
      log(`    ! ${e.pagePath} is missing; skipped`);
      continue;
    }

    const ep = planEventPage(eventHtml, e.slug);
    if (!ep) {
      log(`    ! ${e.pagePath} has no photo list; skipped`);
      continue;
    }

    if (!ep.managed) {
      log(`    ${e.slug}: photo list NOT managed -- the region holds visible content ` +
          `that is not a photo (${ep.unmanageable.length} line(s)); page left untouched:`);
      for (const u of ep.unmanageable.slice(0, 3)) log(`        ${JSON.stringify(u.trim().slice(0, 76))}`);
      sql += `UPDATE gallery_events SET photos_managed = 0\n` +
             `WHERE category = ${sqlStr(id)} AND slug = ${sqlStr(e.slug)};\n`;
      continue;
    }

    const added = ep.rewritten.length - eventHtml.length;
    log(`    ${e.slug}: ${ep.photos.length} photos, ${added >= 0 ? '+' : ''}${added} bytes` +
        (ep.dropped.length ? `, ${ep.dropped.length} line(s) dropped on publish` : ''));
    for (const d of ep.dropped) log(`        ${JSON.stringify(d.trim())}`);

    if (apply) writeFileSync(eventAbs, ep.rewritten);
    sql += eventFormatSql(id, e.slug, ep.indent, ep.closeIndent);
    sql += photosSql(id, e.slug, ep.photos);
  }

  if (!apply) log(`  dry run — pass --apply to write`);
  process.stdout.write(sql);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
