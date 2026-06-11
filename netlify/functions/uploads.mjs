/**
 * /.netlify/functions/uploads
 * POST { filename, html } -> stores the file in Netlify Blobs under the
 * `uploads` store, named after a normalized slug, then returns the canonical
 * site descriptor used by the gallery.
 *
 * GET -> returns { sites: [...] } for all currently uploaded files, so the
 * gallery can rebuild the list of uploads on page load.
 *
 * For local dev (netlify dev), Blobs are persisted to .netlify/blobs-local/.
 */
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'uploads';

function slugify(name) {
  return (name || 'untitled')
    .toLowerCase()
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    || 'untitled';
}

function shortId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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

function makeSiteDescriptor(slug, html) {
  const title = (extractTitle(html) || slug).slice(0, 120);
  return {
    slug: `upload-${slug}`,
    title,
    brand: 'UPLOAD',
    year: new Date().getFullYear(),
    tags: ['UPLOAD'],
    url: `/.netlify/functions/uploads?slug=${encodeURIComponent(slug)}`,
    thumb: null,            // filled in by the client with a procedural canvas
    thumbDataUrl: null,     // not used here; kept for parity
    source: 'uploads',
  };
}

function getStoreSafe(context) {
  try {
    // The new @netlify/blobs signature accepts a { name, consistency } options object
    // and reads the siteID/token from environment variables automatically.
    return getStore(STORE_NAME);
  } catch (e) {
    // For local `netlify dev`, the context provides siteID + token via env.
    return getStore({ name: STORE_NAME, ...(context || {}) });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

function notFound() {
  return new Response('Not found', { status: 404 });
}

export default async (req, context) => {
  const url = new URL(req.url);

  // Serve an uploaded file directly (used as iframe src)
  if (req.method === 'GET' && url.searchParams.has('slug')) {
    const slug = url.searchParams.get('slug');
    const store = getStoreSafe(context);
    try {
      const html = await store.get(slug, { type: 'text' });
      return htmlResponse(html);
    } catch (e) {
      return notFound();
    }
  }

  // List all uploaded files
  if (req.method === 'GET') {
    const store = getStoreSafe(context);
    const { blobs } = await store.list();
    const sites = [];
    for (const b of blobs) {
      const slug = b.key;
      try {
        const html = await store.get(slug, { type: 'text' });
        sites.push(makeSiteDescriptor(slug, html));
      } catch (_) {
        // skip entries we can't read
      }
    }
    return jsonResponse(200, { sites });
  }

  // Upload
  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }
    const filename = String(body.filename || '').trim();
    const html = String(body.html || '');
    if (!filename || !html) {
      return jsonResponse(400, { error: 'filename and html are required' });
    }
    if (html.length > 5_000_000) {
      return jsonResponse(413, { error: 'File too large (5MB max)' });
    }
    const store = getStoreSafe(context);
    // Disambiguate: if the normalized slug is already in use, append a short
    // suffix so a second `index.html` doesn't silently overwrite the first.
    const base = slugify(filename);
    let slug = base;
    try {
      const existing = await store.get(base, { type: 'text' });
      if (existing != null) slug = `${base}-${shortId()}`;
    } catch (_) {
      // not present -> use base
    }
    await store.set(slug, html);
    return jsonResponse(201, makeSiteDescriptor(slug, html));
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
