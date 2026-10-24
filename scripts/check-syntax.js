/**
 * GestureVerse - syntax check.
 *
 * Parses every source and test module with Node's own parser. Catches typos
 * and broken imports-in-shape without needing a browser or bundler.
 *
 *   node scripts/check-syntax.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'tests', 'scripts'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = DIRS.flatMap((d) => {
  const full = path.join(ROOT, d);
  return fs.existsSync(full) ? walk(full) : [];
});

let failures = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures++;
    console.error(`FAIL  ${path.relative(ROOT, file)}`);
    console.error(String(err.stderr || err.message).trim());
  }
}

console.log(`Checked ${files.length} file(s); ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
