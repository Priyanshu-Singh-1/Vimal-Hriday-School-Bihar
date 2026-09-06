import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS_PER_CATEGORY,
  MAX_PHOTOS_PER_BATCH,
  MAX_PHOTOS_PER_EVENT,
  checkEventCount,
  checkPhotoBatch,
} from '../src/lib/galleryLimits';

describe('checkPhotoBatch', () => {
  it('allows a normal batch', () => {
    expect(checkPhotoBatch(0, 10)).toBeNull();
    expect(checkPhotoBatch(70, 8)).toBeNull();
  });

  it('allows exactly the batch cap', () => {
    expect(checkPhotoBatch(0, MAX_PHOTOS_PER_BATCH)).toBeNull();
  });

  it('refuses one over the batch cap and says what to do', () => {
    const r = checkPhotoBatch(0, MAX_PHOTOS_PER_BATCH + 1);
    expect(r?.status).toBe(413);
    expect(r?.error).toContain(`up to ${MAX_PHOTOS_PER_BATCH} photos at a time`);
  });

  it('refuses a folder-sized mis-click', () => {
    expect(checkPhotoBatch(0, 400)?.status).toBe(413);
  });

  it('allows filling an event to exactly its cap', () => {
    expect(checkPhotoBatch(MAX_PHOTOS_PER_EVENT - 5, 5)).toBeNull();
  });

  it('refuses going one over the event cap, naming the room left', () => {
    const r = checkPhotoBatch(MAX_PHOTOS_PER_EVENT - 5, 6);
    expect(r?.status).toBe(409);
    expect(r?.error).toContain('room for 5 more photos');
  });

  it('uses the singular when only one slot is left', () => {
    const r = checkPhotoBatch(MAX_PHOTOS_PER_EVENT - 1, 2);
    expect(r?.error).toContain('room for 1 more photo.');
    expect(r?.error).not.toContain('photos');
  });

  it('refuses a full event and suggests removing some', () => {
    const r = checkPhotoBatch(MAX_PHOTOS_PER_EVENT, 1);
    expect(r?.status).toBe(409);
    expect(r?.error).toContain('remove a few');
  });

  it('rejects a zero or negative count', () => {
    expect(checkPhotoBatch(0, 0)?.status).toBe(400);
    expect(checkPhotoBatch(0, -3)?.status).toBe(400);
  });

  it('rejects a non-integer count', () => {
    expect(checkPhotoBatch(0, 2.5)?.status).toBe(400);
    expect(checkPhotoBatch(0, NaN)?.status).toBe(400);
  });

  it('leaks no status code or field name into the message', () => {
    const messages = [
      checkPhotoBatch(0, 999)?.error,
      checkPhotoBatch(MAX_PHOTOS_PER_EVENT, 1)?.error,
      checkPhotoBatch(0, 0)?.error,
    ];
    for (const m of messages) {
      expect(m).toBeTruthy();
      expect(m).not.toMatch(/\b(400|409|413|r2_key|event_id)\b/);
    }
  });

  it('has headroom over the largest event on the real site (election, 78 photos)', () => {
    expect(checkPhotoBatch(78, MAX_PHOTOS_PER_BATCH)).toBeNull();
  });
});

describe('checkEventCount', () => {
  it('allows adding to a category of a realistic size', () => {
    // The busiest real category lists 12 events.
    expect(checkEventCount(12)).toBeNull();
  });

  it('refuses at the cap', () => {
    const r = checkEventCount(MAX_EVENTS_PER_CATEGORY);
    expect(r?.status).toBe(409);
    expect(r?.error).toContain(`${MAX_EVENTS_PER_CATEGORY} events`);
  });
});
