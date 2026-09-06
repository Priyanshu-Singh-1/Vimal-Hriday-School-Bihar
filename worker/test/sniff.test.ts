import { describe, it, expect } from 'vitest';
import { sniffImage, extFor } from '../src/lib/sniff';

const bytes = (...b: number[]) => new Uint8Array(b);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0);

describe('sniffImage', () => {
  it('detects the three allowed formats', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(WEBP)).toBe('image/webp');
  });
  it('rejects GIF, which is not on the allow-list', () => {
    expect(sniffImage(GIF)).toBeNull();
  });
  it('rejects a text file renamed to .jpg', () => {
    expect(sniffImage(new TextEncoder().encode('<?php echo 1; ?>    '))).toBeNull();
  });
  it('rejects a buffer too short to identify', () => {
    expect(sniffImage(bytes(0xff, 0xd8))).toBeNull();
  });
  it('rejects RIFF that is not WEBP', () => {
    expect(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20))).toBeNull();
  });
});

describe('extFor', () => {
  it('maps each allowed mime to an extension', () => {
    expect(extFor('image/webp')).toBe('webp');
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/png')).toBe('png');
  });
});
