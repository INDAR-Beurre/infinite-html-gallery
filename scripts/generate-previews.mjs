#!/usr/bin/env node
/**
 * generate-previews.mjs
 * Launches system Chrome via puppeteer-core, spins up a tiny static server
 * for public/sites/, and screenshots every HTML file in parallel into
 * public/thumbs/<slug>.png at 512x720.
 *
 * Usage:  node scripts/generate-previews.mjs [--concurrency=4] [--width=512] [--height=720]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITES_DIR = path.join(ROOT, 'public', 'sites');
const THUMBS_DIR = path.join(ROOT, 'public', 'thumbs');
const STATIC_ROOT = path.join(ROOT, 'public');

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const CONCURRENCY = Number(args.concurrency ?? 4);
const WIDTH = Number(args.width ?? 512);
const HEIGHT = Number(args.height ?? 720);
const TIMEOUT_MS = Number(args.timeout ?? 12000);

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chrome/Chromium binary found in standard locations');
}

// MIME lookup
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const safe = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
        let filePath = path.join(STATIC_ROOT, safe);
        if (!filePath.startsWith(STATIC_ROOT)) {
          res.statusCode = 403; return res.end('forbidden');
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404; return res.end('not found');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        fs.createReadStream(filePath).pipe(res);
      } catch (e) {
        res.statusCode = 500; res.end(String(e));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function screenshotOne(browser, port, file) {
  const slug = file.replace(/\.html$/i, '');
  const url = `http://127.0.0.1:${port}/sites/${encodeURIComponent(file)}`;
  const outPath = path.join(THUMBS_DIR, `${slug}.png`);
  if (fs.existsSync(outPath)) return { slug, status: 'skipped' };

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });
  } catch {
    // Fall back to domcontentloaded for sites that never go idle (long-polling, etc.)
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS }); } catch {}
  }
  // small extra settle for fonts/animations
  await new Promise(r => setTimeout(r, 600));
  try {
    await page.screenshot({ path: outPath, type: 'png', omitBackground: false });
  } catch (e) {
    return { slug, status: 'fail', error: String(e) };
  } finally {
    await page.close().catch(() => {});
  }
  return { slug, status: 'ok' };
}

async function runPool(items, worker) {
  const results = [];
  let i = 0;
  const total = items.length;
  const log = () => {
    process.stdout.write(`\r[previews] ${results.length}/${total} done`);
  };
  const next = async () => {
    const idx = i++;
    if (idx >= items.length) return;
    const item = items[idx];
    const r = await worker(item);
    results.push(r);
    log();
    return next();
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, next);
  await Promise.all(workers);
  process.stdout.write('\n');
  return results;
}

async function main() {
  if (!fs.existsSync(SITES_DIR)) {
    console.error(`[previews] missing ${SITES_DIR} (run copy-sites first)`);
    process.exit(1);
  }
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  const files = fs.readdirSync(SITES_DIR).filter(f => f.toLowerCase().endsWith('.html')).sort();
  if (files.length === 0) {
    console.error('[previews] no html files found in public/sites/');
    process.exit(1);
  }

  const chromePath = findChrome();
  const { server, port } = await startServer();
  console.log(`[previews] static server on http://127.0.0.1:${port}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
    ],
  });

  const t0 = Date.now();
  const results = await runPool(files, (f) => screenshotOne(browser, port, f));
  await browser.close();
  server.close();

  const counts = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[previews] done in ${elapsed}s  ok=${counts.ok || 0}  skipped=${counts.skipped || 0}  fail=${counts.fail || 0}`);
  if (counts.fail) {
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`  - ${r.slug}: ${r.error}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
