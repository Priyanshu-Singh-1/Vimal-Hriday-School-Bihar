import { describe, it, expect } from 'vitest';
import { insertNavSentinels, SentinelInsertError } from '../bin/add-nav-sentinels.mjs';

const PAGE = `
<li class="dropdown">
  <a href="#" class="dropdown-toggle">The School<span class="caret"></span></a>
  <ul class="dropdown-menu">
    <li><a href="a">One</a></li>
  </ul>
</li>
<li class="dropdown">
  <a href="#" class="dropdown-toggle">Circulars<span class="caret"></span></a>
  <ul class="dropdown-menu">
    <li><a href="b">Two</a></li>
  </ul>
</li>
`;

describe('insertNavSentinels', () => {
  it('wraps both dropdowns', () => {
    const { html, changed } = insertNavSentinels(PAGE);
    expect(changed).toBe(true);
    expect(html).toContain('<ul class="dropdown-menu"><!--vhs:begin nav:the-school-->');
    expect(html).toContain('<!--vhs:end nav:the-school--></ul>');
    expect(html).toContain('<ul class="dropdown-menu"><!--vhs:begin nav:circulars-->');
    expect(html).toContain('<!--vhs:end nav:circulars--></ul>');
  });

  it('is idempotent', () => {
    const once = insertNavSentinels(PAGE).html;
    const twice = insertNavSentinels(once);
    expect(twice.changed).toBe(false);
    expect(twice.html).toBe(once);
  });

  it('leaves a page with neither dropdown untouched', () => {
    const { html, changed } = insertNavSentinels('<p>no nav here</p>');
    expect(changed).toBe(false);
    expect(html).toBe('<p>no nav here</p>');
  });

  it('throws if a landmark has no following <ul>', () => {
    expect(() => insertNavSentinels('The School<span class="caret"></span>')).toThrow(SentinelInsertError);
  });
});
