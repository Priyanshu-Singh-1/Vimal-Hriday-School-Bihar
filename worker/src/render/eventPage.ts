import { renderGalleryList } from './galleryList';

/**
 * Builds a new event page by cloning an existing one.
 *
 * The site has no build step and no shared layout, so every page carries its
 * own copy of the header, navigation and footer. Generating a page from a
 * hardcoded template in this Worker would let it drift from the other 46
 * pages the first time someone edits the menu. Cloning a real page instead
 * means a new event inherits whatever the site currently looks like.
 */

export class EventPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventPageError';
  }
}

const UL_OPEN = /([ \t]*)<ul\s+class="imgCatList"(\s+id="[^"]*")?\s*>/i;
const H3 = /<h3\s+class="heading-agileinfo"\s*>([\s\S]*?)<\/h3>/i;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/**
 * A url-safe slug for an event title. Returns '' when the title has no
 * usable characters, which the caller must treat as invalid.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export type BuiltEventPage = {
  html: string;
  /** Indentation captured from the template, stored so re-renders match. */
  indent: string;
  closeIndent: string;
};

/**
 * Clone `template` into a page for `slug`/`title`: an empty sentinel-wrapped
 * photo region, the heading replaced and wrapped in its own sentinel, and any
 * sequential gallery loader removed.
 */
export function buildEventPage(template: string, slug: string, title: string): BuiltEventPage {
  const open = UL_OPEN.exec(template);
  if (!open) throw new EventPageError('template has no <ul class="imgCatList"> region');

  const indent = open[1]! + '    ';
  const closeIndent = open[1]!;
  const bodyStart = open.index + open[0].length;
  const close = template.indexOf('</ul>', bodyStart);
  if (close === -1) throw new EventPageError('template has an unclosed gallery list');

  const photoId = `gallery-event:${slug}`;
  const empty = renderGalleryList([], { indent, closeIndent });

  let html =
    template.slice(0, bodyStart) +
    `<!--vhs:begin ${photoId}-->` +
    empty +
    `<!--vhs:end ${photoId}-->` +
    template.slice(close);

  // The heading is the one piece of a cloned page that must not stay as the
  // template's. Wrapped in its own sentinel so a later rename can update it.
  const titleId = `gallery-title:${slug}`;
  if (!H3.test(html)) throw new EventPageError('template has no heading to replace');
  html = html.replace(
    H3,
    `<h3 class="heading-agileinfo"><!--vhs:begin ${titleId}-->${esc(title)}<!--vhs:end ${titleId}--></h3>`,
  );

  // A cloned template must never carry the sequential loader, which would call
  // gallery.empty() and wipe the region on page load.
  html = html
    .replace(/\n[ \t]*<!--\s*Dynamic Image Gallery Script\s*-->/i, '')
    .replace(/\n[ \t]*<script[^>]*src="[^"]*gallery-loader\.js"[^>]*>\s*<\/script>/i, '');
  const call = html.indexOf('loadGalleryImages(');
  if (call !== -1) {
    const scriptOpen = html.lastIndexOf('<script', call);
    const scriptClose = html.indexOf('</script>', call);
    if (scriptOpen !== -1 && scriptClose !== -1) {
      let start = scriptOpen;
      while (start > 0 && (html[start - 1] === ' ' || html[start - 1] === '\t')) start -= 1;
      if (start > 0 && html[start - 1] === '\n') start -= 1;
      html = html.slice(0, start) + html.slice(scriptClose + '</script>'.length);
    }
  }

  return { html, indent, closeIndent };
}

/** The title region on a generated page, so a rename can re-render it. */
export function titleSentinelId(slug: string): string {
  return `gallery-title:${slug}`;
}

/** Escaped title bytes for the title region. */
export function renderTitle(title: string): string {
  return esc(title);
}
