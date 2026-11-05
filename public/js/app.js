/**
 * VOSCCTV NVR REMOTE CONSOLE
 * Clean Zero-Clutter Remote Viewer with Live Connection & Timeout Feedback
 */

const host = window.location.hostname || 'localhost';
const NVR1_URL = `http://${host}:8091/`;
const NVR2_URL = `http://${host}:8092/`;
const TIMEOUT_MS = 14000;      // 14 seconds before triggering timeout state
const STATUS_POLL_MS = 15000;  // 15 seconds periodic health check

let currentTab = 'nvr1';

const nvrState = {
  nvr1: {
    id: 'nvr1',
    name: 'NVR 1 (192.168.1.200)',
    ip: '192.168.1.200',
    port: 8091,
    url: NVR1_URL,
    status: 'idle', // 'idle' | 'loading' | 'ready' | 'timeout'
    timer: null,
    loaded: false,
    startTime: 0
  },
  nvr2: {
    id: 'nvr2',
    name: 'NVR 2 (192.168.1.181)',
    ip: '192.168.1.181',
    port: 8092,
    url: NVR2_URL,
    status: 'idle',
    timer: null,
    loaded: false,
    startTime: 0
  }
};

/**
 * Start loading an NVR frame with visual progress & timeout timer
 */
function startLoading(id) {
  const item = nvrState[id];
  if (!item) return;

  if (item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }

  item.status = 'loading';
  item.startTime = Date.now();

  // Show overlay
  const overlay = document.getElementById(`overlay-${id}`);
  if (overlay) overlay.classList.remove('hidden');

  // Display loading card, hide timeout card
  const cardLoading = document.getElementById(`card-loading-${id}`);
  const cardTimeout = document.getElementById(`card-timeout-${id}`);
  if (cardLoading) cardLoading.style.display = 'flex';
  if (cardTimeout) cardTimeout.style.display = 'none';

  // Update text & indicators
  const titleEl = document.getElementById(`title-${id}`);
  const metaEl = document.getElementById(`meta-${id}`);
  if (titleEl) titleEl.textContent = `Connecting to ${id === 'nvr1' ? 'NVR 1' : 'NVR 2'}`;
  if (metaEl) metaEl.textContent = `${item.ip} : ${item.port} • Initializing video stream...`;

  const dotEl = document.getElementById(`dot-${id}`);
  if (dotEl) {
    dotEl.className = 'dot loading';
    dotEl.title = `Status: Connecting to ${item.name}...`;
  }

  const badgeEl = document.getElementById(`badge-${id}`);
  if (badgeEl) {
    badgeEl.className = 'pane-status-badge badge-loading';
    badgeEl.textContent = 'Connecting...';
  }

  // Set timeout timer
  item.timer = setTimeout(() => {
    onTimeout(id);
  }, TIMEOUT_MS);
}

/**
 * Mark NVR feed as ready & smoothly hide loading overlay
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

  // Update meta text briefly before fading out
  const metaEl = document.getElementById(`meta-${id}`);
  if (metaEl) metaEl.textContent = 'Feed Connected • Rendering cameras...';

  // Update status indicators to online
  const dotEl = document.getElementById(`dot-${id}`);
  if (dotEl) {
    dotEl.className = 'dot online';
    dotEl.title = `Status: ${item.name} Online`;
  }

  const badgeEl = document.getElementById(`badge-${id}`);
  if (badgeEl) {
    badgeEl.className = 'pane-status-badge badge-online';
    badgeEl.textContent = 'Live';
  }

  // Smoothly fade out overlay
  setTimeout(() => {
    const overlay = document.getElementById(`overlay-${id}`);
    if (overlay && item.status === 'ready') {
      overlay.classList.add('hidden');
    }
  }, 350);
}

/**
 * Handle connection timeout and run diagnostics
 */
function onTimeout(id) {
  const item = nvrState[id];
  if (!item) return;

  if (item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }

  item.status = 'timeout';

  // Ensure overlay is visible
  const overlay = document.getElementById(`overlay-${id}`);
  if (overlay) overlay.classList.remove('hidden');

  // Switch cards
  const cardLoading = document.getElementById(`card-loading-${id}`);
  const cardTimeout = document.getElementById(`card-timeout-${id}`);
  if (cardLoading) cardLoading.style.display = 'none';
  if (cardTimeout) cardTimeout.style.display = 'flex';

  // Update tab dot to red timeout
  const dotEl = document.getElementById(`dot-${id}`);
  if (dotEl) {
    dotEl.className = 'dot timeout';
    dotEl.title = `Status: ${item.name} Connection Timed Out`;
  }

  const badgeEl = document.getElementById(`badge-${id}`);
  if (badgeEl) {
    badgeEl.className = 'pane-status-badge badge-timeout';
    badgeEl.textContent = 'Timed Out';
  }

  // Run live network diagnostic
  runDiagnostics(id);
}

