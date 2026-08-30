import { describe, it, expect } from 'vitest';
import { absoluteImageUrl, slotAbsoluteSrc } from '../src/lib/urls';

const SITE_BASE = 'https://vhspurnea.com';

describe('absoluteImageUrl', () => {
  it('resolves a path relative to a nested page directory, normalising ../ segments', () => {
    expect(absoluteImageUrl('../../resources/FIH/fih1.jpg', 'pages/about/FIH.html', SITE_BASE)).toBe(
      'https://vhspurnea.com/resources/FIH/fih1.jpg',
    );
  });

  it('resolves a same-directory relative path', () => {
    expect(absoluteImageUrl('fih2.jpg', 'pages/about/FIH.html', SITE_BASE)).toBe(
      'https://vhspurnea.com/pages/about/fih2.jpg',
    );
  });

  it('resolves a root-level page with no directory component', () => {
    expect(absoluteImageUrl('resources/x.jpg', 'index.html', SITE_BASE)).toBe(
      'https://vhspurnea.com/resources/x.jpg',
    );
  });

  it('passes an already-absolute URL through untouched', () => {
    const absolute = 'https://pub-c2938dd31a774bf793fdb1726e4c5e3b.r2.dev/up/ab/x.webp';
    expect(absoluteImageUrl(absolute, 'pages/about/FIH.html', SITE_BASE)).toBe(absolute);
  });

  it('preserves percent-encoding byte-for-byte', () => {
    expect(
      absoluteImageUrl('../../resources/Sr%20Anita%27s%20visit.jpg', 'pages/about/FIH.html', SITE_BASE),
    ).toBe('https://vhspurnea.com/resources/Sr%20Anita%27s%20visit.jpg');
  });

  it('strips a trailing slash from siteBase', () => {
    expect(absoluteImageUrl('resources/x.jpg', 'index.html', 'https://vhspurnea.com/')).toBe(
      'https://vhspurnea.com/resources/x.jpg',
    );
  });
});

describe('slotAbsoluteSrc', () => {
  const R2_BASE = 'https://img.test';

  it('resolves an r2-backed slot against r2Base, ignoring original_src', () => {
    const src = slotAbsoluteSrc(
      { r2_key: 'up/ab/new.webp', original_src: '../../resources/old.jpg', page_path: 'pages/about/FIH.html' },
      R2_BASE,
      SITE_BASE,
    );
    expect(src).toBe('https://img.test/up/ab/new.webp');
  });

  it('resolves an unedited slot against siteBase', () => {
    const src = slotAbsoluteSrc(
      { r2_key: null, original_src: '../../resources/FIH/fih1.jpg', page_path: 'pages/about/FIH.html' },
      R2_BASE,
      SITE_BASE,
    );
    expect(src).toBe('https://vhspurnea.com/resources/FIH/fih1.jpg');
  });
});
