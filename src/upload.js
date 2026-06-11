/**
 * upload.js
 * Upload UI: modal with drag-and-drop, queue display, and per-file POST to
 * the Netlify Function at /.netlify/functions/uploads.
 * On success, the function returns the canonical site payload, which is
 * handed back to the gallery via the onUploaded callback.
 */
import { gsap } from 'gsap';

export class Uploader {
  constructor({ onUploaded } = {}) {
    this.onUploaded = onUploaded;
    this.modal = document.getElementById('uploadModal');
    this.dropzone = document.getElementById('dropzone');
    this.input = document.getElementById('modalInput');
    this.queue = document.getElementById('queue');
    this.confirm = document.getElementById('confirmUpload');
    this.cancel = document.getElementById('cancelUpload');
    this.openBtn = document.getElementById('uploadBtn');

    this.files = [];
    this._bind();
  }

  _bind() {
    this.openBtn.addEventListener('click', () => this._openModal());

    this.input.addEventListener('change', (e) => {
      this._ingestFiles(Array.from(e.target.files || []));
      this.input.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev =>
      this.dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        this.dropzone.classList.add('drag');
      })
    );
    ['dragleave', 'drop'].forEach(ev =>
      this.dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        this.dropzone.classList.remove('drag');
      })
    );
    this.dropzone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files || []).filter(f => /\.html?$/i.test(f.name) || f.type === 'text/html');
      this._ingestFiles(files);
    });

    this.cancel.addEventListener('click', () => this._closeModal());
    this.confirm.addEventListener('click', () => this._runUpload());

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this._closeModal();
    });
  }

  _openModal() {
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    gsap.fromTo(this.modal, { opacity: 0 }, { opacity: 1, duration: 0.25 });
  }

  _closeModal() {
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
    this.files = [];
    this._renderQueue();
  }

  _ingestFiles(files) {
    const MAX = 5_000_000;
    for (const f of files) {
      if (!/\.html?$/i.test(f.name) && f.type !== 'text/html') continue;
      if (f.size > MAX) {
        this.files.push({ file: f, status: 'error', error: 'too large (>5MB)' });
        continue;
      }
      if (this.files.find(x => x.file.name === f.name && x.file.size === f.size)) continue;
      this.files.push({ file: f, status: 'queued' });
    }
    this._renderQueue();
  }

  _renderQueue() {
    this.queue.innerHTML = '';
    for (const item of this.files) {
      const li = document.createElement('li');
      if (item.status === 'done') li.classList.add('done');
      if (item.status === 'error') li.classList.add('error');
      const name = document.createElement('span');
      name.className = 'qname';
      name.textContent = item.file.name;
      const stat = document.createElement('span');
      stat.className = 'qstat';
      const label = item.status === 'done' ? 'Uploaded'
        : item.status === 'error' ? (item.error || 'Failed')
        : 'Queued';
      stat.textContent = label;
      li.appendChild(name);
      li.appendChild(stat);
      this.queue.appendChild(li);
    }
    const ready = this.files.filter(f => f.status === 'queued').length;
    this.confirm.textContent = `Upload ${ready} file(s)`;
    this.confirm.disabled = ready === 0;
  }

  async _runUpload() {
    const ready = this.files.filter(f => f.status === 'queued');
    if (ready.length === 0) return;
    this.confirm.disabled = true;
    this.confirm.textContent = 'Uploading…';

    const newSites = [];
    for (const item of ready) {
      try {
        if (item.file.size > 5_000_000) {
          item.error = 'too large (>5MB)';
          throw new Error(item.error);
        }
        const html = await item.file.text();
        const res = await fetch('/.netlify/functions/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: item.file.name,
            html,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
        }
        const site = await res.json();
        newSites.push(site);
        item.status = 'done';
      } catch (e) {
        console.error('[upload] failed', item.file.name, e);
        item.status = 'error';
      }
      this._renderQueue();
    }

    if (newSites.length > 0 && typeof this.onUploaded === 'function') {
      this.onUploaded(newSites);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: `Uploaded ${newSites.length} file(s) — added to gallery` }
      }));
    }

    this.confirm.disabled = false;
    setTimeout(() => this._closeModal(), 600);
  }
}
