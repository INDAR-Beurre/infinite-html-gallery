/**
 * gallery.js
 * Three.js infinite spherical gallery.
 * - 16 x 8 grid of cards arranged on a sphere band, all facing the camera at origin.
 * - Free Y rotation (wraps), gentle clamp on X tilt.
 * - Idle drift when user isn't interacting.
 * - Card textures: real PNG thumbnails for static sites, procedural gradient
 *   canvases for runtime uploads (which arrive as data URLs).
 * - clickCard() returns the site payload so the caller can drive the viewer.
 */
import * as THREE from 'three';
import { gsap } from 'gsap';

const COLS = 16;
const ROWS_BASE = 8;
const ROWS_MAX = 22;
const RADIUS = 880;
const CARD_W = 220;
const CARD_H = 308;
const PHI_MIN_BASE = Math.PI * 0.30;
const PHI_MAX_BASE = Math.PI * 0.70;
const MAX_ANISO = 8;

const EASE = 0.085;
const DRAG_K = 0.0036;
const WHEEL_K = 0.0009;
const FRICTION = 0.93;
const TILT_LIMIT = 0.85;
const IDLE_DRIFT = 0.00045; // rad/frame, ~0.026 rad/sec at 60fps

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------------- Procedural thumbnail (for uploads) ---------------- */

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(/\s+/);
  let line = '';
  const lines = [];
  for (let n = 0; n < words.length; n++) {
    const test = line ? line + ' ' + words[n] : words[n];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = words[n];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  // vertically center around y
  const totalH = lines.length * lineHeight;
  const startY = y - totalH / 2 + lineHeight / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}

function makeProceduralCanvas({ title, brand, year, tags }) {
  const W = 512, H = 720;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  const h = hashString((title || brand || 'untitled') + '|' + (year || ''));
  const hue1 = h % 360;
  const hue2 = (hue1 + 60 + (h % 47)) % 360;
  const hue3 = (hue1 + 200 + (h % 31)) % 360;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${hue1}, 45%, 14%)`);
  grad.addColorStop(0.5, `hsl(${hue2}, 40%, 10%)`);
  grad.addColorStop(1, `hsl(${hue3}, 55%, 8%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid overlay
  ctx.strokeStyle = `hsla(${hue1}, 70%, 70%, 0.06)`;
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Glowing accent circle
  const cx = W * (0.25 + ((h >> 3) % 50) / 100);
  const cy = H * (0.35 + ((h >> 5) % 30) / 100);
  const r = 220 + (h % 80);
  const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  radGrad.addColorStop(0, `hsla(${hue2}, 80%, 60%, 0.28)`);
  radGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, W, H);

  // Header text
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '500 18px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(brand || 'UPLOAD', 24, 38);
  ctx.textAlign = 'right';
  ctx.font = '500 14px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(year || 'NEW', W - 24, 38);

  // Title
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = '600 36px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  wrapText(ctx, (title || 'Untitled').slice(0, 60), W / 2, H / 2 - 30, W - 80, 42);

  // Tags
  if (tags && tags.length) {
    ctx.font = '500 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const tagText = tags.slice(0, 3).join(' · ').toUpperCase();
    ctx.fillText(tagText, W / 2, H / 2 + 60);
  }

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '500 12px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('UPLOADED', 24, H - 24);

  return cv;
}

/* ---------------- Gallery class ---------------- */

export class Gallery {
  constructor(canvas, { onCardClick } = {}) {
    this.canvas = canvas;
    this.onCardClick = onCardClick;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.setClearColor(0x070708, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x070708, 700, 1600);

    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 5000);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.meshes = [];
    this.originals = [];
    this.sites = []; // list of { slug, title, brand, year, tags, url, thumb, source }

    this.textureLoader = new THREE.TextureLoader();
    this.textureLoader.crossOrigin = 'anonymous';
    this._textureCache = new Map(); // slug -> CanvasTexture, shared across duplicate meshes

    this.drag = {
      active: false,
      pointerId: null,
      x: 0, y: 0,
      moved: 0,
      rotX: 0, rotY: 0,
      tRotX: 0, tRotY: 0,
      vX: 0, vY: 0,
      locked: false,
      hadInteraction: false,
    };

