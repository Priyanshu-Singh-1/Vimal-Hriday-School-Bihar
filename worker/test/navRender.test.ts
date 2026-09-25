import { describe, expect, it } from 'vitest';
import { renderNavList, type NavMenuItem } from '../src/render/nav';

const INDENT = ' '.repeat(72);
const CLOSE_INDENT = ' '.repeat(64);

describe('renderNavList', () => {
  it('renders an empty menu as a well-formed empty region', () => {
    expect(renderNavList([])).toBe(`\n${CLOSE_INDENT}`);
  });

  it("renders one item with the badge and a new tab, matching the site's existing markup", () => {
    const items: NavMenuItem[] = [
      { label: 'Visiting Hours', href: 'https://drive.example/hours', newTab: true, badge: true },
    ];
    expect(renderNavList(items)).toBe(
      `\n${INDENT}<li><a href="https://drive.example/hours" target="_blank"><img src="resources/new.gif" alt="new gif"> Visiting Hours</a></li>\n${CLOSE_INDENT}`,
    );
  });

  it('omits target="_blank" when newTab is false', () => {
    const items: NavMenuItem[] = [{ label: 'Home', href: 'index.html', newTab: false, badge: false }];
    expect(renderNavList(items)).toBe(`\n${INDENT}<li><a href="index.html">Home</a></li>\n${CLOSE_INDENT}`);
  });

  it('escapes label and address text', () => {
    const items: NavMenuItem[] = [
      { label: 'Fees & Forms <2024>', href: 'https://x/?a=1&b="q"', newTab: false, badge: false },
    ];
    expect(renderNavList(items)).toContain('Fees &amp; Forms &lt;2024&gt;');
    expect(renderNavList(items)).toContain('href="https://x/?a=1&amp;b=&quot;q&quot;"');
  });

  it('renders multiple items on separate lines', () => {
    const items: NavMenuItem[] = [
      { label: 'One', href: 'https://x/1', newTab: true, badge: true },
      { label: 'Two', href: 'https://x/2', newTab: true, badge: true },
    ];
    const out = renderNavList(items);
    expect(out.split('\n')).toHaveLength(4);
  });
});
