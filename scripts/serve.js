#!/usr/bin/env node
/**
 * A tiny static server. No build step, no dependencies - the app is plain ES
 * modules behind an import map, so any static server works. This one exists so
 * `npm run serve` does something sensible.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const target = path.join(root, urlPath === '/' ? 'index.html' : urlPath);

  if (!target.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(target)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
});

server.listen(port, () => {
  console.log(`GestureVerse running at http://localhost:${port}`);
  console.log('Camera access needs localhost or https - both are fine here.');
});
