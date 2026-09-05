import { describe, it, expect } from 'vitest';
import { resolveDisplayName } from '../src/lib/displayName';

describe('resolveDisplayName', () => {
  it('returns the display name when set', () => {
    expect(resolveDisplayName('Sister Anita', 'sanita')).toBe('Sister Anita');
  });

  it('falls back to the username when display_name is null', () => {
    expect(resolveDisplayName(null, 'sanita')).toBe('sanita');
  });

  it('falls back to the username when display_name is undefined', () => {
    expect(resolveDisplayName(undefined, 'sanita')).toBe('sanita');
  });

  it('falls back to the username when display_name is an empty string', () => {
    expect(resolveDisplayName('', 'sanita')).toBe('sanita');
  });
});
