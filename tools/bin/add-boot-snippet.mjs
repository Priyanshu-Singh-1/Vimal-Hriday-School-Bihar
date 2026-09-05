#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT_PAGES } from './seed-pilot-slots.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKER = 'vhs-admin-boot';

function snippet(depth) {
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  return `
<!-- ${MARKER}: injects the editor only for a signed-in admin; a visitor downloads nothing more -->
<script>
(function(){
  try {
    if (!sessionStorage.getItem('vhs_admin_token')) return;
    var s = document.createElement('script');
    s.src = '${prefix}js/admin/editor.v1.js';
    s.defer = true;
    document.body.appendChild(s);
  } catch (e) {}
})();
</script>
`;
}

const apply = process.argv.includes('--apply');

for (const page of PILOT_PAGES) {
  const abs = join(REPO, page);
  const html = readFileSync(abs, 'utf8');
  if (html.includes(MARKER)) { console.log(`${page}: already present`); continue; }

  const idx = html.lastIndexOf('</body>');
  if (idx === -1) { console.error(`${page}: no </body> found — skipped`); continue; }

  const depth = page.split('/').length - 1;
  const out = html.slice(0, idx) + snippet(depth) + html.slice(idx);
  console.log(`${page}: inserting snippet (depth ${depth})`);
  if (apply) writeFileSync(abs, out);
}

if (!apply) console.log('\n--- dry run; pass --apply to write ---');