/**
 * Run diagnostic port check against /api/status for helpful troubleshooting
 */
function runDiagnostics(id) {
  const item = nvrState[id];
  const diagBody = document.getElementById(`diag-body-${id}`);
  if (!diagBody) return;

  diagBody.innerHTML = '<span style="color:#94a3b8">Checking network connectivity & NVR ports...</span>';

  fetch('/api/status')
    .then(res => res.json())
    .then(data => {
      const info = (data.nvrs || []).find(n => n.id === id);
      if (info) {
        const p = info.ports || {};
        const httpOk = p.http && p.http.open;
        const rtspOk = p.rtsp && p.rtsp.open;
        const privOk = p.dahuaPrivate && p.dahuaPrivate.open;

        const lines = [
          `• NVR IP: ${info.ip} (Proxy Port ${item.port})`,
          `• Web Port 80: ${httpOk ? `✅ Open (${p.http.latency || 0}ms)` : '❌ Closed / Unreachable'}`,
          `• RTSP Port 554: ${rtspOk ? `✅ Open (${p.rtsp.latency || 0}ms)` : '❌ Closed / Unreachable'}`,
          `• Dahua Private Port 37777: ${privOk ? `✅ Open (${p.dahuaPrivate.latency || 0}ms)` : '❌ Closed / Unreachable'}`
        ];

        if (info.online) {
          lines.push(`• Assessment: Hardware is reachable, but web feed exceeded ${TIMEOUT_MS / 1000}s. Click "Retry Connection".`);
        } else {
          lines.push(`• Assessment: NVR is unreachable. Verify network cable, switch port, and power.`);
        }

        diagBody.innerHTML = lines.join('<br>');
      } else {
        diagBody.textContent = `No diagnostic data returned for ${id}`;
      }
    })
    .catch(err => {
      diagBody.textContent = `Diagnostics error: ${err.message}`;
    });
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
 * Switch active session tab ('nvr1' | 'nvr2' | 'split')
 */
function switchTab(tabId) {
  currentTab = tabId;

  // Update tabs active state
  document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${tabId}`);
  if (activeTab) activeTab.classList.add('active');

  // Update shared viewport layout mode ('nvr1' | 'nvr2' | 'split')
  const viewportArea = document.getElementById('viewport-area');
  if (viewportArea) {
    viewportArea.setAttribute('data-view', tabId);
  }

  // Lazy load persistent frames so single & split views share the exact same session
  if (tabId === 'nvr1') {
    ensureFrameLoaded('nvr1');
  } else if (tabId === 'nvr2') {
    ensureFrameLoaded('nvr2');
  } else if (tabId === 'split') {
    ensureFrameLoaded('nvr1');
    ensureFrameLoaded('nvr2');
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
 * Periodic health checker to keep tab status dots in sync
 */
function pollHealth() {
  fetch('/api/status')
    .then(r => r.json())
    .then(data => {
      (data.nvrs || []).forEach(nvr => {
        const item = nvrState[nvr.id];
        if (!item) return;

        const dotEl = document.getElementById(`dot-${nvr.id}`);
        const badgeEl = document.getElementById(`badge-${nvr.id}`);

        if (nvr.online) {
          if (item.status === 'ready' && dotEl) {
            dotEl.className = 'dot online';
            dotEl.title = `Status: ${item.name} Online (${nvr.latencyMs}ms)`;
          }
        } else {
          // If server reports offline and pane was supposed to be ready
          if (item.status === 'ready') {
            if (dotEl) {
              dotEl.className = 'dot offline';
              dotEl.title = `Status: ${item.name} Offline`;
            }
            if (badgeEl) {
              badgeEl.className = 'pane-status-badge badge-timeout';
              badgeEl.textContent = 'Offline';
            }
          }
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
        // If iframe finishes loading and still in loading state, give brief grace period then mark ready
        if (nvrState[id].status === 'loading') {
          setTimeout(() => {
            if (nvrState[id].status === 'loading') {
              markReady(id);
            }
          }, 800);
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

  // Initially load NVR 1
  ensureFrameLoaded('nvr1');

  // Setup periodic health polling
  setInterval(pollHealth, STATUS_POLL_MS);

  // Setup keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === '1') switchTab('nvr1');
    if (e.altKey && e.key === '2') switchTab('nvr2');
    if (e.altKey && e.key.toLowerCase() === 's') switchTab('split');
  });
});
