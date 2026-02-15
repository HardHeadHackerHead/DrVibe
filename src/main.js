// Dr. Vibe - Main Application Logic
import { SpriteAnimator } from './animator.js';
import { Character } from './character.js';
import { Timer } from './timer.js';
import { Settings } from './settings.js';

// Tauri imports (will be available when running in Tauri)
let tauriWindow = null;
let invoke = null;

// Initialize Tauri APIs
async function initTauri() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    tauriWindow = getCurrentWindow();
    invoke = tauriInvoke;
    console.log('Tauri APIs initialized');
    return true;
  } catch (e) {
    console.log('Running in browser mode (Tauri not available)');
    return false;
  }
}

// Application state
const state = {
  isCoding: false,
  lastActivity: Date.now(),
  sessionStart: Date.now(),
  isDragging: false,
  dragOffset: { x: 0, y: 0 }
};

// DOM elements
const canvas = document.getElementById('character-canvas');
const timerText = document.getElementById('timer-text');
const sessionTime = document.getElementById('session-time');

const settingsPanel = document.getElementById('settings-panel');

// Core modules
let animator = null;
let character = null;
let timer = null;
let settings = null;
let isTauriAvailable = false;

// Initialize the application
async function init() {
  console.log('Initializing Dr. Vibe...');

  isTauriAvailable = await initTauri();

  // Load settings
  settings = new Settings();
  await settings.load();

  // Initialize animator
  animator = new SpriteAnimator(canvas, 32, 32, 4); // 32x32 sprites, 4x scale
  await animator.loadSpriteSheet('assets/sprites/dr-vibe.png');

  // Define animations (row, frameCount, frameDuration in ms)
  animator.defineAnimation('idle', 0, 3, 300);
  animator.defineAnimation('coding', 1, 4, 200);
  animator.defineAnimation('thinking', 2, 3, 400);
  animator.defineAnimation('tired', 3, 3, 500);
  animator.defineAnimation('excited', 4, 4, 150);
  animator.defineAnimation('alert', 5, 3, 250);

  // Initialize character state machine
  character = new Character(animator);

  // Initialize timer
  timer = new Timer(settings.workInterval, settings.breakInterval);
  timer.onTick = updateTimerDisplay;
  timer.onWorkComplete = handleWorkComplete;
  timer.onBreakComplete = handleBreakComplete;
  timer.onProgress = handleTimerProgress;

  // Set up event listeners
  setupEventListeners();

  // Start activity monitoring
  if (isTauriAvailable) {
    startActivityMonitoring();
  }

  // Start animation loop
  requestAnimationFrame(gameLoop);

  // Start timer
  timer.start();

  console.log('Dr. Vibe initialized!');
}

// Main game loop
let lastTime = 0;
function gameLoop(timestamp) {
  const deltaTime = timestamp - lastTime;
  lastTime = timestamp;

  // Update character
  character.update(deltaTime);

  // Update session time display
  updateSessionDisplay();

  requestAnimationFrame(gameLoop);
}

// Update timer display
function updateTimerDisplay(minutes, seconds) {
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  timerText.textContent = timeStr;
}

// Update session time display
function updateSessionDisplay() {
  const elapsed = Math.floor((Date.now() - state.sessionStart) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);

  if (hours > 0) {
    sessionTime.textContent = `Session: ${hours}h ${minutes}m`;
  } else {
    sessionTime.textContent = `Session: ${minutes}m`;
  }
}

// Handle timer progress (0-100%)
function handleTimerProgress(progress) {
  timerText.classList.remove('fresh', 'halfway', 'urgent');

  if (progress < 50) {
    timerText.classList.add('fresh');
  } else if (progress < 80) {
    timerText.classList.add('halfway');
  } else {
    timerText.classList.add('urgent');
    if (progress >= 80 && character.currentState !== 'tired') {
      character.setState('tired');
    }
  }
}

