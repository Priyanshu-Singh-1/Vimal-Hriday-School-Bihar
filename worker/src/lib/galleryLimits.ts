/**
 * Caps on gallery growth.
 *
 * These exist because a bulk selection is the normal way someone adds an
 * event's photos: the console uploads them one at a time, so without a cap a
 * mis-click on a 400-file folder would run for minutes, fill R2, and produce a
 * category region so large that the publish diff is unreadable.
 *
 * Sized against the real pages rather than guessed: the largest existing event
 * is election.html at 78 photos, and the busiest category lists 12 events.
 */

/** One event's total photos. Roughly double the largest event on the site. */
export const MAX_PHOTOS_PER_EVENT = 150;

/**
 * Photos that may be attached in a single request. Bounds the work one call
 * can do; the console uploads a larger selection in successive batches so the
 * person keeps seeing progress.
 */
export const MAX_PHOTOS_PER_BATCH = 25;

/** Events in one category, bounding the size of a category page's region. */
export const MAX_EVENTS_PER_CATEGORY = 100;

export type BatchRefusal = { error: string; status: 400 | 409 | 413 };

/**
 * Whether `incoming` more photos may be attached to an event that already has
 * `existing`. Returns null when allowed.
 *
 * The messages are plain English because they surface directly in the console;
 * no status code or field name reaches the person reading them.
 */
export function checkPhotoBatch(existing: number, incoming: number): BatchRefusal | null {
  if (!Number.isInteger(incoming) || incoming < 1) {
    return { error: 'Please choose at least one photo.', status: 400 };
  }

  if (incoming > MAX_PHOTOS_PER_BATCH) {
    return {
      error:
        `You can add up to ${MAX_PHOTOS_PER_BATCH} photos at a time. ` +
        `Please add the first ${MAX_PHOTOS_PER_BATCH}, then add the rest.`,
      status: 413,
    };
  }

  const remaining = MAX_PHOTOS_PER_EVENT - existing;
  if (remaining <= 0) {
    return {
      error:
        `This event already has the most photos we allow (${MAX_PHOTOS_PER_EVENT}). ` +
        'Please remove a few before adding more.',
      status: 409,
    };
  }

  if (incoming > remaining) {
    return {
      error:
        `This event has room for ${remaining} more photo${remaining === 1 ? '' : 's'}. ` +
        `Please choose ${remaining} or fewer.`,
      status: 409,
    };
  }

  return null;
}

/** Whether another event may be added to a category. Null when allowed. */
export function checkEventCount(existing: number): BatchRefusal | null {
  if (existing >= MAX_EVENTS_PER_CATEGORY) {
    return {
      error:
        `This part of the gallery already has ${MAX_EVENTS_PER_CATEGORY} events, ` +
        'which is the most we allow. Please remove one before adding another.',
      status: 409,
    };
  }
  return null;
}
