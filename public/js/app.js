/**
 * VOSCTV NVR REMOTE CONSOLE
 * Pure zero-clutter viewer controller
 */

const host = window.location.hostname || 'localhost';
const NVR1_URL = `http://${host}:8091/`;
const NVR2_URL = `http://${host}:8092/`;

let currentTab = 'nvr1';

function ensureFrameLoaded(frameId, url) {
  const frame = document.getElementById(frameId);
  if (frame && !frame.dataset.loaded) {
    frame.dataset.loaded = 'true';
    frame.src = url;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Directly set src on initial load
  ensureFrameLoaded('frame-nvr1', NVR1_URL);

  // Setup keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === '1') switchTab('nvr1');
    if (e.altKey && e.key === '2') switchTab('nvr2');
    if (e.altKey && e.key.toLowerCase() === 's') switchTab('split');
  });
});

function switchTab(tabId) {
  currentTab = tabId;

  // Update tabs
  document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${tabId}`);
  if (activeTab) activeTab.classList.add('active');

  // Update panes
  document.querySelectorAll('.viewport-pane').forEach(p => p.classList.remove('active'));
  const activePane = document.getElementById(`pane-${tabId}`);
  if (activePane) activePane.classList.add('active');

  // Lazy load frames
  if (tabId === 'nvr1') {
    ensureFrameLoaded('frame-nvr1', NVR1_URL);
  } else if (tabId === 'nvr2') {
    ensureFrameLoaded('frame-nvr2', NVR2_URL);
  } else if (tabId === 'split') {
    ensureFrameLoaded('frame-split-nvr1', NVR1_URL);
    ensureFrameLoaded('frame-split-nvr2', NVR2_URL);
  }
}

function reloadActive() {
  if (currentTab === 'nvr1') {
    const f1 = document.getElementById('frame-nvr1');
    f1.dataset.loaded = 'true';
    f1.src = NVR1_URL;
  } else if (currentTab === 'nvr2') {
    const f2 = document.getElementById('frame-nvr2');
    f2.dataset.loaded = 'true';
    f2.src = NVR2_URL;
  } else if (currentTab === 'split') {
    const sf1 = document.getElementById('frame-split-nvr1');
    const sf2 = document.getElementById('frame-split-nvr2');
    sf1.dataset.loaded = 'true';
    sf2.dataset.loaded = 'true';
    sf1.src = NVR1_URL;
    sf2.src = NVR2_URL;
  }
}

function openDirectTab() {
  const directUrl = currentTab === 'nvr2' ? 'http://192.168.1.181/' : 'http://192.168.1.200/';
  window.open(directUrl, '_blank');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}
