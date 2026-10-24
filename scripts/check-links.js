/**
 * GestureVerse - static reference check.
 *
 * Walks every ES module and HTML/CSS asset and verifies that every relative
 * import and every `id` referenced from JavaScript actually exists. Catches
 * the two failure modes that a syntax check cannot: a moved file, and a
 * renamed DOM id.
 *
 *   node scripts/check-links.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const problems = [];

/* --- 1. every relative import resolves ------------------------------- */
const jsFiles = walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'tests')));

for (const file of jsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(source)) !== null) {
    const spec = m[1];
    const resolved = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(resolved)) {
      problems.push(`${path.relative(ROOT, file)} imports missing module: ${spec}`);
    }
  }
}

/* --- 2. every getElementById target exists in index.html ------------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));

for (const file of jsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!htmlIds.has(m[1])) {
      problems.push(`${path.relative(ROOT, file)} references missing element id: #${m[1]}`);
    }
  }
  for (const m of source.matchAll(/querySelectorAll\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const sel = m[1];
    const idMatch = sel.match(/^#([\w-]+)/);
    if (idMatch && !htmlIds.has(idMatch[1])) {
      problems.push(`${path.relative(ROOT, file)} querySelectorAll targets missing id: #${idMatch[1]}`);
    }
  }
}

/* --- 3. the HTML's own asset references exist ------------------------ */
for (const m of html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)) {
  const resolved = path.join(ROOT, m[1]);
  if (!fs.existsSync(resolved)) {
    problems.push(`index.html references missing asset: ${m[1]}`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL  ${p}`);
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}

console.log(
  `Checked ${jsFiles.length} module(s) and ${htmlIds.size} element id(s); no broken references.`,
);
