/**
 * viewer.js
 * Fullscreen overlay that hosts an iframe for the chosen site.
 * - Smoothly fades in over the 3D scene (which is already zooming the card forward).
 * - Provides a close button + ESC + browser back to return.
 */
import { gsap } from 'gsap';

export class Viewer {
  constructor({ onClose } = {}) {
    this.el = document.getElementById('viewer');
    this.stage = document.getElementById('vStage');
    this.titleEl = document.getElementById('vTitle');
    this.brandEl = document.getElementById('vBrand');
    this.openEl = document.getElementById('vOpen');
    this.closeEl = document.getElementById('vClose');
    this.onClose = onClose;
    this.currentSite = null;
    this._historyPushed = false;
    this._bind();
  }

  _bind() {
    this.closeEl.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.el.classList.contains('open')) this.close();
    });
    window.addEventListener('popstate', () => {
      if (this.el.classList.contains('open')) this.close({ skipHistory: true });
    });
  }

  open(site) {
    this.currentSite = site;
    if (this.titleEl) this.titleEl.textContent = site.title || site.slug;
    if (this.brandEl) this.brandEl.textContent = site.brand || (site.source === 'uploads' ? 'UPLOAD' : 'PROJECT');
    if (this.openEl) this.openEl.href = site.url;

    this.stage.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.innerHTML = '<div class="spinner"></div>Loading…';
    this.stage.appendChild(loading);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('allow', 'fullscreen; clipboard-read; clipboard-write');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    // Sandbox the iframe so an uploaded page can't escape into the parent
    // origin. `allow-same-origin` is required for the iframe to load
    // same-origin sites correctly; combined with `allow-scripts` this still
    // gives the uploaded page normal capabilities within its own frame.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.addEventListener('load', () => {
      iframe.classList.add('loaded');
      setTimeout(() => loading.remove(), 250);
    });
    iframe.src = site.url;
    this.stage.appendChild(iframe);

    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');

    if (!this._historyPushed) {
      history.pushState({ gallery: true }, '', `#/${encodeURIComponent(site.slug)}`);
      this._historyPushed = true;
    }

    gsap.fromTo(this.el, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' });
  }

  close({ skipHistory = false } = {}) {
    if (!this.el.classList.contains('open')) return;
    gsap.to(this.el, {
      opacity: 0,
      duration: 0.35,
      ease: 'power2.in',
      onComplete: () => {
        this.el.classList.remove('open');
        this.el.setAttribute('aria-hidden', 'true');
        this.stage.innerHTML = '';
        this.currentSite = null;
        if (this.onClose) this.onClose();
      },
    });
    if (!skipHistory && this._historyPushed) {
      history.back();
    }
    this._historyPushed = false;
  }
}
