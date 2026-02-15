// Dr. Vibe - Session Context Display
// Shows which files the user is actively working on.
// Compact badge that expands on hover/click to show file list.

import { eventBus, Events } from '../core/EventBus.js';

export class SessionContextDisplay {
  constructor() {
    this.container = null;
    this.badge = null;
    this.fileList = null;
    this.expanded = false;
    this.files = [];
    this.totalCount = 0;
    this._hideTimeout = null;
  }

  init() {
    this.container = document.getElementById('session-context');
    this.badge = document.getElementById('session-context-badge');
    this.fileList = document.getElementById('session-context-files');

    if (!this.container) {
      console.log('SessionContextDisplay: #session-context not found');
      return;
    }

    this.setupEventListeners();
    this.setupInteractions();
  }

  setupEventListeners() {
    eventBus.on(Events.SESSION_FILES_UPDATED, ({ files, totalCount }) => {
      this.files = files;
      this.totalCount = totalCount;
      this.render();
    });

    eventBus.on(Events.SESSION_CONTEXT_TOGGLE, () => {
      this.toggle();
    });
  }

  setupInteractions() {
    // Click badge to toggle expanded view
    this.badge?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Hover to expand
    this.container?.addEventListener('mouseenter', () => {
      clearTimeout(this._hideTimeout);
      if (this.files.length > 0) {
        this.expand();
      }
    });

    // Collapse on mouse leave (with small delay)
    this.container?.addEventListener('mouseleave', () => {
      this._hideTimeout = setTimeout(() => this.collapse(), 300);
    });

    // Click outside to collapse
    document.addEventListener('click', (e) => {
      if (this.expanded && !this.container?.contains(e.target)) {
        this.collapse();
      }
    });
  }

  render() {
    if (!this.container || !this.badge) return;

    if (this.totalCount === 0) {
      this.container.classList.add('hidden');
      return;
    }

    // Update badge
    this.badge.textContent = `${this.totalCount} file${this.totalCount !== 1 ? 's' : ''}`;
    this.container.classList.remove('hidden');
    this.container.classList.add('visible');

    // Update file list if expanded
    if (this.expanded) {
      this.renderFileList();
    }
  }

  renderFileList() {
    if (!this.fileList) return;

    this.fileList.innerHTML = '';

    for (const file of this.files) {
      const item = document.createElement('div');
      item.className = 'session-context-file';

      const nameEl = document.createElement('span');
      nameEl.className = 'session-context-filename';
      nameEl.textContent = file.filename;
      nameEl.title = file.relativePath || file.path;

      const pathEl = document.createElement('span');
      pathEl.className = 'session-context-path';
      pathEl.textContent = this.truncatePath(file.relativePath || file.path);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'session-context-copy';
      copyBtn.textContent = 'copy';
      copyBtn.title = 'Copy file path';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyPath(file.path, copyBtn);
      });

      const timeEl = document.createElement('span');
      timeEl.className = 'session-context-time';
      timeEl.textContent = this.formatAge(file.lastModified);

      const infoRow = document.createElement('div');
      infoRow.className = 'session-context-file-info';
      infoRow.appendChild(nameEl);
      infoRow.appendChild(copyBtn);

      const detailRow = document.createElement('div');
      detailRow.className = 'session-context-file-detail';
      detailRow.appendChild(pathEl);
      detailRow.appendChild(timeEl);

      item.appendChild(infoRow);
      item.appendChild(detailRow);
      this.fileList.appendChild(item);
    }

    if (this.totalCount > this.files.length) {
      const more = document.createElement('div');
      more.className = 'session-context-more';
      more.textContent = `+${this.totalCount - this.files.length} more`;
      this.fileList.appendChild(more);
    }
  }

  truncatePath(path) {
    if (!path) return '';
    // Show directory part only, truncate if too long
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    // Show last 2 directory segments + filename
    const dir = parts.slice(0, -1).join('/');
    if (dir.length > 30) {
      return '...' + dir.slice(-27);
    }
    return dir;
  }

  formatAge(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  }

  async copyPath(path, btn) {
    try {
      await navigator.clipboard.writeText(path);
      const original = btn.textContent;
      btn.textContent = 'done';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    } catch {
      // Fallback: select text approach
      const textarea = document.createElement('textarea');
      textarea.value = path;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);

      const original = btn.textContent;
      btn.textContent = 'done';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    }
  }

  expand() {
    if (this.expanded || this.files.length === 0) return;
    this.expanded = true;
    this.container?.classList.add('expanded');
    this.renderFileList();
  }

  collapse() {
    if (!this.expanded) return;
    this.expanded = false;
    this.container?.classList.remove('expanded');
  }

  toggle() {
    if (this.expanded) {
      this.collapse();
    } else {
      this.expand();
    }
  }
}
