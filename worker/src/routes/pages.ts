import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { requireAuth } from '../lib/middleware';
import { slotAbsoluteSrc } from '../lib/urls';

export const pages = new Hono<{ Bindings: Env; Variables: Vars }>();

pages.use('*', requireAuth);

/** Insert a space at a camelCase/PascalCase word boundary, leaving an all-caps acronym (e.g. "FIH") intact. */
function splitWords(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

// Friendly page names for phase-1 pages, per design_handoff_admin_console/MICROCOPY.md
// ("Friendly page names" table) — that document is the source of truth for this wording.
const FRIENDLY_PAGE_NAMES: Record<string, string> = {
  'index.html': 'Home page',
  'pages/about/OurManagement.html': 'Our Management',
  'pages/about/OurFounder.html': 'Our Founder',
  'pages/about/PrincipalMessage.html': "Principal's Message",
  'pages/about/FIH.html': 'FIH Congregation',
};

/** Human-readable page name for a school-staff reader — never a raw file path. */
export function pageLabel(pagePath: string): string {
  const friendly = FRIENDLY_PAGE_NAMES[pagePath];
  if (friendly) return friendly;
  const basename = pagePath.split('/').pop() ?? pagePath;
  if (basename === 'index.html') return 'Home';
  const stem = basename.replace(/\.html$/i, '').replace(/[-_]+/g, ' ');
  return splitWords(stem).replace(/\s+/g, ' ').trim();
}

type PageRow = { page_path: string; slot_count: number; edited_count: number; unpublished_count: number };
type ThumbRow = { page_path: string; r2_key: string | null; original_src: string };

const MAX_THUMBS = 3;

/** Up to `MAX_THUMBS` absolute thumbnail URLs per page, in ascending slot id order. */
function thumbsByPage(rows: ThumbRow[], r2Base: string, siteBase: string): Map<string, string[]> {
  const byPage = new Map<string, string[]>();
  for (const row of rows) {
    const thumbs = byPage.get(row.page_path) ?? [];
    if (thumbs.length < MAX_THUMBS) {
      thumbs.push(slotAbsoluteSrc(row, r2Base, siteBase));
      byPage.set(row.page_path, thumbs);
    }
  }
  return byPage;
}

pages.get('/', async (c) => {
  // `edited_count` = slots whose photo differs from the original, ever (r2_key set) —
  // stays true forever, even once published. `unpublished_count` = slots that are part
  // of a batch still waiting to go on the website: 0 unless this page has a row in
  // pending_publish, in which case it's the edited slots (the best available proxy for
  // "photos changed in this pending batch"). Do not conflate the two — a published page
  // keeps edited_count > 0 forever, but unpublished_count must drop back to 0.
  const { results } = await c.env.DB.prepare(
    `SELECT s.page_path,
            COUNT(*) AS slot_count,
            SUM(CASE WHEN s.r2_key IS NOT NULL THEN 1 ELSE 0 END) AS edited_count,
            CASE WHEN MAX(pp.page_path) IS NOT NULL
                 THEN SUM(CASE WHEN s.r2_key IS NOT NULL THEN 1 ELSE 0 END)
                 ELSE 0 END AS unpublished_count
     FROM slots s
     LEFT JOIN pending_publish pp ON pp.page_path = s.page_path
     GROUP BY s.page_path
     ORDER BY CASE WHEN s.page_path = 'index.html' THEN 0 ELSE 1 END, s.page_path`,
  ).all<PageRow>();

  const { results: slotRows } = await c.env.DB.prepare(
    `SELECT page_path, r2_key, original_src FROM slots ORDER BY page_path, id`,
  ).all<ThumbRow>();
  const thumbs = thumbsByPage(slotRows, c.env.R2_PUBLIC_BASE, c.env.SITE_BASE);

  return c.json(
    results.map((r) => ({
      pagePath: r.page_path,
      label: pageLabel(r.page_path),
      slotCount: r.slot_count,
      editedCount: r.edited_count,
      unpublishedCount: r.unpublished_count,
      thumbs: thumbs.get(r.page_path) ?? [],
    })),
  );
});