    this._bindEvents();
    this._tick = this._tick.bind(this);
    this._tick();
  }

  _bindEvents() {
    const { canvas } = this;
    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    const end = (e) => this._onUp(e);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    window.addEventListener('wheel', (e) => this._onWheel(e), { passive: true });
    window.addEventListener('resize', () => this._onResize());
  }

  _onDown(e) {
    if (this.drag.locked) return;
    this.drag.active = true;
    this.drag.pointerId = e.pointerId;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.drag.moved = 0;
    this.drag.vX = 0;
    this.drag.vY = 0;
    this.canvas.classList.add('dragging');
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (!this.drag.hadInteraction) {
      this.drag.hadInteraction = true;
      const hint = document.getElementById('hint');
      if (hint) hint.classList.add('hide');
    }
  }

  _onMove(e) {
    if (!this.drag.active) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;

    this.drag.tRotY += dx * DRAG_K;
    this.drag.tRotX -= dy * DRAG_K;
    this.drag.tRotX = clamp(this.drag.tRotX, -TILT_LIMIT, TILT_LIMIT);

    this.drag.vY = dx * DRAG_K;
    this.drag.vX = -dy * DRAG_K;
    this.drag.moved += Math.hypot(dx, dy);
  }

  _onUp(e) {
    if (!this.drag.active) return;
    this.drag.active = false;
    if (this.drag.pointerId != null) {
      try { this.canvas.releasePointerCapture(this.drag.pointerId); } catch (_) {}
      this.drag.pointerId = null;
    }
    this.canvas.classList.remove('dragging');
    if (this.drag.moved < 6 && e && e.type === 'pointerup') {
      this._handleClick(e);
    }
  }

  _onWheel(e) {
    if (this.drag.locked) return;
    this.drag.tRotX -= e.deltaY * WHEEL_K;
    this.drag.tRotX = clamp(this.drag.tRotX, -TILT_LIMIT, TILT_LIMIT);
    if (!this.drag.hadInteraction) {
      this.drag.hadInteraction = true;
      const hint = document.getElementById('hint');
      if (hint) hint.classList.add('hide');
    }
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  /* ---------------- Raycast click ---------------- */

  _handleClick(e) {
    if (this.drag.locked) return;
    const ndc = new THREE.Vector2(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.meshes, false);
    if (hits.length) {
      const mesh = hits[0].object;
      const site = mesh.userData.site;
      const titleEl = document.getElementById('vTitle');
      const brandEl = document.getElementById('vBrand');
      if (titleEl) titleEl.textContent = site.title || site.slug;
      if (brandEl) brandEl.textContent = site.brand || (site.source === 'uploads' ? 'UPLOAD' : 'PROJECT');
      this._zoomToCard(mesh, () => {
        if (typeof this.onCardClick === 'function') this.onCardClick(site);
      });
    }
  }

  /* ---------------- Animate card forward before viewer opens ---------------- */

  _zoomToCard(mesh, done) {
    this.drag.locked = true;
    const dir = mesh.position.clone().normalize();
    const target = dir.multiplyScalar(220);
    const tl = gsap.timeline({ onComplete: () => done && done() });
    tl.to(mesh.position, { x: target.x, y: target.y, z: target.z, duration: 0.9, ease: 'power3.inOut' }, 0);
    tl.to(mesh.scale, { x: 1.55, y: 1.55, z: 1.55, duration: 0.9, ease: 'power3.inOut' }, 0);
    this.meshes.forEach(m => {
      if (m !== mesh) tl.to(m.material, { opacity: 0, duration: 0.4, ease: 'power2.out' }, 0);
    });
    tl.to('#ui', { opacity: 0, duration: 0.3 }, 0);
  }

  /* ---------------- Build the sphere of cards ---------------- */

  setSites(sites) {
    this.sites = sites.slice();
    this._textureCache.clear();
    this._rebuildMeshes();
  }

  _rowsFor(n) {
    // We need at least ceil(n / COLS) rows to show every site at least once.
    // Beyond ROWS_MAX we still cap (to keep the band from swallowing the poles)
    // and accept that the most-recent uploads get a slight visual bias; the
    // modulo in _addMesh keeps all sites represented as best it can.
    return Math.min(ROWS_MAX, Math.max(ROWS_BASE, Math.ceil(n / COLS)));
  }

  _phiBandFor(rows) {
    // Widen the band as we add rows so cards don't pinch near the poles.
    const t = Math.max(0, (rows - 8) / (ROWS_MAX - 8));
    const min = THREE.MathUtils.lerp(PHI_MIN_BASE, Math.PI * 0.20, t);
    const max = THREE.MathUtils.lerp(PHI_MAX_BASE, Math.PI * 0.80, t);
    return [min, max];
  }

  addSites(newSites) {
    if (!newSites || newSites.length === 0) return;
    this.sites = this.sites.concat(newSites);
    const targetRows = this._rowsFor(this.sites.length);
    const targetSlots = COLS * targetRows;
    if (this.meshes.length < targetSlots && this.meshes.length < this._rowsFor(this.sites.length - newSites.length) * COLS) {
      // Cheap path: existing slot count already covers everything
    }
    if (this.sites.length > this.meshes.length) {
      // Not every site has a card -> rebuild with enough rows.
      this._rebuildMeshes();
    } else if (this.meshes.length < targetSlots) {
      this._appendMeshes();
    }
  }

  _rebuildMeshes() {
    // Dispose GPU resources for every cached texture before dropping refs.
    for (const tex of this._textureCache.values()) tex.dispose();
    this.meshes.forEach(m => {
      this.group.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    });
    this.meshes = [];
    this.originals = [];
    this._textureCache.clear();

    const N = this.sites.length;
    if (N === 0) return;

    const rows = this._rowsFor(N);
    const totalSlots = COLS * rows;

    for (let i = 0; i < totalSlots; i++) {
      const site = this.sites[i % N];
      this._addMesh(site, i, totalSlots, rows);
    }
  }

  _appendMeshes() {
    const N = this.sites.length;
    if (N === 0) return;
    const existing = this.meshes.length;
    const rows = this._rowsFor(N);
    const totalSlots = COLS * rows;

    let i = existing;
    while (i < totalSlots) {
      const site = this.sites[i % N];
      this._addMesh(site, i, totalSlots, rows);
      i++;
    }
  }

  _addMesh(site, i, totalSlots, rows) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);

    // Add a tiny longitudinal jitter so wrapped repeats don't overlap pixel-perfectly
    const jitter = ((i * 13) % 7) * 0.0006;
    const theta = (col / COLS) * Math.PI * 2 + jitter;
    const tRows = Math.max(1, rows - 1);
    const [phiMin, phiMax] = this._phiBandFor(rows);
    const phi = THREE.MathUtils.lerp(phiMin, phiMax, row / tRows);

    const x =  RADIUS * Math.sin(phi) * Math.sin(theta);
    const y =  RADIUS * Math.cos(phi);
    const z = -RADIUS * Math.sin(phi) * Math.cos(theta);

    const tex = this._buildTexture(site);
    const geom = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    mesh.userData = { site, index: i };
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.originals.push({
      position: mesh.position.clone(),
      quaternion: mesh.quaternion.clone(),
      scale: mesh.scale.clone(),
    });
  }

  _buildTexture(site) {
    // Share a single CanvasTexture across duplicate meshes (same site slug).
    const key = site.slug;
    if (this._textureCache.has(key)) return this._textureCache.get(key);
    // Build via canvas so we can do real thumbnails + procedural uploads uniformly
    const cv = this._drawCardCanvas(site);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = MAX_ANISO;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    this._textureCache.set(key, tex);
    return tex;
  }

  _drawCardCanvas(site) {
    const W = 512, H = 720;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    // Background image (or procedural fill)
    if (site.thumbDataUrl) {
      // Paint procedural base + overlay immediately so the card isn't empty
      // while the real image streams in.
      this._drawProcedural(ctx, W, H, site);
      this._drawCardOverlay(ctx, W, H, site);
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        if (!iw || !ih) return;
        ctx.clearRect(0, 0, W, H);
        const sa = iw / ih, ta = W / H;
        let sx, sy, sw, sh;
        if (sa > ta) { sh = ih; sw = ih * ta; sx = (iw - sw) / 2; sy = 0; }
        else { sw = iw; sh = iw / ta; sx = 0; sy = (ih - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        this._drawCardOverlay(ctx, W, H, site);
        this._notifyTextureUpdate(site);
      };
      img.onerror = () => this._notifyTextureUpdate(site);
      img.src = site.thumbDataUrl;
    } else if (site.thumbUrl) {
      this._drawProcedural(ctx, W, H, site);
      this._drawCardOverlay(ctx, W, H, site);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        if (!iw || !ih) return;
        ctx.clearRect(0, 0, W, H);
        const sa = iw / ih, ta = W / H;
        let sx, sy, sw, sh;
        if (sa > ta) { sh = ih; sw = ih * ta; sx = (iw - sw) / 2; sy = 0; }
        else { sw = iw; sh = iw / ta; sx = 0; sy = (ih - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        this._drawCardOverlay(ctx, W, H, site);
        this._notifyTextureUpdate(site);
      };
      img.onerror = () => this._notifyTextureUpdate(site);
      img.src = site.thumbUrl;
    } else {
      // Fully procedural (uploaded site) — no async reload needed.
      this._drawProcedural(ctx, W, H, site);
      this._drawCardOverlay(ctx, W, H, site);
    }

    return cv;
  }

  _drawProcedural(ctx, W, H, site) {
    const proc = makeProceduralCanvas({
      title: site.title, brand: site.brand, year: site.year, tags: site.tags,
    });
    ctx.drawImage(proc, 0, 0, W, H);
  }

  _drawCardOverlay(ctx, W, H, site) {
    // Header
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '500 18px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const headerY = 34;
    ctx.fillText((site.brand || (site.source === 'uploads' ? 'UPLOAD' : 'PROJECT')).slice(0, 22), 24, headerY);

    // Bottom gradient
    const sg = ctx.createLinearGradient(0, H - 130, 0, H);
    sg.addColorStop(0, 'rgba(0,0,0,0)');
    sg.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, H - 130, W, 130);

    // Title
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '600 22px "Space Grotesk", sans-serif';
    wrapText(ctx, (site.title || site.slug).slice(0, 48), 24, H - 78, W - 48, 26);

    // Year
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '500 12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(site.year || (site.source === 'uploads' ? 'NEW' : '')), W - 24, H - 24);
  }

  _notifyTextureUpdate(site) {
    // Match by slug so duplicate meshes and post-upload meshes (which carry
    // different object references for the same site) all refresh.
    const key = site.slug;
    for (const m of this.meshes) {
      if (m.userData.site && m.userData.site.slug === key && m.material.map) {
        m.material.map.needsUpdate = true;
      }
    }
  }

  /* ---------------- Frame loop ---------------- */

  _tick() {
    requestAnimationFrame(this._tick);

    if (!this.drag.active && !this.drag.locked) {
      // Idle drift
      this.drag.tRotY += IDLE_DRIFT;
      // Apply release inertia
      this.drag.tRotY += this.drag.vY;
      this.drag.tRotX += this.drag.vX;
      this.drag.tRotX = clamp(this.drag.tRotX, -TILT_LIMIT, TILT_LIMIT);
      this.drag.vX *= FRICTION;
      this.drag.vY *= FRICTION;
      if (Math.abs(this.drag.vX) < 1e-5) this.drag.vX = 0;
      if (Math.abs(this.drag.vY) < 1e-5) this.drag.vY = 0;
    }

    this.drag.rotX += (this.drag.tRotX - this.drag.rotX) * EASE;
    this.drag.rotY += (this.drag.tRotY - this.drag.rotY) * EASE;

    this.group.rotation.x = this.drag.rotX;
    this.group.rotation.y = this.drag.rotY;

    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------- Public API for the viewer ---------------- */

  unlock() {
    this.drag.locked = false;
  }

  resetRotation() {
    gsap.to(this.drag, { tRotX: 0, duration: 1.2, ease: 'power3.out' });
    gsap.to(this.drag, { tRotY: 0, duration: 1.2, ease: 'power3.out' });
    this.drag.vX = 0; this.drag.vY = 0;
  }

  dispose() {
    this.meshes.forEach(m => {
      m.geometry.dispose();
      if (m.material.map) m.material.map.dispose();
      m.material.dispose();
    });
    this.renderer.dispose();
  }
}
