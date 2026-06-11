#!/usr/bin/env node
/**
 * copy-sites.mjs
 * Copies all .html files from the source websites folder into public/sites/
 * with normalized slugs. Filenames are sanitized to URL-safe strings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = '/Users/beurre/Desktop/Websites';
const DEST = path.join(ROOT, 'public', 'sites');

const SKIP_FILES = new Set([
  // Generic duplicate or low-value filenames: keep but de-prioritize later if needed
]);

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    || 'untitled';
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[copy-sites] Source folder not found: ${SRC}`);
    process.exit(1);
  }
  fs.mkdirSync(DEST, { recursive: true });

  const files = fs.readdirSync(SRC).filter(f => f.toLowerCase().endsWith('.html'));
  const seen = new Map(); // slug -> count
  let copied = 0;

  for (const file of files) {
    if (SKIP_FILES.has(file)) continue;
    const srcPath = path.join(SRC, file);
    const stat = fs.statSync(srcPath);
    if (!stat.isFile()) continue;

    let base = slugify(file);
    let slug = base;
    if (seen.has(base)) {
      const n = seen.get(base) + 1;
      seen.set(base, n);
      slug = `${base}-${n}`;
    } else {
      seen.set(base, 1);
    }
    const destPath = path.join(DEST, `${slug}.html`);
    fs.copyFileSync(srcPath, destPath);
    copied++;
  }

  console.log(`[copy-sites] copied ${copied} html files -> public/sites/`);
}

main();
