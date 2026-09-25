#!/usr/bin/env node
/**
 * Wraps the "The School" and "Circulars" navbar dropdowns in sentinel
 * comments on every public page that carries them, so the console (see
 * worker/src/render/nav.ts) can regenerate their contents at publish time.
 *
 * Every other navbar item -- Home, About Us, Gallery, Exam, School Fee --
 * is untouched: no sentinel is added around them, and the console has no
 * way to reach them.
 *
 *   node tools/bin/add-nav-sentinels.mjs            # dry run
 *   node tools/bin/add-nav-sentinels.mjs --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MENUS = [
  { landmark: 'The School<span class="caret">', id: 'nav:the-school' },
  { landmark: 'Circulars<span class="caret">', id: 'nav:circulars' },
];

const UL_OPEN = '<ul class="dropdown-menu">';
const UL_CLOSE = '</ul>';

export class SentinelInsertError extends Error {}

/**
 * Insert both sentinel pairs into `html`. Idempotent: a menu whose sentinel
 * is already present is left alone. Throws if a landmark is present but its
 * dropdown `<ul>` cannot be found, rather than silently skipping it.
 */
export function insertNavSentinels(html) {
  let out = html;
  let changed = false;

  for (const { landmark, id } of MENUS) {
    const begin = `<!--vhs:begin ${id}-->`;
    if (out.includes(begin)) continue; // already done

    const landmarkAt = out.indexOf(landmark);
    if (landmarkAt === -1) continue; // this page has no such dropdown

    const ulStart = out.indexOf(UL_OPEN, landmarkAt);
    if (ulStart === -1) throw new SentinelInsertError(`found "${landmark}" but no following ${UL_OPEN}`);
    const ulEnd = out.indexOf(UL_CLOSE, ulStart);
    if (ulEnd === -1) throw new SentinelInsertError(`found ${UL_OPEN} for "${landmark}" but no closing ${UL_CLOSE}`);

    const openAt = ulStart + UL_OPEN.length;
    out = out.slice(0, openAt) + begin + out.slice(openAt, ulEnd) + `<!--vhs:end ${id}-->` + out.slice(ulEnd);
    changed = true;
  }

  return { html: out, changed };
}

function main() {
  const apply = process.argv.includes('--apply');
  const files = execSync('git ls-files', { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.html'));

  let changed = 0;
  let skipped = 0;
  for (const rel of files) {
    const abs = join(REPO, rel);
    const before = readFileSync(abs, 'utf8');
    if (!before.includes('The School<span class="caret">') && !before.includes('Circulars<span class="caret">')) continue;

    let result;
    try {
      result = insertNavSentinels(before);
    } catch (err) {
      console.error(`  ERROR ${rel}: ${err.message}`);
      continue;
    }
    if (!result.changed) { skipped += 1; continue; }
    changed += 1;
    if (apply) writeFileSync(abs, result.html);
    else console.log(`  would stamp ${rel}`);
  }

  console.log(`\n  ${changed} page(s) ${apply ? 'stamped' : 'to stamp'}, ${skipped} already current`);
  if (!apply) console.log('  dry run — pass --apply to write');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
