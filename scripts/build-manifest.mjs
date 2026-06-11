#!/usr/bin/env node
/**
 * build-manifest.mjs
 * Parses every .html file in public/sites/ and emits public/manifest.json
 * with { slug, title, source } for each. Title is read from <title> first,
 * then from the first <h1>, then falls back to the slug.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITES_DIR = path.join(ROOT, 'public', 'sites');
const OUT = path.join(ROOT, 'public', 'manifest.json');

function extractTitle(html) {
  const m1 = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m1) {
    const t = m1[1].trim().replace(/\s+/g, ' ');
    if (t) return t;
  }
  const m2 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m2) {
    const t = m2[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
    if (t) return t;
  }
  return null;
}

function main() {
  if (!fs.existsSync(SITES_DIR)) {
    console.error(`[build-manifest] missing ${SITES_DIR} (run copy-sites first)`);
    process.exit(1);
  }
  const files = fs.readdirSync(SITES_DIR).filter(f => f.toLowerCase().endsWith('.html')).sort();
  const items = [];
  for (const file of files) {
    const slug = file.replace(/\.html$/i, '');
    const html = fs.readFileSync(path.join(SITES_DIR, file), 'utf8');
    const title = extractTitle(html) || slug;
    items.push({
      slug,
      title: title.slice(0, 120),
      url: `/sites/${file}`,
      thumb: `/thumbs/${slug}.png`,
      source: 'sites',
    });
  }
  fs.writeFileSync(OUT, JSON.stringify({ sites: items, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`[build-manifest] wrote ${items.length} entries -> public/manifest.json`);
}

main();
