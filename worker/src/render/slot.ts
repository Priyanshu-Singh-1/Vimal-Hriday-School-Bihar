export type SlotRow = {
  id: string;
  page_path: string;
  label: string;
  optional: number;
  r2_key: string | null;
  original_src: string;
  alt: string;
};

/** Ampersand first, so the entities introduced below are not double-escaped. */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function slotSrc(slot: SlotRow, publicBase: string): string {
  if (!slot.r2_key) return slot.original_src;
  return `${publicBase.replace(/\/+$/, '')}/${slot.r2_key.replace(/^\/+/, '')}`;
}

const SRC_RE = /\bsrc\s*=\s*(["'])([^"']*)\1/i;
const ALT_RE = /\balt\s*=\s*(["'])([^"']*)\1/i;

/**
 * Surgically patch the live tag already in the sentinel region: swap the `src`
 * value and, only if it changed, the `alt` value. Every other byte — attribute
 * order, quoting, spacing, `/>` vs ` />` — is left untouched so an unedited
 * slot renders byte-identical to the seeded page.
 */
export function renderSlotTag(currentTag: string, slot: SlotRow, publicBase: string): string {
  const srcMatch = SRC_RE.exec(currentTag);
  if (!srcMatch) throw new Error(`slot "${slot.id}" has no src attribute`);
  const [full, quote] = srcMatch;
  // Preserve the matched attribute name's own case (e.g. `SRC=`) rather than
  // hardcoding lowercase, since SRC_RE matches case-insensitively.
  const attrName = full.slice(0, full.indexOf('='));
  const newSrc = escapeAttr(slotSrc(slot, publicBase));
  let out =
    currentTag.slice(0, srcMatch.index) +
    `${attrName}=${quote}${newSrc}${quote}` +
    currentTag.slice(srcMatch.index + full.length);

  const altMatch = ALT_RE.exec(out);
  const currentAlt = altMatch ? altMatch[2] : '';
  if (slot.alt !== currentAlt) {
    if (altMatch) {
      out =
        out.slice(0, altMatch.index) +
        `alt=${altMatch[1]}${escapeAttr(slot.alt)}${altMatch[1]}` +
        out.slice(altMatch.index + altMatch[0].length);
    } else {
      // Match case-insensitively and preserve the matched text, since the
      // parser that found this tag is itself case-insensitive.
      out = out.replace(/^<img\b/i, (m) => `${m} alt="${escapeAttr(slot.alt)}"`);
    }
  }
  return out;
}
