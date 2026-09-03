import { describe, expect, it } from 'vitest';
import { buildEventPage, EventPageError, slugify, renderTitle, titleSentinelId } from '../src/render/eventPage';
import { renderGalleryList } from '../src/render/galleryList';
import { assertSentinelsBalanced, readSentinel } from '../src/render/sentinel';
import { CHRISTMAS_TEMPLATE } from './fixtures/christmas2024';

describe('slugify', () => {
  it('makes a url-safe slug', () => {
    expect(slugify('Sports Day 2026')).toBe('sports-day-2026');
    expect(slugify("Teacher's Day")).toBe('teacher-s-day');
    expect(slugify('  Annual   Function  ')).toBe('annual-function');
  });

  it('returns empty for a title with nothing usable', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('caps the length', () => {
    expect(slugify('a'.repeat(200)).length).toBe(60);
  });

  it('cannot produce a path segment that escapes its directory', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('..')).toBe('');
  });
});

describe('buildEventPage, from the real Celebrations template', () => {
  const built = () => buildEventPage(CHRISTMAS_TEMPLATE, 'sports-day-2026', 'Sports Day 2026');

  it('produces a page whose sentinels validate', () => {
    const { html } = built();
    expect(() =>
      assertSentinelsBalanced(html, ['gallery-event:sports-day-2026', 'gallery-title:sports-day-2026']),
    ).not.toThrow();
  });

  it('starts with an empty photo region', () => {
    const { html, indent, closeIndent } = built();
    const inner = readSentinel(html, 'gallery-event:sports-day-2026');
    expect(inner).toBe(renderGalleryList([], { indent, closeIndent }));
    expect(inner).not.toContain('<li>');
  });

  it("carries none of the template's own photos", () => {
    const { html } = built();
    expect(html).not.toContain('christmasDay24');
  });

  it('shows the new title, not the template heading', () => {
    const { html } = built();
    expect(readSentinel(html, titleSentinelId('sports-day-2026'))).toBe('Sports Day 2026');
    expect(html).not.toContain('Christmas Day Celebration (2024)');
  });

  it('keeps the site chrome: nav, logo, footer and stylesheets', () => {
    const { html } = built();
    expect(html).toContain('resources/images/logo.png');
    expect(html).toContain('css/bootstrap.css');
    expect(html).toContain('CONTACT INFORMATION');
    expect(html).toContain('About School');
  });

  it('keeps the prettyPhoto lightbox the other event pages use', () => {
    expect(built().html).toContain('prettyPhoto');
  });

  it('carries no sequential gallery loader', () => {
    const { html } = built();
    expect(html).not.toContain('loadGalleryImages(');
    expect(html).not.toContain('gallery-loader.js');
  });

  it('escapes a title so it cannot inject markup into the heading', () => {
    const { html } = buildEventPage(CHRISTMAS_TEMPLATE, 'x', '<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(readSentinel(html, titleSentinelId('x'))).not.toContain('<script>');
  });

  it('is deterministic, so re-creating the same event yields the same bytes', () => {
    expect(built().html).toBe(built().html);
  });

  it('reports the indentation it captured, so re-renders match', () => {
    const { indent, closeIndent } = built();
    expect(indent.length).toBeGreaterThan(closeIndent.length);
    expect(indent).toBe(closeIndent + '    ');
  });
});

describe('buildEventPage failure modes', () => {
  it('refuses a template with no gallery list', () => {
    expect(() => buildEventPage('<html><body><p>no list</p></body></html>', 's', 'T')).toThrow(EventPageError);
  });

  it('refuses a template with no heading to replace', () => {
    const t = '<ul class="imgCatList">\n  <li></li>\n</ul>';
    expect(() => buildEventPage(t, 's', 'T')).toThrow(/heading/);
  });

  it('refuses a template with an unclosed list', () => {
    const t = '<h3 class="heading-agileinfo">x</h3><ul class="imgCatList">';
    expect(() => buildEventPage(t, 's', 'T')).toThrow(/unclosed/);
  });
});

describe('renderTitle', () => {
  it('escapes the title for its region', () => {
    expect(renderTitle('Art & Craft')).toBe('Art &amp; Craft');
  });
});
