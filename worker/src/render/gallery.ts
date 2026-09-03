import { renderGalleryList, type GalleryTile } from './galleryList';
import { renderTitle, titleSentinelId } from './eventPage';

/**
 * Resolves the sentinel-bounded gallery regions on one page.
 *
 * A page can be a category page (a grid of event tiles), an event page (a list
 * of photos), or neither. Nothing here parses HTML; each region is identified
 * by its sentinel id and its body is regenerated from the database.
 */

export type CategoryRow = {
  id: string;
  page_path: string;
  indent: string;
  close_indent: string;
};

export type EventRow = {
  id: number;
  slug: string;
  title: string;
  href: string;
  cover_src: string;
  new_tab: number;
  visible: number;
  indent: string;
  close_indent: string;
  has_title_region: number;
  photos_managed: number;
};

export type PhotoRow = { src: string; r2_key: string | null };

/** A photo's published url: its R2 object when uploaded, else the path already on the page. */
export function photoSrc(photo: PhotoRow, publicBase: string): string {
  if (!photo.r2_key) return photo.src;
  return `${publicBase.replace(/\/$/, '')}/${photo.r2_key}`;
}

export type GalleryRegion = { id: string; inner: string };

/**
 * Every gallery region belonging to `pagePath`, ready to substitute. Empty
 * when the page is not part of the gallery.
 */
export async function galleryRegionsFor(
  db: D1Database,
  pagePath: string,
  publicBase: string,
): Promise<GalleryRegion[]> {
  const regions: GalleryRegion[] = [];

  const category = await db
    .prepare('SELECT id, page_path, indent, close_indent FROM gallery_categories WHERE page_path = ?')
    .bind(pagePath)
    .first<CategoryRow>();

  if (category) {
    const { results: events } = await db
      .prepare(
        `SELECT id, slug, title, href, cover_src, new_tab, visible, indent, close_indent,
              has_title_region, photos_managed
         FROM gallery_events WHERE category = ? ORDER BY position, id`,
      )
      .bind(category.id)
      .all<EventRow>();

    const tiles: GalleryTile[] = events.map((e) => ({
      href: e.href,
      src: e.cover_src,
      title: e.title,
      newTab: e.new_tab === 1,
      visible: e.visible === 1,
    }));

    regions.push({
      id: `gallery-cat:${category.id}`,
      inner: renderGalleryList(tiles, {
        indent: category.indent,
        closeIndent: category.close_indent,
      }),
    });
  }

  // A page can host at most one event region, but selecting by page_path keeps
  // the query honest if two events ever pointed at the same file.
  const { results: events } = await db
    .prepare(
      `SELECT id, slug, title, href, cover_src, new_tab, visible, indent, close_indent,
              has_title_region, photos_managed
       FROM gallery_events WHERE page_path = ? ORDER BY id`,
    )
    .bind(pagePath)
    .all<EventRow>();

  for (const event of events) {
    // An event page whose photo list carries visible subheadings is not
    // managed: regenerating it from a flat list would delete them, and the
    // page has no sentinel to render into.
    if (event.photos_managed !== 1) continue;

    const { results: photos } = await db
      .prepare('SELECT src, r2_key FROM gallery_photos WHERE event_id = ? ORDER BY position, id')
      .bind(event.id)
      .all<PhotoRow>();

    const tiles: GalleryTile[] = photos.map((p) => {
      const url = photoSrc(p, publicBase);
      // A photo links to itself, exactly as the old loader emitted.
      return { href: url, src: url, title: null, newTab: true };
    });

    regions.push({
      id: `gallery-event:${event.slug}`,
      inner: renderGalleryList(tiles, { indent: event.indent, closeIndent: event.close_indent }),
    });

    // Only a page this console generated has a heading region to update.
    if (event.has_title_region === 1) {
      regions.push({ id: titleSentinelId(event.slug), inner: renderTitle(event.title) });
    }
  }

  return regions;
}
