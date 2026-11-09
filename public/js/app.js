/**
 * VOSCCTV NVR REMOTE CONSOLE
 * Clean, lightweight viewer with simple loading & timeout feedback
 */

const host = window.location.hostname || 'localhost';
const NVR1_URL = `http://${host}:8091/`;
const NVR2_URL = `http://${host}:8092/`;
const TIMEOUT_MS = 14000;      // 14s timeout
const STATUS_POLL_MS = 15000;  // 15s health check

let currentTab = 'gpu';

const nvrState = {
  nvr1: {
    id: 'nvr1',
    name: 'NVR 1',
    url: NVR1_URL,
    status: 'idle',
    timer: null,
    loaded: false
  },
  nvr2: {
    id: 'nvr2',
    name: 'NVR 2',
    url: NVR2_URL,
    status: 'idle',
    timer: null,
    loaded: false
  }
};

/**
 * Show simple loading spinner
 */
function startLoading(id) {
  const item = nvrState[id];
  if (!item) return;

  if (item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }

  item.status = 'loading';

  // Reveal overlay
  const overlay = document.getElementById(`overlay-${id}`);
  if (overlay) overlay.classList.remove('hidden');

  // Show spinner, hide timeout
  const cardLoading = document.getElementById(`card-loading-${id}`);
  const cardTimeout = document.getElementById(`card-timeout-${id}`);
  if (cardLoading) cardLoading.style.display = 'flex';
  if (cardTimeout) cardTimeout.style.display = 'none';

  // Text
  const titleEl = document.getElementById(`title-${id}`);
  if (titleEl) titleEl.textContent = `Connecting to ${item.name}...`;

  // Timeout timer
  item.timer = setTimeout(() => {
    onTimeout(id);
  }, TIMEOUT_MS);
}

/**
 * Hide loading overlay and show feed
 */
function markReady(id) {
  const item = nvrState[id];
  if (!item) return;

  if (item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }

  item.status = 'ready';
  item.loaded = true;

  // Smoothly fade out overlay
  const overlay = document.getElementById(`overlay-${id}`);
  if (overlay) overlay.classList.add('hidden');

  // Tab dot: Solid Green
  const dotEl = document.getElementById(`dot-${id}`);
  if (dotEl) {
    dotEl.className = 'dot online';
    dotEl.title = `${item.name} Online`;
  }
}

/**
 * Show simple connection timeout state
 */
function onTimeout(id) {
  const item = nvrState[id];
  if (!item) return;

  if (item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }

  item.status = 'timeout';

  // Reveal overlay
  const overlay = document.getElementById(`overlay-${id}`);
  if (overlay) overlay.classList.remove('hidden');

  // Show timeout row, hide spinner
  const cardLoading = document.getElementById(`card-loading-${id}`);
  const cardTimeout = document.getElementById(`card-timeout-${id}`);
  if (cardLoading) cardLoading.style.display = 'none';
  if (cardTimeout) cardTimeout.style.display = 'flex';

  // Tab dot: Grey (Dead)
  const dotEl = document.getElementById(`dot-${id}`);
  if (dotEl) {
    dotEl.className = 'dot dead';
    dotEl.title = `${item.name} Offline`;
  }
}

/**
 * Retry connection to a specific pane
 */
function retryPane(id) {
  const item = nvrState[id];
  if (!item) return;

  const frame = document.getElementById(`frame-${id}`);
  if (frame) {
    const sep = item.url.includes('?') ? '&' : '?';
    frame.src = `${item.url}${sep}_retry=${Date.now()}`;
  }

  startLoading(id);
}

/**
 * Ensure frame has loaded its URL
 */
function ensureFrameLoaded(id) {
  const item = nvrState[id];
  if (!item) return;

  const frame = document.getElementById(`frame-${id}`);
  if (frame && !frame.dataset.loaded) {
    frame.dataset.loaded = 'true';
    frame.src = item.url;
    startLoading(id);
  }
}

/**
 * Switch active session tab ('nvr1' | 'nvr2' | 'split' | 'gpu')
 */
