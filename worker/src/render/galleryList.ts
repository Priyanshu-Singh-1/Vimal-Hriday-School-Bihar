/**
 * Renders an `<ul class="imgCatList">` body: the tile grid on a gallery
 * category page, and the photo list on an event page. Both use the identical
 * `<li><a><img/></a><p><a>TITLE</a></p></li>` shape, so one renderer serves
 * both sentinel regions.
 *
 * Unlike `renderSlotTag`, this region is regenerated wholesale rather than
 * patched in place: the list has a variable length, so there is no live tag to
 * preserve. The output therefore reproduces the site's existing formatting
 * (single-quoted href/src, `target="_blank"`, blank line between tiles) so a
 * publish that changes nothing semantically produces the smallest diff.
 */

export type GalleryTile = {
  /** Link target: an event page for a category tile, the image for a photo. */
  href: string;
  /** Thumbnail shown in the grid. */
  src: string;
  /** Caption under the thumbnail. Category tiles have one; photos do not. */
  title?: string | null;
  /** The site opens most gallery links in a new tab; a few do not. */
  newTab?: boolean;
  /**
   * A hidden tile is emitted as a commented-out `<li>`, which is the
   * convention already used on the live pages for events taken down without
   * being deleted. Round-trips: the seeder reads those comments back as
   * hidden events instead of dropping them.
   */
  visible?: boolean;
};

export type GalleryListFormat = {
  /** Indentation of each `<li>`. */
  indent: string;
  /** Indentation of the closing `</ul>`, emitted after the last tile. */
  closeIndent: string;
};

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes both attribute values and element text. `>` is escaped too, which is
 * what makes a hidden tile safe: a title containing `-->` cannot terminate the
 * HTML comment early and spill markup onto the page.
 */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function tileLines(tile: GalleryTile, indent: string): string[] {
  const inner = indent + '    ';
  const target = tile.newTab === false ? '' : ' target="_blank"';
  const href = esc(tile.href);

  const lines = [
    `${indent}<li>`,
    `${inner}<a href='${href}'${target}><img src='${esc(tile.src)}' class="img-thumbnail" /></a><br />`,
  ];
  if (tile.title != null && tile.title !== '') {
    lines.push(`${inner}<p><a href='${href}'${target}>${esc(tile.title)}</a></p>`);
  }
  lines.push(`${indent}</li>`);
  return lines;
}

/**
 * The bytes to place between a gallery region's sentinel pair. An empty list
 * still yields a well-formed (empty) region rather than a collapsed one.
 */
export function renderGalleryList(tiles: GalleryTile[], format: GalleryListFormat): string {
  const blocks = tiles.map((tile) => {
    const lines = tileLines(tile, format.indent);
    // A hidden tile keeps its indentation *inside* the comment, matching the
    // existing hand-commented tiles byte for byte.
    return tile.visible === false ? lines.map((l) => `<!--${l}-->`).join('\n') : lines.join('\n');
  });

  if (!blocks.length) return `\n${format.closeIndent}`;
  return `\n${blocks.join('\n\n')}\n${format.closeIndent}`;
}
