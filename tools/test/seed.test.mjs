import { describe, it, expect } from 'vitest';
import { planPage, PILOT_PAGES } from '../bin/seed-pilot-slots.mjs';

const page = [
  '<body>',
  '  <img src="../../resources/new.gif" alt="new gif">',
  '  <img src="../../resources/management/1.jpeg" alt="Chairman">',
  "  <img src='../../resources/homeslider/School%20(6).jpeg'>",
  '  <!-- <img src="./new.gif" alt="commented"> -->',
  '</body>',
].join('\n');

describe('planPage', () => {
  it('creates a slot per content image and skips chrome and comments', () => {
    const { slots } = planPage(page, 'pages/about/OurManagement.html');
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.id)).toEqual(['ourmanagement.img.1', 'ourmanagement.img.2']);
  });

  it('records the original src verbatim, still percent-encoded', () => {
    const { slots } = planPage(page, 'pages/about/OurManagement.html');
    expect(slots[0].originalSrc).toBe('../../resources/management/1.jpeg');
    expect(slots[1].originalSrc).toBe('../../resources/homeslider/School%20(6).jpeg');
  });

  it('carries the existing alt text across', () => {
    const { slots } = planPage(page, 'pages/about/OurManagement.html');
    expect(slots[0].alt).toBe('Chairman');
    expect(slots[1].alt).toBe('');
  });

  it('wraps each content image in a matching sentinel pair', () => {
    const { rewritten } = planPage(page, 'pages/about/OurManagement.html');
    expect(rewritten).toContain('<!--vhs:begin ourmanagement.img.1-->');
    expect(rewritten).toContain('<!--vhs:end ourmanagement.img.1-->');
    expect(rewritten).toContain('data-vhs-slot="ourmanagement.img.1"');
  });

  it('leaves chrome and commented images untouched', () => {
    const { rewritten } = planPage(page, 'pages/about/OurManagement.html');
    expect(rewritten).toContain('<img src="../../resources/new.gif" alt="new gif">');
    expect(rewritten).toContain('<!-- <img src="./new.gif" alt="commented"> -->');
    expect(rewritten).not.toContain('data-vhs-slot="ourmanagement.img.3"');
  });

  it('preserves the original src bytes inside the rewritten tag', () => {
    const { rewritten } = planPage(page, 'pages/about/OurManagement.html');
    expect(rewritten).toContain('src="../../resources/management/1.jpeg"');
    expect(rewritten).toContain("src='../../resources/homeslider/School%20(6).jpeg'");
  });

  it('is idempotent — re-running adds no second sentinel layer', () => {
    const once = planPage(page, 'pages/about/OurManagement.html').rewritten;
    const twice = planPage(once, 'pages/about/OurManagement.html').rewritten;
    expect(twice).toBe(once);
  });

  it('preserves case when marking an uppercase <IMG> tag', () => {
    const upperPage = [
      '<body>',
      '  <IMG SRC="../../resources/management/1.jpeg">',
      '</body>',
    ].join('\n');
    const { rewritten } = planPage(upperPage, 'pages/about/OurManagement.html');
    expect(rewritten).toContain('<IMG data-vhs-slot="ourmanagement.img.1" SRC="../../resources/management/1.jpeg">');
  });

  it('names the five pilot pages', () => {
    expect(PILOT_PAGES).toEqual([
      'index.html',
      'pages/about/OurManagement.html',
      'pages/about/OurFounder.html',
      'pages/about/PrincipalMessage.html',
      'pages/about/FIH.html',
    ]);
  });
});
