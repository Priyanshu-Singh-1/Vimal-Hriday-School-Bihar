import { readSentinel, replaceSentinel, assertSentinelsBalanced } from './sentinel';
import { renderSlotTag, type SlotRow } from './slot';
import { galleryRegionsFor } from './gallery';

/**
 * Patch every sentinel-bounded region on one page.
 *
 * Photo slots are patched in place, preserving the live tag's exact bytes
 * apart from `src`/`alt`. Gallery regions hold a variable-length list, so they
 * are regenerated from the database instead.
 *
 * Throws if the page's sentinels do not match the regions recorded for it, so
 * a malformed page is never committed.
 */
export async function renderPage(
  db: D1Database,
  pagePath: string,
  html: string,
  publicBase: string,
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT id, page_path, label, optional, r2_key, original_src, alt
       FROM slots WHERE page_path = ? ORDER BY id`,
    )
    .bind(pagePath)
    .all<SlotRow>();

  const gallery = await galleryRegionsFor(db, pagePath, publicBase);

  if (!results.length && !gallery.length) return html;

  assertSentinelsBalanced(html, [...results.map((s) => s.id), ...gallery.map((g) => g.id)]);

  let out = html;
  for (const slot of results) {
    const currentTag = readSentinel(out, slot.id);
    out = replaceSentinel(out, slot.id, renderSlotTag(currentTag, slot, publicBase));
  }
  for (const region of gallery) {
    out = replaceSentinel(out, region.id, region.inner);
  }
  return out;
}
