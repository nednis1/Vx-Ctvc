/**
 * VOSCCTV NVR REMOTE CONSOLE
 * Streamlined Live Wall controller: auth, theme, fullscreen, reload, and NVR health polling
 */

const STATUS_POLL_MS = 15000;

const nvrHealth = {
  nvr1: { name: 'NVR 1', online: null, latencyMs: null },
  nvr2: { name: 'NVR 2', online: null, latencyMs: null }
};

/**
 * Reload Live Wall streams
 */
function reloadActive() {
  if (window.VOSCCTV_GPU_WALL) {
    window.VOSCCTV_GPU_WALL.init();
  }
}

/**
 * Toggle Fullscreen
 */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
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
  setTheme(current === 'light' ? 'dark' : 'light');
}

function updateThemeUI(theme) {
  const label = document.getElementById('theme-toggle-label');
  const btn = document.getElementById('theme-toggle-btn');
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

  window.addEventListener('storage', (e) => {
    if (e.key === 'voscctv_theme' && e.newValue) {
      setTheme(e.newValue);
    }
  });

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
 * Authentication & Session Management
 */
async function initAuth() {
  try {
    const res = await fetch('/api/auth-status');
    if (res.ok) {
      const data = await res.json();
      if (data.authRequired && !data.authenticated) {
        window.location.replace('/login.html');
        return;
      }
      const userPill = document.getElementById('user-pill');
      const userName = document.getElementById('user-name');
      if (userName && data.user && data.user.username) {
        userName.textContent = data.user.username;
      }
      if (userPill) {
        userPill.style.display = data.authRequired ? 'inline-flex' : 'none';
      }
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.style.display = data.authRequired ? 'inline-flex' : 'none';
      }
    }
  } catch (err) {
    console.warn('[VOSCTV] Auth status check error:', err);
  }
}

async function handleLogout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {}
  window.location.replace('/login.html');
}

/**
 * Sync cached NVR health indicators into sidebar tree status dots
 */
function syncHealthDots() {
  Object.keys(nvrHealth).forEach((id) => {
    const item = nvrHealth[id];
    const dotEl = document.getElementById(`dot-${id}`);
    if (!dotEl || item.online === null) return;

    if (item.online) {
      dotEl.className = 'dot online';
      dotEl.title = `${item.name} Online (${item.latencyMs}ms)`;
    } else {
      dotEl.className = 'dot dead';
      dotEl.title = `${item.name} Offline`;
    }
  });
}

function pollHealth() {
  fetch('/api/status')
    .then(r => r.json())
    .then(data => {
      (data.nvrs || []).forEach(nvr => {
        if (!nvrHealth[nvr.id]) return;
        nvrHealth[nvr.id].online = Boolean(nvr.online);
        nvrHealth[nvr.id].latencyMs = nvr.latencyMs;
      });
      syncHealthDots();
    })
    .catch(() => {});
}

window.VOSCCTV_APP = { syncHealthDots };

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTheme();

  if (window.VOSCCTV_GPU_WALL) {
    window.VOSCCTV_GPU_WALL.init();
  }

  pollHealth();
  setInterval(pollHealth, STATUS_POLL_MS);

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 't') toggleTheme();
  });
});
