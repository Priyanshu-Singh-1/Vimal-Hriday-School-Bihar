import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { requireAuth } from '../lib/middleware';

export const pages = new Hono<{ Bindings: Env; Variables: Vars }>();

pages.use('*', requireAuth);

/** Insert a space at a camelCase/PascalCase word boundary, leaving an all-caps acronym (e.g. "FIH") intact. */
function splitWords(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** Human-readable page name for a school-staff reader — never a raw file path. */
export function pageLabel(pagePath: string): string {
  const basename = pagePath.split('/').pop() ?? pagePath;
  if (basename === 'index.html') return 'Home';
  const stem = basename.replace(/\.html$/i, '').replace(/[-_]+/g, ' ');
  return splitWords(stem).replace(/\s+/g, ' ').trim();
}

type PageRow = { page_path: string; slot_count: number; edited_count: number };

pages.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT page_path,
            COUNT(*) AS slot_count,
            SUM(CASE WHEN r2_key IS NOT NULL THEN 1 ELSE 0 END) AS edited_count
     FROM slots
     GROUP BY page_path
     ORDER BY CASE WHEN page_path = 'index.html' THEN 0 ELSE 1 END, page_path`,
  ).all<PageRow>();

  return c.json(
    results.map((r) => ({
      pagePath: r.page_path,
      label: pageLabel(r.page_path),
      slotCount: r.slot_count,
      editedCount: r.edited_count,
    })),
  );
});