function switchTab(tabId) {
  currentTab = tabId;

  // Update tabs active state
  document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${tabId}`);
  if (activeTab) activeTab.classList.add('active');

  // Update shared viewport layout mode ('nvr1' | 'nvr2' | 'split' | 'gpu')
  const viewportArea = document.getElementById('viewport-area');
  if (viewportArea) {
    viewportArea.setAttribute('data-view', tabId);
  }

  // Stop GPU streams when leaving GPU tab to conserve bandwidth & NVR sockets
  if (tabId !== 'gpu' && window.VOSCCTV_GPU_WALL) {
    window.VOSCCTV_GPU_WALL.stop();
  }

  // Lazy load persistent frames so single & split views share the exact same session
  if (tabId === 'nvr1') {
    ensureFrameLoaded('nvr1');
  } else if (tabId === 'nvr2') {
    ensureFrameLoaded('nvr2');
  } else if (tabId === 'split') {
    ensureFrameLoaded('nvr1');
    ensureFrameLoaded('nvr2');
  } else if (tabId === 'gpu') {
    if (window.VOSCCTV_GPU_WALL) {
      window.VOSCCTV_GPU_WALL.init();
    }
  }
}

/**
 * Reload active session(s)
 */
function reloadActive() {
  if (currentTab === 'nvr1') {
    retryPane('nvr1');
  } else if (currentTab === 'nvr2') {
    retryPane('nvr2');
  } else if (currentTab === 'split') {
    retryPane('nvr1');
    retryPane('nvr2');
  } else if (currentTab === 'gpu') {
    if (window.VOSCCTV_GPU_WALL) {
      window.VOSCCTV_GPU_WALL.init();
    }
  }
}

/**
 * Open target NVR in direct browser tab
 */
function openDirectTab(optId) {
  const targetId = optId || (currentTab === 'nvr2' ? 'nvr2' : 'nvr1');
  const target = nvrState[targetId];
  if (target) {
    window.open(target.url, '_blank');
  }
}

/**
 * Toggle Fullscreen
 */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}

/**
 * Light / Dark Theme Management
 */
function getActiveTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
  const targetTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', targetTheme);
  try {
    localStorage.setItem('voscctv_theme', targetTheme);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = targetTheme;
  } catch (e) {}

  updateThemeUI(targetTheme);
}

function toggleTheme() {
  const current = getActiveTheme();
  const next = current === 'light' ? 'dark' : 'light';
  setTheme(next);
}

function updateThemeUI(theme) {
  const icon = document.getElementById('theme-toggle-icon');
  const label = document.getElementById('theme-toggle-label');
  const btn = document.getElementById('theme-toggle-btn');
  if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
  if (label) label.textContent = theme === 'light' ? 'Dark' : 'Light';
  if (btn) {
    btn.title = theme === 'light' ? 'Switch to Dark Mode (Alt+T)' : 'Switch to Light Mode (Alt+T)';
    btn.setAttribute('aria-pressed', String(theme === 'light'));
  }
}

function initTheme() {
  let saved = 'dark';
  try {
    saved = localStorage.getItem('voscctv_theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  } catch (e) {}
  setTheme(saved);

  // Sync across tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'voscctv_theme' && e.newValue) {
      setTheme(e.newValue);
    }
  });

  // Listen to OS preference changes if no manual override is saved
  try {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', (e) => {
      if (!localStorage.getItem('voscctv_theme')) {
        setTheme(e.matches ? 'light' : 'dark');
      }
    });
  } catch (e) {}
}

/**
 * Periodic health checker for tab status dots: Solid Green (Online) or Grey (Dead)
 */
function pollHealth() {
  fetch('/api/status')
    .then(r => r.json())
    .then(data => {
      (data.nvrs || []).forEach(nvr => {
        const item = nvrState[nvr.id];
        if (!item) return;

        const dotEl = document.getElementById(`dot-${nvr.id}`);
        if (!dotEl) return;

        if (nvr.online) {
          dotEl.className = 'dot online';
          dotEl.title = `${item.name} Online (${nvr.latencyMs}ms)`;
        } else {
          dotEl.className = 'dot dead';
          dotEl.title = `${item.name} Offline`;
        }
      });
    })
    .catch(() => {});
}

// -------------------------------------------------------------
// DOM Initialization & Event Wiring
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Wire up frame load/error event listeners
  ['nvr1', 'nvr2'].forEach(id => {
    const frame = document.getElementById(`frame-${id}`);
    if (frame) {
      frame.addEventListener('load', () => {
        if (nvrState[id].status === 'loading') {
          setTimeout(() => {
            if (nvrState[id].status === 'loading') {
              markReady(id);
            }
          }, 600);
        }
      });

      frame.addEventListener('error', () => {
        onTimeout(id);
      });
    }
  });

  // Listen for messages from inside Dahua iframe
  window.addEventListener('message', (e) => {
    if (e.data && (e.data.type === 'vosctv:nvr_ready' || e.data.type === 'vosctv:nvr_feed_active')) {
      const nvrId = e.data.nvrId;
      if (nvrId && nvrState[nvrId]) {
        markReady(nvrId);
      }
    }
  });

  // Initialize Light / Dark theme state
  initTheme();

  // Initially load Live Wall as default landing view
  switchTab('gpu');

  // Immediate health check and setup periodic health polling
  pollHealth();
  setInterval(pollHealth, STATUS_POLL_MS);

  // Setup keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === '0' || e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 'g')) switchTab('gpu');
    if (e.altKey && e.key === '1') switchTab('nvr1');
    if (e.altKey && e.key === '2') switchTab('nvr2');
    if (e.altKey && e.key.toLowerCase() === 's') switchTab('split');
    if (e.altKey && e.key.toLowerCase() === 't') toggleTheme();
  });
});
