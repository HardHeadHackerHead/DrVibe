// Dr. Vibe - Project Display UI
// Shows the currently active project name and type near Dr. Vibe.

import { eventBus, Events } from '../core/EventBus.js';

export class ProjectDisplay {
  constructor() {
    this.container = null;
    this.nameEl = null;
    this.badgeEl = null;
    this.canvasEl = null;
    this.currentProject = null;
  }

  init() {
    this.container = document.getElementById('project-display');
    this.nameEl = document.getElementById('project-name');
    this.badgeEl = document.getElementById('project-badge');
    this.canvasEl = document.getElementById('character-canvas');

    if (!this.container) {
      console.log('ProjectDisplay: #project-display not found');
      return;
    }

    this.setupEventListeners();
  }

  setupEventListeners() {
    eventBus.on(Events.PROJECT_CHANGED, ({ current, previous }) => {
      this.currentProject = current;
      this.show(current);
    });

    eventBus.on(Events.PROJECT_LOST, () => {
      this.currentProject = null;
      this.hide();
    });
  }

  show(project) {
    if (!this.container || !project) return;

    this.nameEl.textContent = project.name;

    if (project.typeInfo) {
      this.badgeEl.textContent = project.typeInfo.label;
      this.badgeEl.style.background = project.typeInfo.color;
      this.badgeEl.classList.remove('hidden');
      this._applyCharacterGlow(project.typeInfo.color);
    } else if (project.projectType) {
      this.badgeEl.textContent = project.projectType;
      this.badgeEl.style.background = '#666';
      this.badgeEl.classList.remove('hidden');
      this._applyCharacterGlow('#666');
    } else {
      this.badgeEl.classList.add('hidden');
      this._clearCharacterGlow();
    }

    this.container.classList.remove('hidden');
    // Trigger reflow then add visible class for transition
    this.container.classList.add('visible');
  }

  hide() {
    if (!this.container) return;
    this.container.classList.remove('visible');
    this._clearCharacterGlow();
  }

  _applyCharacterGlow(color) {
    if (!this.canvasEl) return;
    this.canvasEl.style.filter = `drop-shadow(0 0 6px ${color}40)`;
  }

  _clearCharacterGlow() {
    if (!this.canvasEl) return;
    this.canvasEl.style.filter = '';
  }

  getCurrentProject() {
    return this.currentProject;
  }
}
