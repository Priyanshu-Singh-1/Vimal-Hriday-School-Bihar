import { readSentinel, replaceSentinel, assertSentinelsBalanced } from './sentinel';
import { renderSlotTag, type SlotRow } from './slot';

/**
 * Patch every sentinel-bounded slot region on one page in place, preserving
 * the live tag's exact bytes apart from `src`/`alt`. Throws if the page's
 * sentinels do not match the slots recorded for it, so a malformed page is
 * never committed.
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

  if (!results.length) return html;

  assertSentinelsBalanced(html, results.map((s) => s.id));

  let out = html;
  for (const slot of results) {
    const currentTag = readSentinel(out, slot.id);
    out = replaceSentinel(out, slot.id, renderSlotTag(currentTag, slot, publicBase));
  }
  return out;
}
