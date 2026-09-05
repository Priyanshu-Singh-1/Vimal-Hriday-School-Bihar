import { describe, expect, it } from 'vitest';
import { renderGalleryList, type GalleryTile } from '../src/render/galleryList';

/**
 * The photo region that tools/bin/convert-gallery-loader.mjs writes into
 * pages/events/planting.html, verbatim.
 *
 * This pins the codemod's output to the Worker's renderer. If they ever
 * diverge, the first publish of a converted page would rewrite the whole
 * region for no reason, producing a large diff that hides the real change.
 */
const CONVERTED_REGION = `
            <li>
                <a href='../../resources/noncurricular/planting/p_1.jpg' target="_blank"><img src='../../resources/noncurricular/planting/p_1.jpg' class="img-thumbnail" /></a><br />
            </li>

            <li>
                <a href='../../resources/noncurricular/planting/p_2.jpg' target="_blank"><img src='../../resources/noncurricular/planting/p_2.jpg' class="img-thumbnail" /></a><br />
            </li>

            <li>
                <a href='../../resources/noncurricular/planting/p_3.jpg' target="_blank"><img src='../../resources/noncurricular/planting/p_3.jpg' class="img-thumbnail" /></a><br />
            </li>

            <li>
                <a href='../../resources/noncurricular/planting/p_4.jpg' target="_blank"><img src='../../resources/noncurricular/planting/p_4.jpg' class="img-thumbnail" /></a><br />
            </li>

            <li>
                <a href='../../resources/noncurricular/planting/p_5.jpg' target="_blank"><img src='../../resources/noncurricular/planting/p_5.jpg' class="img-thumbnail" /></a><br />
            </li>

            <li>
                <a href='../../resources/noncurricular/planting/p_6.jpg' target="_blank"><img src='../../resources/noncurricular/planting/p_6.jpg' class="img-thumbnail" /></a><br />
            </li>

            <li>
                <a href='../../resources/noncurricular/planting/p_7.jpg' target="_blank"><img src='../../resources/noncurricular/planting/p_7.jpg' class="img-thumbnail" /></a><br />
            </li>
        `;

const BASE = '../../resources/noncurricular/planting/';

/** What the old loadGalleryImages('imageGallery', BASE, 7, 'p_', 'jpg') produced. */
const LOADER_PATHS = Array.from({ length: 7 }, (_, i) => `${BASE}p_${i + 1}.jpg`);

describe('a converted loader page', () => {
  const tiles: GalleryTile[] = LOADER_PATHS.map((p) => ({ href: p, src: p, title: null, newTab: true }));
  const format = { indent: ' '.repeat(12), closeIndent: ' '.repeat(8) };

  it('is reproduced byte for byte by the renderer, so publishing it is a no-op', () => {
    expect(renderGalleryList(tiles, format)).toBe(CONVERTED_REGION);
  });

  it('keeps every photo the loader would have shown, in order', () => {
    const srcs = [...CONVERTED_REGION.matchAll(/<img src='([^']*)'/g)].map((m) => m[1]);
    expect(srcs).toEqual(LOADER_PATHS);
  });

  it('carries no caption, matching the loader output', () => {
    expect(CONVERTED_REGION).not.toContain('<p>');
  });

  it('opens each photo in a new tab, as the loader did', () => {
    expect(CONVERTED_REGION.match(/target="_blank"/g)).toHaveLength(7);
  });

  it('adds no data-gal, so the prettyPhoto lightbox behaves as before', () => {
    expect(CONVERTED_REGION).not.toContain('data-gal');
  });

  it('supports removing a photo, which the sequential loader could not express', () => {
    const withoutThird = tiles.filter((_, i) => i !== 2);
    const out = renderGalleryList(withoutThird, format);
    const srcs = [...out.matchAll(/<img src='([^']*)'/g)].map((m) => m[1]);
    expect(srcs).toHaveLength(6);
    expect(srcs).not.toContain(`${BASE}p_3.jpg`);
    // The remaining photos keep their original filenames -- no renumbering.
    expect(srcs).toContain(`${BASE}p_7.jpg`);
  });
});
