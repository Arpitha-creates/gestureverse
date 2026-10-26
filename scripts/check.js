#!/usr/bin/env node
/**
 * Static sanity checks that catch the class of bug a browser would otherwise
 * have to reveal: broken import paths, stray bare specifiers, and DOM ids the
 * code asks for that the HTML does not contain.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const notes = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const IMPORT_MAP = new Set(['three', '@mediapipe/tasks-vision']);
const jsFiles = walk(path.join(root, 'src'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);

  const specifiers = [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specifiers) {
    if (spec.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(resolved)) errors.push(`${rel}: cannot resolve "${spec}"`);
    } else if (!IMPORT_MAP.has(spec)) {
      errors.push(`${rel}: bare specifier "${spec}" is not in the import map`);
    }
  }

  for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const id = m[1];
    if (!new RegExp(`id=["']${id}["']`).test(html)) {
      errors.push(`${rel}: getElementById("${id}") has no matching element in index.html`);
    }
  }

  for (const m of src.matchAll(/dataset\.mode\s*===\s*['"]([^'"]+)['"]/g)) {
    if (!['draw', 'play'].includes(m[1])) errors.push(`${rel}: unknown mode "${m[1]}"`);
  }
}

for (const m of html.matchAll(/(?:href|src)=["']\.\/([^"']+)["']/g)) {
  if (!fs.existsSync(path.join(root, m[1]))) errors.push(`index.html references missing file "${m[1]}"`);
}

for (const id of ['camera', 'scene', 'overlay', 'start-screen', 'state-badge', 'toast', 'guide', 'palette', 'brushes']) {
  if (!new RegExp(`id=["']${id}["']`).test(html)) errors.push(`index.html is missing #${id}`);
}

const uiSource = fs.readFileSync(path.join(root, 'src/ui/ui.js'), 'utf8');
const uiIds = [...uiSource.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
notes.push(`checked ${jsFiles.length} modules, ${uiIds.length} DOM lookups`);

if (errors.length) {
  console.error('FAILED');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('All static checks passed');
for (const n of notes) console.log('  ' + n);