// Handle work period complete
async function handleWorkComplete() {
  console.log('Work period complete!');
  character.setState('alert');

  // Send notification
  if (settings.notificationsEnabled && isTauriAvailable) {
    try {
      const notification = await import('@tauri-apps/plugin-notification');
      await notification.sendNotification({
        title: 'Break Time!',
        body: 'Dr. Vibe says: Take a 5 minute break! You\'ve earned it.'
      });
    } catch (e) {
      console.log('Notification failed:', e);
      // Fallback to browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Break Time!', {
          body: 'Dr. Vibe says: Take a 5 minute break!'
        });
      }
    }
  }
}

// Handle break period complete
function handleBreakComplete() {
  console.log('Break complete!');
  character.setState('excited');

  // After celebration, return to appropriate state
  setTimeout(() => {
    character.setState(state.isCoding ? 'coding' : 'idle');
  }, 3000);
}

// Activity monitoring
let activityPollInterval = null;

function startActivityMonitoring() {
  activityPollInterval = setInterval(async () => {
    try {
      const windowInfo = await invoke('get_active_window');
      const wasCoding = state.isCoding;
      state.isCoding = await invoke('is_coding_app', { appName: windowInfo.app_name });

      if (state.isCoding !== wasCoding) {
        onActivityChanged(state.isCoding);
      }

      if (state.isCoding) {
        state.lastActivity = Date.now();
      }
    } catch (e) {
      // Fallback: assume coding if in dev mode
      console.log('Activity detection not available');
    }
  }, 3000);
}

function onActivityChanged(isCoding) {
  console.log(`Activity changed: ${isCoding ? 'coding' : 'not coding'}`);

  if (isCoding) {
    if (character.currentState === 'idle' || character.currentState === 'thinking') {
      character.setState('coding');
    }
  } else {
    if (character.currentState === 'coding') {
      character.setState('thinking');
      // After 30 seconds of no activity, go to idle
      setTimeout(() => {
        if (!state.isCoding && character.currentState === 'thinking') {
          character.setState('idle');
        }
      }, 30000);
    }
  }
}

// Event listeners
function setupEventListeners() {
  // Dragging
  canvas.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', endDrag);

  // Context menu (right-click for settings)
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    toggleSettings();
  });

  // Settings panel
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-close').addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      settingsPanel.classList.add('hidden');
    }
  });
}

// Dragging functionality
async function startDrag(e) {
  if (e.button !== 0) return; // Only left click

  state.isDragging = true;
  state.dragOffset.x = e.clientX;
  state.dragOffset.y = e.clientY;

  canvas.style.cursor = 'grabbing';
}

async function drag(e) {
  if (!state.isDragging || !isTauriAvailable) return;

  const deltaX = e.clientX - state.dragOffset.x;
  const deltaY = e.clientY - state.dragOffset.y;

  try {
    const position = await tauriWindow.outerPosition();
    await tauriWindow.setPosition({
      type: 'Physical',
      x: position.x + deltaX,
      y: position.y + deltaY
    });
  } catch (err) {
    console.log('Drag error:', err);
  }
}

function endDrag() {
  state.isDragging = false;
  canvas.style.cursor = 'grab';

  // Save position
  if (isTauriAvailable) {
    saveWindowPosition();
  }
}

async function saveWindowPosition() {
  try {
    const position = await tauriWindow.outerPosition();
    settings.position = { x: position.x, y: position.y };
    await settings.save();
  } catch (e) {
    console.log('Failed to save position:', e);
  }
}

// Settings
function toggleSettings() {
  settingsPanel.classList.toggle('hidden');

  if (!settingsPanel.classList.contains('hidden')) {
    // Populate current values
    document.getElementById('work-interval').value = settings.workInterval;
    document.getElementById('break-interval').value = settings.breakInterval;
    document.getElementById('notifications').checked = settings.notificationsEnabled;
  }
}

async function saveSettings() {
  settings.workInterval = parseInt(document.getElementById('work-interval').value);
  settings.breakInterval = parseInt(document.getElementById('break-interval').value);
  settings.notificationsEnabled = document.getElementById('notifications').checked;

  await settings.save();

  // Update timer with new intervals
  timer.setIntervals(settings.workInterval, settings.breakInterval);

  settingsPanel.classList.add('hidden');
  console.log('Settings saved');
}

// Start the application
init().catch(console.error);
