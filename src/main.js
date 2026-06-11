/**
 * main.js — entry point
 * 1. Loads the build-time manifest of sites from /manifest.json.
 * 2. Asks the Netlify Function for any runtime uploads and merges them.
 * 3. Hands the merged list to the Gallery, wires the Viewer + Uploader.
 * 4. Renders the live counts in the top meta bar.
 */
import { Gallery } from './gallery.js';
import { Viewer } from './viewer.js';
import { Uploader } from './upload.js';
import { gsap } from 'gsap';

const els = {
  hint: document.getElementById('hint'),
  countSites: document.querySelector('#countSites b'),
  countUploads: document.querySelector('#countUploads b'),
  countTotal: document.querySelector('#countTotal b'),
  resetBtn: document.getElementById('resetBtn'),
  navbar: document.querySelectorAll('.navbar a'),
  toast: document.getElementById('toast'),
};

let gallery, viewer, uploader;
let allSites = [];
let uploadSites = [];

function showToast(message, duration = 2400) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('show'), duration);
}
window.addEventListener('toast', (e) => showToast(e.detail.message));

function updateCounts() {
  if (els.countSites) els.countSites.textContent = allSites.length.toString();
  if (els.countUploads) els.countUploads.textContent = uploadSites.length.toString();
  if (els.countTotal) els.countTotal.textContent = (allSites.length + uploadSites.length).toString();
}

function mergeForGallery() {
  // Mark each upload site with a procedural-thumbDataUrl = null; gallery will
  // fall back to procedural canvas painting for these.
  const sites = allSites.concat(uploadSites);
  return sites;
}

async function loadBuildTimeManifest() {
  try {
    const res = await fetch('/manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allSites = (data.sites || []).map(s => ({
      slug: s.slug,
      title: s.title,
      brand: s.slug.replace(/-/g, ' ').toUpperCase().slice(0, 18),
      year: '2025',
      tags: ['STATIC'],
      url: s.url,
      thumb: s.thumb || null,
      thumbDataUrl: null,
      source: 'sites',
    }));
  } catch (e) {
    console.warn('[main] no build manifest:', e.message);
    allSites = [];
  }
}

async function loadRuntimeUploads() {
  try {
    const res = await fetch('/.netlify/functions/uploads', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    uploadSites = (data.sites || []).map(s => ({
      ...s,
      thumb: null,
      thumbDataUrl: null,
    }));
  } catch (e) {
    // Function not running locally is fine — Netlify will serve it in prod.
    uploadSites = [];
  }
}

function wireNav() {
  els.navbar.forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      els.navbar.forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      const tab = a.dataset.tab;
      if (tab === 'work') {
        gallery.resetRotation();
      } else if (tab === 'about' || tab === 'careers') {
        showToast(`${tab[0].toUpperCase() + tab.slice(1)} — coming soon`, 1600);
      }
    });
  });
}

function wireReset() {
  if (!els.resetBtn) return;
  els.resetBtn.addEventListener('click', () => gallery.resetRotation());
}

function init() {
  gallery = new Gallery(document.getElementById('c'), {
    onCardClick: (site) => viewer.open(site),
  });
  viewer = new Viewer({
    onClose: () => {
      gallery.unlock();
      gsap.to('#ui', { opacity: 1, duration: 0.4 });
      // Reset the previously zoomed card back to its original transform
      gallery.meshes.forEach((m, i) => {
        const o = gallery.originals[i];
        if (!o) return;
        gsap.to(m.position, { x: o.position.x, y: o.position.y, z: o.position.z, duration: 0.9, ease: 'power3.inOut' });
        gsap.to(m.scale, { x: o.scale.x, y: o.scale.y, z: o.scale.z, duration: 0.9, ease: 'power3.inOut' });
        gsap.to(m.material, { opacity: 1, duration: 0.4 });
      });
    },
  });
  uploader = new Uploader({
    onUploaded: (newSites) => {
      uploadSites = uploadSites.concat(newSites);
      gallery.addSites(newSites);
      updateCounts();
    },
  });

  wireNav();
  wireReset();
  window.__three = { gallery, viewer, uploader, get allSites() { return allSites; }, get uploadSites() { return uploadSites; } };

  // Initial rotation animation
  gsap.to(gallery.drag, { tRotY: 0.6, duration: 4, ease: 'power2.out' });

  // Load data, then push to gallery
  (async () => {
    await loadBuildTimeManifest();
    await loadRuntimeUploads();
    updateCounts();
    gallery.setSites(mergeForGallery());
    if (els.hint) {
      setTimeout(() => { if (!gallery.drag.hadInteraction) els.hint.classList.add('hide'); }, 6000);
    }
    if (allSites.length + uploadSites.length === 0) {
      showToast('No sites loaded yet — try the Upload button to add one', 3200);
    }
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
