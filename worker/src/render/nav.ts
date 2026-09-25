/**
 * Renders the two navbar dropdown menus ("The School", "Circulars") that the
 * console lets an operator add, edit, delete and reorder. Every other navbar
 * item is untouched static markup with no sentinel, and this feature has no
 * way to reach it.
 */

export type NavMenuKey = 'the_school' | 'circulars';

export type NavMenuItem = {
  label: string;
  href: string;
  newTab: boolean;
  badge: boolean;
};

export type NavRegion = { id: string; inner: string };

const SENTINEL_ID: Record<NavMenuKey, string> = {
  the_school: 'nav:the-school',
  circulars: 'nav:circulars',
};

// Whitespace of the shared nav markup duplicated on every public page (see
// tools/bin/add-nav-sentinels.mjs) -- verified identical on every one of the
// 45 pages that carry these two dropdowns before that codemod ran.
const INDENT = ' '.repeat(72);
const CLOSE_INDENT = ' '.repeat(64);

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** The bytes to place between one nav region's sentinel pair. */
export function renderNavList(items: NavMenuItem[]): string {
  if (!items.length) return `\n${CLOSE_INDENT}`;
  const lines = items.map((item) => {
    const target = item.newTab ? ' target="_blank"' : '';
    const badge = item.badge ? '<img src="resources/new.gif" alt="new gif"> ' : '';
    return `${INDENT}<li><a href="${esc(item.href)}"${target}>${badge}${esc(item.label)}</a></li>`;
  });
  return `\n${lines.join('\n')}\n${CLOSE_INDENT}`;
}

export function sentinelIdFor(menu: NavMenuKey): string {
  return SENTINEL_ID[menu];
}

type NavMenuItemRow = { label: string; href: string; new_tab: number; badge: number };

/**
 * Every nav region present on `html`, ready to substitute. A page that
 * predates `add-nav-sentinels.mjs` -- or was never meant to carry the
 * navbar, e.g. the carousel iframe fragment -- has neither sentinel and
 * yields no regions. That is exactly the "leave the navbar as-is" behaviour
 * the feature promises for a page with no matching admin section.
 */
export async function navRegionsFor(db: D1Database, html: string): Promise<NavRegion[]> {
  const regions: NavRegion[] = [];
  for (const menu of Object.keys(SENTINEL_ID) as NavMenuKey[]) {
    const id = SENTINEL_ID[menu];
    if (!html.includes(`<!--vhs:begin ${id}-->`)) continue;

    const { results } = await db
      .prepare('SELECT label, href, new_tab, badge FROM nav_menu_items WHERE menu = ? ORDER BY position, id')
      .bind(menu)
      .all<NavMenuItemRow>();

    const items: NavMenuItem[] = results.map((r) => ({
      label: r.label,
      href: r.href,
      newTab: r.new_tab === 1,
      badge: r.badge === 1,
    }));

    regions.push({ id, inner: renderNavList(items) });
  }
  return regions;
}
