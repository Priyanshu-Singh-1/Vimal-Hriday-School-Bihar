#!/usr/bin/env node
/**
 * Makes the copyright year self-updating.
 *
 * The site is static with no build step, so the year cannot be rendered
 * server-side. Instead the number is wrapped in a `<span class="vhs-year">`
 * whose text a one-line script replaces with the current year on load.
 *
 * The span keeps a real year as its content rather than being empty, so a
 * visitor with JavaScript off — or a crawler that does not run it — still sees
 * a sensible year instead of "Copyright ©  School". Re-run this after a few
 * years to refresh that fallback; the live page needs no help.
 *
 * Idempotent: a page already carrying the span is only updated if the fallback
 * year has moved on.
 *
 *   node tools/bin/stamp-year.mjs            # dry run
 *   node tools/bin/stamp-year.mjs --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One statement, ES5, no dependencies — these pages predate anything modern. */
export const SCRIPT =
  '<script>(function(){var e=document.getElementsByClassName("vhs-year"),' +
  'y=new Date().getFullYear(),i;for(i=0;i<e.length;i++)e[i].textContent=y;})();</script>';

/**
 * Left alone deliberately: this page carries a previous developer's credit
 * ("Design by Global Infinite Technologies"), not ours, and nothing links to
 * it. Rewriting someone else's attribution is not this script's business.
 */
const SKIP = new Set(['pages/curriculum/sample_index.html']);

const YEAR_RE = /Copyright\s*(?:©|&copy;)\s*(\d{4})/;
const SPAN_RE = /Copyright\s*(?:©|&copy;)\s*<span class="vhs-year">(\d{4})<\/span>/;

export function stamp(html, year) {
  const already = SPAN_RE.exec(html);
  if (already) {
    // Only the fallback needs refreshing.
    if (already[1] === String(year)) return { html, changed: false };
    return {
      html: html.replace(SPAN_RE, (m) => m.replace(/>\d{4}</, `>${year}<`)),
      changed: true,
    };
  }

  const m = YEAR_RE.exec(html);
  if (!m) return { html, changed: false };

  let out = html.replace(
    YEAR_RE,
    (full, y) => full.replace(y, `<span class="vhs-year">${year}</span>`),
  );

  // Put the script straight after the paragraph that holds the year, so the
  // element always exists by the time it runs — no DOMContentLoaded needed.
  if (!out.includes('getElementsByClassName("vhs-year")')) {
    const at = out.indexOf('</p>', out.indexOf('class="vhs-year"'));
    if (at === -1) return { html, changed: false };
    const end = at + '</p>'.length;
    out = out.slice(0, end) + '\n' + SCRIPT + out.slice(end);
  }
  return { html: out, changed: true };
}

function main() {
  const apply = process.argv.includes('--apply');
  const year = new Date().getFullYear();
  const files = execSync('git ls-files', { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.html'));

  let changed = 0;
  let skipped = 0;
  for (const rel of files) {
    if (SKIP.has(rel)) { console.log(`  skipping ${rel} (another developer's credit)`); continue; }
    const abs = join(REPO, rel);
    const before = readFileSync(abs, 'utf8');
    const { html, changed: did } = stamp(before, year);
    if (!did) {
      if (YEAR_RE.test(before) || SPAN_RE.test(before)) skipped += 1;
      continue;
    }
    changed += 1;
    if (apply) writeFileSync(abs, html);
    else console.log(`  would stamp ${rel}`);
  }

  console.log(`\n  fallback year: ${year}`);
  console.log(`  ${changed} page(s) ${apply ? 'stamped' : 'to stamp'}, ${skipped} already current`);
  if (!apply) console.log('  dry run — pass --apply to write');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
