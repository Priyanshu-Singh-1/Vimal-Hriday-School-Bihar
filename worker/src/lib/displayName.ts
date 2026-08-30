/**
 * Human-facing name for a user: their stored `display_name`, or their
 * `username` when none was set — an older row (backfilled to the username by
 * migration 0004) or a blank string.
 */
export function resolveDisplayName(displayName: string | null | undefined, username: string): string {
  return displayName && displayName.length > 0 ? displayName : username;
}
