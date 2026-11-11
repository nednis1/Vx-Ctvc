const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const http = require('http');
const httpProxy = require('http-proxy');
const net = require('net');
const path = require('path');
const zlib = require('zlib');
const go2rtcManager = require('./go2rtc-manager');
const directusClient = require('./directus-client');

// Load environment variables from .env if present
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
          if (key && process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      });
    } catch(e) {}
  }
}
loadEnv();

// Custom Camera Names file persistence
const CAMERA_NAMES_FILE = path.join(__dirname, 'camera_names.json');
function loadCustomNames() {
  try {
    if (fs.existsSync(CAMERA_NAMES_FILE)) {
      return JSON.parse(fs.readFileSync(CAMERA_NAMES_FILE, 'utf8'));
    }
  } catch (e) {}
  return { nvr1: {}, nvr2: {} };
}
function saveCustomNames(data) {
  try {
    fs.writeFileSync(CAMERA_NAMES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

// Configuration
const CONFIG = {
  dashboardPort: parseInt(process.env.PORT, 10) || 8090,
  authEnabled: process.env.AUTH_ENABLED !== 'false',
  dashboardUser: process.env.DASHBOARD_USER || 'iot',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'iot12345',
  nvrUser: process.env.NVR_USER || 'iot',
  nvrPassword: process.env.NVR_PASSWORD || 'iot12345',
  nvrs: [
    {
      id: 'nvr1',
      name: 'NVR 1 (Main Operations)',
      ip: process.env.NVR1_IP || '192.168.1.200',
      port: 80,
      rtspPort: 554,
      privatePort: 37777,
      proxyPort: 8091,
      username: process.env.NVR_USER || 'iot',
      password: process.env.NVR_PASSWORD || 'iot12345'
    },
    {
      id: 'nvr2',
      name: 'NVR 2 (Secondary Operations)',
      ip: process.env.NVR2_IP || '192.168.1.181',
      port: 80,
      rtspPort: 554,
      privatePort: 37777,
      proxyPort: 8092,
      username: process.env.NVR_USER || 'iot',
      password: process.env.NVR_PASSWORD || 'iot12345'
    }
  ]
};

// -------------------------------------------------------------
// Session Management & Dashboard Authentication
// -------------------------------------------------------------
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
let activeSessions = {};

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      activeSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {
    activeSessions = {};
  }
}

function saveSessions() {
  try {
    const now = Date.now();
    Object.keys(activeSessions).forEach(id => {
      if (activeSessions[id].expires < now) delete activeSessions[id];
    });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(activeSessions), 'utf8');
  } catch (e) {}
}
loadSessions();

function parseCookies(req) {
  const list = {};
  const rc = req.headers && req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts.shift().trim();
      const val = decodeURIComponent(parts.join('='));
      if (key) list[key] = val;
    });
  }
  return list;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies['voscctv_session'];
  if (!sessionId) return null;
  const sess = activeSessions[sessionId];
  if (!sess) return null;
  if (sess.expires < Date.now()) {
    delete activeSessions[sessionId];
    saveSessions();
    return null;
  }
  return sess;
}

function isValidSession(req) {
  if (!CONFIG.authEnabled) return true;
  return Boolean(getSessionFromRequest(req));
}

// -------------------------------------------------------------
// 1. Setup Reverse Proxies for NVRs
// -------------------------------------------------------------
const proxyServers = [];

// -------------------------------------------------------------
// Dahua Digest Authentication & CGI Helper
// -------------------------------------------------------------
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseDigestHeader(header) {
  const params = {};
  const regex = /(\w+)=(?:\"([^\"]+)\"|([^,\s]+))/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] || match[3];
  }
  return params;
}

function dahuaDigestRequest(url, username, password) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req1 = http.get(url, { timeout: 4500 }, (res1) => {
      res1.resume();
      if (res1.statusCode !== 401 || !res1.headers['www-authenticate']) {
        return resolve({ status: res1.statusCode, body: '' });
      }

      const auth = parseDigestHeader(res1.headers['www-authenticate']);
      const uri = parsedUrl.pathname + parsedUrl.search;
      const cnonce = crypto.randomBytes(8).toString('hex');
      const nc = '00000001';
      const ha1 = md5(username + ':' + auth.realm + ':' + password);
      const ha2 = md5('GET:' + uri);
      const response = auth.qop
        ? md5(ha1 + ':' + auth.nonce + ':' + nc + ':' + cnonce + ':' + auth.qop + ':' + ha2)
        : md5(ha1 + ':' + auth.nonce + ':' + ha2);

      let authHeader = 'Digest username="' + username + '", realm="' + auth.realm + '", nonce="' + auth.nonce + '", uri="' + uri + '", response="' + response + '"';
      if (auth.qop) authHeader += ', qop=' + auth.qop + ', nc=' + nc + ', cnonce="' + cnonce + '"';
      if (auth.opaque) authHeader += ', opaque="' + auth.opaque + '"';

      const req2 = http.get(url, { headers: { 'Authorization': authHeader }, timeout: 4500 }, (res2) => {
        let body = '';
        res2.on('data', chunk => body += chunk);
        res2.on('end', () => resolve({ status: res2.statusCode, body }));
      });
      req2.on('error', reject);
    });
    req1.on('error', reject);
    req1.on('timeout', () => { req1.destroy(); reject(new Error('Request timeout')); });
  });
}

// Automatically sync official camera names from NVRs on startup or refresh
async function syncOfficialNvrNames() {
  const customData = loadCustomNames();
  let updated = false;
  for (const nvr of CONFIG.nvrs) {
    try {
      const url = 'http://' + nvr.ip + ':' + nvr.port + '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle';
      const res = await dahuaDigestRequest(url, nvr.username, nvr.password);
      if (res.status === 200 && res.body) {
        if (!customData[nvr.id]) customData[nvr.id] = {};
        const lines = res.body.split('\n');
        for (const line of lines) {
          const m = line.trim().match(/table\.ChannelTitle\[(\d+)\]\.Name=(.*)/);
          if (m) {
            const ch = parseInt(m[1], 10) + 1;
            const name = m[2].trim();
            if (name && customData[nvr.id][ch] !== name) {
              customData[nvr.id][ch] = name;
              updated = true;
            }
          }
        }
        console.log('[VOSCTV] Synced ' + Object.keys(customData[nvr.id]).length + ' official camera names from ' + nvr.name);
      }
    } catch (err) {
      console.warn('[VOSCTV] Could not sync official names from ' + nvr.id + ':', err.message);
    }
  }
  if (updated) saveCustomNames(customData);
  return customData;
}

// -------------------------------------------------------------
// Express Dashboard App Initialization
// -------------------------------------------------------------
const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// -------------------------------------------------------------
// Authentication Endpoints & Route Guards
// -------------------------------------------------------------

// API: Process user login (Directus database credentials with NVR & hardware fallback)
app.post('/api/login', async (req, res) => {
  const { username, password, remember } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const cleanUser = username.trim();
  let matchedUser = null;

  // 1. Authoritative: Authenticate against Directus database (collection: iot_cctv_credentials)
  try {
    const directusAuth = await directusClient.authenticate(cleanUser, password);
    if (directusAuth && directusAuth.authenticated) {
      matchedUser = { user: directusAuth.user, role: directusAuth.role || 'admin', source: directusAuth.source };
    }
  } catch (err) {
    console.warn('[Auth] Directus authentication attempt error:', err.message);
  }

  // 2. Fallback: Match against configured NVR credentials (.env)
  if (!matchedUser) {
    if (
      cleanUser.toLowerCase() === (CONFIG.nvrUser || '').toLowerCase() &&
      password === CONFIG.nvrPassword
    ) {
      matchedUser = { user: cleanUser, role: 'admin', source: 'env_nvr' };
    } else if (
      cleanUser.toLowerCase() === (CONFIG.dashboardUser || '').toLowerCase() &&
      password === CONFIG.dashboardPassword
    ) {
      matchedUser = { user: cleanUser, role: 'admin', source: 'env_dashboard' };
    }
  }

  // 3. Fallback: Authenticate live against Dahua NVRs via Digest challenge
  if (!matchedUser) {
    for (const nvr of CONFIG.nvrs) {
      try {
        const testUrl = `http://${nvr.ip}:${nvr.port}/cgi-bin/global.cgi?action=getCurrentTime`;
        const authRes = await dahuaDigestRequest(testUrl, cleanUser, password);
        if (authRes && authRes.status === 200) {
          matchedUser = { user: cleanUser, role: 'admin', source: 'dahua_hardware' };
          break;
        }
      } catch (e) {}
    }
  }

  if (!matchedUser) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  const ttlMs = remember ? (30 * 24 * 3600 * 1000) : (24 * 3600 * 1000);
  activeSessions[sessionId] = {
    username: matchedUser.user,
    role: matchedUser.role,
    created: Date.now(),
    expires: Date.now() + ttlMs
  };
  saveSessions();

  const maxAgeSec = Math.floor(ttlMs / 1000);
  res.setHeader('Set-Cookie', `voscctv_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`);
  return res.json({ success: true, user: { username: matchedUser.user, role: matchedUser.role } });
});

// API: Logout & invalidate session
app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies['voscctv_session'];
  if (sessionId && activeSessions[sessionId]) {
    delete activeSessions[sessionId];
    saveSessions();
  }
  res.setHeader('Set-Cookie', 'voscctv_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
});

// API: Check current session status
app.get('/api/auth-status', (req, res) => {
  if (!CONFIG.authEnabled) {
    return res.json({ authRequired: false, authenticated: true, user: { username: 'kiosk', role: 'admin' } });
  }
  const sess = getSessionFromRequest(req);
  if (!sess) {
    return res.json({ authRequired: true, authenticated: false, user: null });
  }
  res.json({ authRequired: true, authenticated: true, user: { username: sess.username, role: sess.role } });
});

// Route Guard: Redirect unauthenticated requests to login page
app.get(['/', '/index.html'], (req, res, next) => {
  if (CONFIG.authEnabled && !isValidSession(req)) {
    return res.redirect('/login.html');
  }
  next();
});

// Route Guard: Redirect authenticated users away from login page
app.get('/login.html', (req, res, next) => {
  if (CONFIG.authEnabled && isValidSession(req)) {
    return res.redirect('/');
  }
  next();
});

// API Guard: protect all other /api routes
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout' || req.path === '/auth-status') {
    return next();
  }
  if (CONFIG.authEnabled && !isValidSession(req)) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

function createNvrProxy(nvr) {
  const proxy = httpProxy.createProxyServer({
    target: `http://${nvr.ip}:${nvr.port}`,
    changeOrigin: true,
    ws: true
  });

  // Ensure NVR sees its own IP in Origin/Referer headers
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.setHeader('Origin', `http://${nvr.ip}`);
    proxyReq.setHeader('Referer', `http://${nvr.ip}/`);
  });

  proxy.on('proxyReqWs', (proxyReq, req, socket) => {
    proxyReq.setHeader('Origin', `http://${nvr.ip}`);
    proxyReq.setHeader('Referer', `http://${nvr.ip}/`);
    socket.setTimeout(0);
    socket.setNoDelay(true);
  });

  // Strip headers that block iframe embedding or force HTTPS/OCX
  proxy.on('proxyRes', (proxyRes) => {
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['content-security-policy-report-only'];
    delete proxyRes.headers['strict-transport-security'];

    // Inject CORS and embedding headers
    proxyRes.headers['access-control-allow-origin'] = '*';
    proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    proxyRes.headers['access-control-allow-headers'] = '*';
    proxyRes.headers['access-control-allow-credentials'] = 'true';
  });

  proxy.on('error', (err, req, res) => {
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || (err.code && err.code.startsWith('HPE_')) || (req && (req.destroyed || req.aborted))) {
      return; // Harmless client disconnect or non-standard header token
    }
    console.error(`[${nvr.id} Proxy Error]:`, err.message);
    if (res && res.writeHead && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Cannot reach NVR at ${nvr.ip}:${nvr.port}`, details: err.message }));
    }
  });

  const bundleCache = new Map();

  function patchProjectBundle(js) {
    return js
      // 1. Suppress the "To use this function, please download and install the plug-in" banner in HTML5 mode
      .replace(
        't.showTipFun=function(){t.setState({showTip:!0})}',
        't.showTipFun=function(){t.setState({showTip:!1})}'
      )
      // 2. Allow Live Preview, Playback, and Open All in pure HTML5 mode without triggering ShowDownloadTip
      .replace('"PreviewIn","PlayBackIn"', '"_PreviewIn","_PlayBackIn"')
      .replace('"previewDefMain","previewOpenAll"', '"previewDefMain","_previewOpenAll"')
      .replace('"notSupport9CHPreviewTip"', '"_notSupport9CHPreviewTip"')
      // 3. Implement connectRealTimeVideoByChannelList in the HTML5 player mixin so "Open All" opens all cameras
      .replace(
        'connectRealVideo:function(e,t,n){return e>1&&e<6&&(e-=1),this.ocx.callOcx("connectRealTimeVideo",{stream:e,channel:t,viewIndex:n})}',
        'connectRealTimeVideoByChannelList:function(e,t){var n=this,a=Math.min(e.length,this.visibleViews||4),r=void 0===t?2:t;for(var i=0;i<a;i++)n.connectRealVideo(r,e[i],i)},connectRealVideo:function(e,t,n){return e>1&&e<6&&(e-=1),this.ocx.callOcx("connectRealTimeVideo",{stream:e,channel:t,viewIndex:n})}'
      )
      // 4. Enable 1/4/6/8/9/13/16/20/25/36 multi-column split views in HTML5 mode on both NVRs
      .replace(/="yyyyMMddhhmmss",(\w+)=null,(\w+)=null,(\w+)=16/g, '="yyyyMMddhhmmss",$1=null,$2=null,$3=36')
      .replace(/curViewIndex:0,totalViews:(\w+),splitViews:\1,visibleViews:\1/g, 'curViewIndex:0,totalViews:$1,splitViews:4,visibleViews:4')
      .replace(
        'case 4:h=2,f=2;break;case 9:h=3,f=3;break;case 16:h=4,f=4',
        'case 4:h=2,f=2;break;case 6:h=2,f=3;break;case 8:h=3,f=3;break;case 9:h=3,f=3;break;case 13:h=4,f=4;break;case 16:h=4,f=4;break;case 20:h=4,f=5;break;case 25:h=5,f=5;break;case 36:h=6,f=6'
      )
      .replace(/applicationState:Object\(([^)]+)\)\([^)]+\.App\.CHANNEL_NUMBER\)/g, 'applicationState:Object($1)(36)')
      .replace(/H5:\[1,2,4(?:,6,8,9)?\]/g, 'H5:[1,2,4,6,8,9,13,16,20,25,36]')
      .replace(/H5:\[4(?:,8,9)?\]/g, 'H5:[4,8,9,16,25,36]')
      // 5. Hook channel display names directly in Dahua tree items to support in-app renaming with ✏️
      .replace(
        '.showName=r+(e.RemoteName?e.RemoteName:e.Name)',
        '.showName=(window.__vosctvName?window.__vosctvName(n,r+(e.RemoteName?e.RemoteName:e.Name)):(r+(e.RemoteName?e.RemoteName:e.Name)))'
      )
      // 6. Hook the MAIN Live Preview & Playback sidebar channel tree names
      .replace(
        'O=(null===r||void 0===r?void 0:null===(C=r[g])||void 0===C?void 0:C.RemoteName)||(null===r||void 0===r?void 0:null===(T=r[g])||void 0===T?void 0:T.Name)',
        'O=(window.__vosctvName?window.__vosctvName(g,(null===r||void 0===r?void 0:null===(C=r[g])||void 0===C?void 0:C.RemoteName)||(null===r||void 0===r?void 0:null===(T=r[g])||void 0===T?void 0:T.Name)):((null===r||void 0===r?void 0:null===(C=r[g])||void 0===C?void 0:C.RemoteName)||(null===r||void 0===r?void 0:null===(T=r[g])||void 0===T?void 0:T.Name)))'
      );
  }

  const server = http.createServer({ insecureHTTPParser: true }, async (req, res) => {
    // Check dashboard authentication for NVR proxies if auth is enabled
    if (CONFIG.authEnabled && !isValidSession(req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('Unauthorized: Please log in to VOSCCTV console first.');
    }

    // 0. Handle all /api/ requests from inside Dahua iframes directly via Express
    if (req.url && req.url.startsWith('/api/')) {
      return app(req, res);
    }

    // Force Dahua Web 5.0 to use built-in HTML5 Canvas/MSE player instead of local Windows OCX plugin (which renders black in iframes)
    if (req.url && req.url.startsWith('/pluginVersion.js')) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        PluginVersion: '99.99.999999.9999999',
        Classid: '',
        PluginName: '',
        MimeType: ''
      }));
      return;
    }

    // Rewrite index.html to cache-bust the patched project.*.chunk.js bundle and inject sidebar rename helper
    if (req.url === '/' || req.url === '/index.html') {
      try {
        const upstream = await fetch(`http://${nvr.ip}:${nvr.port}/`);
        let html = await upstream.text();
        html = html.replace(
          /(src="\/static\/js\/project\.[^"]+\.chunk\.js)"/,
          '$1?v=vosctv8"'
        );

        // Inject script that handles double-click or hover-rename on sidebar channel items
        const renameScript = `
<script>
window.__VOSCTV_NVR_ID = "${nvr.id}";
window.__VOSCTV_INITIAL_NAMES = ${JSON.stringify(loadCustomNames()[nvr.id] || {})};
(function() {
  function getCustomNames() {
    try {
      var stored = JSON.parse(localStorage.getItem('vosctv_camera_names_' + window.__VOSCTV_NVR_ID) || '{}');
      return Object.assign({}, window.__VOSCTV_INITIAL_NAMES || {}, stored);
    } catch(e) { return window.__VOSCTV_INITIAL_NAMES || {}; }
  }
  function saveCustomNames(map) {
    try {
      localStorage.setItem('vosctv_camera_names_' + window.__VOSCTV_NVR_ID, JSON.stringify(map));
    } catch(e) {}
    fetch('/api/camera-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nvrId: window.__VOSCTV_NVR_ID, names: map })
    }).catch(function(){});
  }

  // Hook Dahua's internal channel title formatter so it displays custom names directly
  var __harvested = {};
  window.__vosctvChMap = window.__vosctvChMap || {};
  window.__vosctvName = function(chIndex, defaultTitle) {
    var ch = chIndex + 1;
    var rawTitle = (defaultTitle || "").trim();
    if (rawTitle) {
      window.__vosctvChMap[rawTitle.toLowerCase()] = ch;
      if (!__harvested[ch]) {
        __harvested[ch] = rawTitle;
        fetch("/api/sync-camera-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nvrId: window.__VOSCTV_NVR_ID, channel: ch, defaultName: rawTitle })
        }).catch(function(){});
      }
    }
    var custom = getCustomNames()[ch];
    if (custom) {
      window.__vosctvChMap[custom.toLowerCase()] = ch;
    }
    var displayName = custom || defaultTitle;
    return displayName;
  };

  // Fetch initial names from VOSCTV server
  fetch('/api/camera-names?nvrId=' + window.__VOSCTV_NVR_ID)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.names) {
        localStorage.setItem('vosctv_camera_names_' + window.__VOSCTV_NVR_ID, JSON.stringify(data.names));
        Object.keys(data.names).forEach(function(c) {
          if (data.names[c]) window.__vosctvChMap[String(data.names[c]).toLowerCase()] = parseInt(c, 10);
        });
        injectPencilButtons();
      }
    }).catch(function(){});

  // Inject visible, interactive pencil buttons into the Dahua sidebar tree
  function injectPencilButtons() {
    var customNames = getCustomNames();
    var selector = '[class*="treenode"], [class*="tree-node"], [class*="node-content-wrapper"], [class*="tree-content-wrapper"], [class*="tree-title"], [role="treeitem"], li';
    var rows = document.querySelectorAll(selector);
    rows.forEach(function(row) {
      var text = (row.innerText || row.textContent || '').replace(/✏️/g, '').trim();
      var ch = row.dataset.vosctvCh;
      if (!ch) {
        if (window.__vosctvChMap && window.__vosctvChMap[text.toLowerCase()]) {
          ch = window.__vosctvChMap[text.toLowerCase()];
        } else {
          var chMatch = text.match(/(?:CAM|Channel|CH|D|A)\\s*(\\d+)/i);
          if (chMatch) ch = parseInt(chMatch[1], 10);
        }
      }
      if (!ch) return;
      row.dataset.vosctvCh = ch;

      var targetWrap = row.querySelector('[class*="content-wrapper"], [class*="title"], span') || row;

      // If custom name is set and not yet applied to text, update it
      if (customNames[ch]) {
        var titleNode = targetWrap.querySelector('[class*="title"]') || targetWrap;
        if (titleNode && titleNode.dataset.vosctvCustom !== customNames[ch]) {
          var pencil = titleNode.querySelector('.vosctv-edit-pencil');
          var labelText = 'D' + ch + ' ' + customNames[ch];
          var innerSpan = titleNode.querySelector('span:not(.vosctv-edit-pencil)');
          if (innerSpan) {
            innerSpan.textContent = labelText;
          } else {
            var updated = false;
            titleNode.childNodes.forEach(function(node) {
              if (node.nodeType === 3 && node.textContent.trim()) {
                node.textContent = labelText;
                updated = true;
              }
            });
            if (!updated) {
              titleNode.textContent = labelText;
            }
          }
          titleNode.dataset.vosctvCustom = customNames[ch];
          titleNode.title = labelText;
          if (pencil && !titleNode.contains(pencil)) titleNode.appendChild(pencil);
        }
      }

      // Append visible pencil edit button if not already present
      if (!targetWrap.querySelector('.vosctv-edit-pencil')) {
        var btn = document.createElement('span');
        btn.className = 'vosctv-edit-pencil';
        btn.textContent = ' ✏️';
        btn.title = 'Click to rename Camera ' + ch;
        btn.style.cssText = 'cursor:pointer;opacity:0.65;font-size:12px;margin-left:6px;user-select:none;display:inline-block;transition:all 0.15s;vertical-align:middle;';
        btn.onmouseenter = function() { btn.style.opacity = '1'; btn.style.transform = 'scale(1.2)'; };
        btn.onmouseleave = function() { btn.style.opacity = '0.65'; btn.style.transform = 'scale(1)'; };
        btn.onclick = function(e) {
          e.preventDefault();
          e.stopPropagation();
          promptRenameCamera(parseInt(ch, 10), row);
        };
        targetWrap.appendChild(btn);
      }
    });
  }

  // Double-click or pencil click to rename camera in sidebar
  document.addEventListener('dblclick', handleTreeRename, true);
  document.addEventListener('click', function(e) {
    var txt = e.target.textContent || '';
    if (txt.includes('✏️') || (e.target && e.target.classList && e.target.classList.contains('vosctv-edit-pencil')) || (e.target && e.target.title && e.target.title.includes('rename'))) {
      handleTreeRename(e);
    }
  }, true);

  function handleTreeRename(e) {
    var target = e.target;
    if (!target) return;
    if (target.classList && (target.classList.contains('ant-tree-switcher') || target.classList.contains('ant-tree-checkbox'))) return;

    var el = target;
    var ch = null;
    var matchedRow = null;

    for (var depth = 0; depth < 8 && el && el !== document.body; depth++) {
      if (el.dataset && el.dataset.vosctvCh) {
        ch = parseInt(el.dataset.vosctvCh, 10);
        matchedRow = el;
        break;
      }
      var t = (el.innerText || el.textContent || '').replace(/✏️/g, '').trim();
      if (window.__vosctvChMap && window.__vosctvChMap[t.toLowerCase()]) {
        ch = window.__vosctvChMap[t.toLowerCase()];
        matchedRow = el;
        break;
      }
      var m = t.match(/(?:CAM|Channel|CH|D|A)\\s*(\\d+)/i);
      if (m) {
        ch = parseInt(m[1], 10);
        matchedRow = el;
        break;
      }
      el = el.parentElement;
    }

    if (!ch) return;

    e.preventDefault();
    e.stopPropagation();
    promptRenameCamera(ch, matchedRow || target);
  }

  // Prompt user for new name and update in-place without page reload
  function promptRenameCamera(ch, rowElement) {
    var currentNames = getCustomNames();
    var currentText = rowElement ? (rowElement.innerText || rowElement.textContent) : '';
    var currentName = currentNames[ch] || currentText.replace(/✏️/g, '').trim() || ('Camera ' + ch);

    var newName = prompt('Enter new name for Camera ' + ch + ':', currentName);
    if (newName === null) return;
    newName = newName.trim();
    if (!newName || newName === currentName) return;

    // 1. Send authenticated rename to VOSCTV backend (updates NVR hardware ChannelTitle + VideoWidget)
    function dispatchRename(url) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nvrId: window.__VOSCTV_NVR_ID,
          channel: ch,
          name: newName
        })
      });
    }

    dispatchRename('/api/rename-nvr-camera')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        console.log('[VOSCTV] NVR rename response:', data);
      })
      .catch(function(err) {
        console.warn('[VOSCTV] Local proxy rename error, retrying dashboard port 8090:', err);
        var fallbackUrl = window.location.protocol + '//' + window.location.hostname + ':8090/api/rename-nvr-camera';
        dispatchRename(fallbackUrl).catch(function(){});
      });

    // 2. Option A (Local sync & instant in-place DOM update without resetting video stream)
    currentNames[ch] = newName;
    saveCustomNames(currentNames);
    if (window.__vosctvChMap) {
      window.__vosctvChMap[newName.toLowerCase()] = ch;
    }

    // Update DOM in-place smoothly
    if (rowElement) {
      var targetWrap = rowElement.classList.contains('ant-tree-node-content-wrapper')
        ? rowElement
        : (rowElement.querySelector('.ant-tree-node-content-wrapper') || rowElement.querySelector('.ant-tree-title') || rowElement);
      var titleNode = targetWrap.querySelector('.ant-tree-title') || targetWrap;
      var pencil = titleNode.querySelector('.vosctv-edit-pencil');
      var labelText = 'D' + ch + ' ' + newName;
      var innerSpan = titleNode.querySelector('span:not(.vosctv-edit-pencil)');
      if (innerSpan) {
        innerSpan.textContent = labelText;
      } else {
        var updated = false;
        titleNode.childNodes.forEach(function(node) {
          if (node.nodeType === 3 && node.textContent.trim()) {
            node.textContent = labelText;
            updated = true;
          }
        });
        if (!updated) {
          titleNode.textContent = labelText;
        }
      }
      titleNode.dataset.vosctvCustom = newName;
      titleNode.title = labelText;
      if (pencil && !titleNode.contains(pencil)) titleNode.appendChild(pencil);
    }
    injectPencilButtons();
  }

  // Continuously ensure pencil buttons are present when tree expands or updates
  setInterval(injectPencilButtons, 800);
  try {
    var observer = new MutationObserver(injectPencilButtons);
    observer.observe(document.body, { childList: true, subtree: true });
  } catch(e) {}

  // Signal parent VOSCTV window that NVR web application is active
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'vosctv:nvr_ready', nvrId: window.__VOSCTV_NVR_ID }, '*');
    }
  } catch(e) {}

  // Detect when Dahua HTML5 player canvas or preview container renders
  var __feedCheck = setInterval(function() {
    var player = document.querySelector('canvas, video, .player-container, #player, [class*="player"], [class*="preview"]');
    if (player) {
      clearInterval(__feedCheck);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'vosctv:nvr_ready', nvrId: window.__VOSCTV_NVR_ID }, '*');
        }
      } catch(e) {}
    }
  }, 400);
  setTimeout(function() { clearInterval(__feedCheck); }, 15000);
})();
</script>
</body>`;
        html = html.replace('</body>', renameScript);

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(html);
        return;
      } catch (err) {
        // Fallback to standard proxy on error
      }
    }

    // Patch /static/js/project.*.chunk.js on-the-fly so HTML5 mode never prompts for webplugin.exe and supports Open All
    if (req.url && req.url.startsWith('/static/js/project.')) {
      const cleanPath = req.url.split('?')[0];
      try {
        if (!bundleCache.has(cleanPath)) {
          const upstream = await fetch(`http://${nvr.ip}:${nvr.port}${cleanPath}`);
          const arrayBuf = await upstream.arrayBuffer();
          const rawBuf = Buffer.from(arrayBuf);
          let jsText;
          if (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b) {
            jsText = zlib.gunzipSync(rawBuf).toString('utf8');
          } else {
            jsText = rawBuf.toString('utf8');
          }
          const patchedJs = patchProjectBundle(jsText);
          bundleCache.set(cleanPath, zlib.gzipSync(Buffer.from(patchedJs, 'utf8')));
        }
        const gzOut = bundleCache.get(cleanPath);
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Encoding': 'gzip',
          'Content-Length': gzOut.length,
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(gzOut);
        return;
      } catch (err) {
        console.error(`[${nvr.id} Bundle Patch Error]:`, err.message);
      }
    }

    proxy.web(req, res);
  });

  // WebSocket support (Crucial for Dahua live Web 5.0 streaming!)
  server.on('upgrade', (req, socket, head) => {
    if (CONFIG.authEnabled && !isValidSession(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.setTimeout(0);
    socket.setNoDelay(true);
    proxy.ws(req, socket, head);
  });

  server.listen(nvr.proxyPort, '0.0.0.0', () => {
    console.log(`[Proxy Ready] ${nvr.name} -> http://0.0.0.0:${nvr.proxyPort} (Target: http://${nvr.ip}:${nvr.port})`);
  });

  proxyServers.push(server);
}

CONFIG.nvrs.forEach(createNvrProxy);

// -------------------------------------------------------------
// 2. Setup Main Dashboard Server
// -------------------------------------------------------------
// (app initialized earlier to service proxy API requests)

// Helper to test TCP connection and latency
function checkPort(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let isResolved = false;

    socket.setTimeout(timeout);

    socket.connect(port, host, () => {
      if (!isResolved) {
        isResolved = true;
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ port, open: true, latency });
      }
    });

    socket.on('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ port, open: false, latency: null, error: 'Timed out' });
      }
    });

    socket.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ port, open: false, latency: null, error: err.message });
      }
    });
  });
}

// API: Get System Configuration
app.get('/api/config', (req, res) => {
  res.json({
    dashboardPort: CONFIG.dashboardPort,
    nvrs: CONFIG.nvrs.map(n => ({
      id: n.id,
      name: n.name,
      ip: n.ip,
      webPort: n.port,
      rtspPort: n.rtspPort,
      privatePort: n.privatePort,
      proxyPort: n.proxyPort
    }))
  });
});

// API: Live Health & Status Check
app.get('/api/status', async (req, res) => {
  try {
    const statusResults = await Promise.all(
      CONFIG.nvrs.map(async (nvr) => {
        const [webCheck, rtspCheck, privateCheck] = await Promise.all([
          checkPort(nvr.ip, nvr.port),
          checkPort(nvr.ip, nvr.rtspPort),
          checkPort(nvr.ip, nvr.privatePort)
        ]);

        const isOnline = webCheck.open || rtspCheck.open || privateCheck.open;
        const latency = webCheck.latency || rtspCheck.latency || privateCheck.latency || 0;

        return {
          id: nvr.id,
          name: nvr.name,
          ip: nvr.ip,
          online: isOnline,
          latencyMs: latency,
          ports: {
            http: webCheck,
            rtsp: rtspCheck,
            dahuaPrivate: privateCheck
          },
          lastChecked: new Date().toISOString()
        };
      })
    );

    res.json({
      timestamp: new Date().toISOString(),
      nvrs: statusResults
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to inspect status', details: err.message });
  }
});

// API: Dahua PTZ CGI Command Relay
app.post('/api/ptz', async (req, res) => {
  const { nvrId, channel = 1, code = 'Up', arg1 = 0, arg2 = 5, arg3 = 0, action = 'start', auth } = req.body;
  const nvr = CONFIG.nvrs.find(n => n.id === nvrId);

  if (!nvr) {
    return res.status(404).json({ error: 'NVR not found' });
  }

  const cgiUrl = `http://${nvr.ip}:${nvr.port}/cgi-bin/ptz.cgi?action=${action}&channel=${channel}&code=${code}&arg1=${arg1}&arg2=${arg2}&arg3=${arg3}`;
  
  try {
    const username = (auth && auth.username) || nvr.username;
    const password = (auth && auth.password) || nvr.password;
    const nvrRes = await dahuaDigestRequest(cgiUrl, username, password);
    res.json({
      success: nvrRes.status === 200,
      status: nvrRes.status,
      nvr: nvr.ip,
      channel,
      command: code,
      response: nvrRes.body.trim()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispatch PTZ command', details: err.message });
  }
});

// API: Automatically sync/pull camera names discovered from NVR stream
app.post('/api/sync-camera-name', (req, res) => {
  const { nvrId, channel, defaultName } = req.body;
  if (!nvrId || !channel || !defaultName) return res.status(400).end();
  const data = loadCustomNames();
  if (!data[nvrId]) data[nvrId] = {};
  if (!data[nvrId][channel]) {
    data[nvrId][channel] = defaultName;
    saveCustomNames(data);
  }
  res.json({ success: true, name: data[nvrId][channel] });
});

// API: Get custom camera names
app.get('/api/camera-names', (req, res) => {
  const { nvrId } = req.query;
  const data = loadCustomNames();
  if (nvrId) {
    return res.json({ nvrId, names: data[nvrId] || {} });
  }
  res.json(data);
});

// API: Save custom camera names (Option A fallback)
app.post('/api/camera-names', (req, res) => {
  const { nvrId, names } = req.body;
  if (!nvrId || !names) {
    return res.status(400).json({ error: 'Missing nvrId or names' });
  }
  const data = loadCustomNames();
  data[nvrId] = { ...(data[nvrId] || {}), ...names };
  saveCustomNames(data);
  res.json({ success: true, names: data[nvrId] });
});

// -------------------------------------------------------------
// NVR Playback & Recording APIs (Direct Hard-Drive Storage Access)
// -------------------------------------------------------------

// API: Search NVR recorded video blocks via Dahua mediaFileFind.cgi
app.get('/api/playback/recordings', async (req, res) => {
  const { nvrId, channel = 1, date, startTime, endTime } = req.query;
  const nvr = CONFIG.nvrs.find(n => n.id === nvrId);
  if (!nvr) return res.status(404).json({ error: 'NVR not found' });

  const chNum = parseInt(channel, 10) || 1;
  const queryDate = date || new Date().toISOString().split('T')[0];
  const queryStart = startTime ? `${queryDate} ${startTime}` : `${queryDate} 00:00:00`;
  const queryEnd = endTime ? `${queryDate} ${endTime}` : `${queryDate} 23:59:59`;

  const user = nvr.username;
  const pass = nvr.password;
  const baseUrl = `http://${nvr.ip}:${nvr.port}`;

  let session = null;
  try {
    // 1. Create finder session on Dahua NVR
    const createRes = await dahuaDigestRequest(`${baseUrl}/cgi-bin/mediaFileFind.cgi?action=factory.create`, user, pass);
    const sessionMatch = createRes.body.match(/result=(\d+)/i) || createRes.body.match(/session=(\d+)/i);
    if (!sessionMatch) {
      return res.status(502).json({ error: 'Failed to create NVR file search session', details: createRes.body });
    }
    session = sessionMatch[1];

    // 2. Set search condition (channel index is chNum)
    const findUrl = `${baseUrl}/cgi-bin/mediaFileFind.cgi?action=findFile&object=${session}&condition.Channel=${chNum}&condition.StartTime=${encodeURIComponent(queryStart)}&condition.EndTime=${encodeURIComponent(queryEnd)}&condition.Types[0]=dav`;
    const findRes = await dahuaDigestRequest(findUrl, user, pass);
    if (findRes.status !== 200 || !findRes.body.includes('OK')) {
      return res.status(502).json({ error: 'NVR findFile search failed', details: findRes.body });
    }

    // 3. Query found recording files (fetch up to 128 blocks to cover full 24-hour day)
    const nextUrl = `${baseUrl}/cgi-bin/mediaFileFind.cgi?action=findNextFile&object=${session}&count=128`;
    const nextRes = await dahuaDigestRequest(nextUrl, user, pass);

    const recordings = [];
    if (nextRes.status === 200 && nextRes.body) {
      const items = {};
      nextRes.body.split('\n').forEach(line => {
        const m = line.trim().match(/items\[(\d+)\]\.(.*)=(.*)/);
        if (m) {
          const idx = parseInt(m[1], 10);
          const key = m[2];
          const val = m[3];
          if (!items[idx]) items[idx] = {};
          if (key.startsWith('Flags[')) {
            if (!items[idx].flags) items[idx].flags = [];
            items[idx].flags.push(val);
          } else {
            items[idx][key] = val;
          }
        }
      });

      Object.keys(items).forEach(idx => {
        const item = items[idx];
        const bytes = parseInt(item.Length || item.CutLength || '0', 10);
        const sTime = item.StartTime || '';
        const eTime = item.EndTime || '';
        let durationSec = 0;
        try {
          if (sTime && eTime) {
            durationSec = Math.max(0, Math.round((new Date(eTime.replace(' ', 'T')).getTime() - new Date(sTime.replace(' ', 'T')).getTime()) / 1000));
          }
        } catch (e) {}

        recordings.push({
          index: parseInt(idx, 10),
          channel: chNum,
          startTime: sTime,
          endTime: eTime,
          durationSec,
          sizeBytes: bytes,
          sizeMb: (bytes / (1024 * 1024)).toFixed(1),
          type: item.Type || 'dav',
          stream: item.VideoStream || 'Main',
          flags: item.flags || ['Timing'],
          filePath: item.FilePath || ''
        });
      });
    }

    // Sort chronologically ascending
    recordings.sort((a, b) => (a.startTime > b.startTime ? 1 : -1));

    res.json({
      success: true,
      nvrId,
      channel: chNum,
      date: queryDate,
      startTime: queryStart,
      endTime: queryEnd,
      count: recordings.length,
      recordings
    });
  } catch (err) {
    res.status(500).json({ error: 'NVR playback query failed', details: err.message });
  } finally {
    if (session) {
      dahuaDigestRequest(`${baseUrl}/cgi-bin/mediaFileFind.cgi?action=close&object=${session}`, user, pass).catch(() => {});
      dahuaDigestRequest(`${baseUrl}/cgi-bin/mediaFileFind.cgi?action=destroy&object=${session}`, user, pass).catch(() => {});
    }
  }
});

// API: Register dynamic Dahua NVR playback RTSP stream in go2rtc
app.post('/api/playback/start-stream', async (req, res) => {
  const { nvrId, channel = 1, startTime, endTime, subtype = 0, oldStreamId } = req.body;
  const nvr = CONFIG.nvrs.find(n => n.id === nvrId);
  if (!nvr) return res.status(404).json({ error: 'NVR not found' });

  // Format start & end times into Dahua RTSP format: YYYY_MM_DD_HH_MM_SS
  let startFormatted = String(startTime || '');
  let endFormatted = String(endTime || '');

  if (startFormatted.includes('-') || startFormatted.includes(':') || startFormatted.includes(' ')) {
    startFormatted = startFormatted.replace(/[- :]/g, '_');
  }
  if (endFormatted.includes('-') || endFormatted.includes(':') || endFormatted.includes(' ')) {
    endFormatted = endFormatted.replace(/[- :]/g, '_');
  }

  // Ensure trailing seconds if format was YYYY_MM_DD_HH_MM
  if (startFormatted.split('_').length === 5) startFormatted += '_00';
  if (endFormatted.split('_').length === 5) endFormatted += '_00';

  const user = encodeURIComponent(nvr.username);
  const pass = encodeURIComponent(nvr.password);
  const ip = nvr.ip;
  const port = nvr.rtspPort || 554;
  const ch = parseInt(channel, 10) || 1;
  // Dahua NVR hard-drives record only Main Stream (subtype 0); default strictly to 0
  const sub = parseInt(subtype, 10) === 1 ? 1 : 0;

  const rtspUrl = `rtsp://${user}:${pass}@${ip}:${port}/cam/playback?channel=${ch}&subtype=${sub}&starttime=${startFormatted}&endtime=${endFormatted}#backchannel=0`;
  const streamId = `playback_${nvrId}_ch${ch}_${Date.now()}`;
  const go2rtcPort = go2rtcManager.GO2RTC_PORT || 1984;

  // Cleanup old playback stream in go2rtc if provided to prevent orphaned RTSP sessions
  if (oldStreamId) {
    try {
      const delUrl = `http://127.0.0.1:${go2rtcPort}/api/streams?name=${encodeURIComponent(oldStreamId)}`;
      const delReq = http.request(delUrl, { method: 'DELETE', timeout: 2000 }, (delRes) => delRes.resume());
      delReq.on('error', () => {});
      delReq.end();
    } catch (e) {}
  }

  try {
    const putUrl = `http://127.0.0.1:${go2rtcPort}/api/streams?name=${encodeURIComponent(streamId)}&src=${encodeURIComponent(rtspUrl)}`;
    const putReq = http.request(putUrl, { method: 'PUT', timeout: 5000 }, (putRes) => {
      putRes.resume();
      res.json({
        success: true,
        streamId,
        nvrId,
        channel: ch,
        subtype: sub,
        startTime: startFormatted,
        endTime: endFormatted
      });
    });
    putReq.on('error', (err) => {
      console.warn('[VOSCTV] Failed to register playback stream in go2rtc:', err.message);
      res.status(502).json({ error: 'Failed to register playback stream in go2rtc', details: err.message });
    });
    putReq.end();
  } catch (err) {
    res.status(500).json({ error: 'Playback stream initialization failed', details: err.message });
  }
});

// API: Stop/Unregister dynamic playback stream
app.post('/api/playback/stop-stream', (req, res) => {
  const { streamId } = req.body;
  if (!streamId) return res.status(400).json({ error: 'streamId required' });

  try {
    const go2rtcPort = go2rtcManager.GO2RTC_PORT || 1984;
    const deleteUrl = `http://127.0.0.1:${go2rtcPort}/api/streams?name=${encodeURIComponent(streamId)}`;
    const delReq = http.request(deleteUrl, { method: 'DELETE', timeout: 3000 }, (delRes) => {
      delRes.resume();
      res.json({ success: true, streamId });
    });
    delReq.on('error', () => {
      res.json({ success: true, streamId }); // Non-critical cleanup
    });
    delReq.end();
  } catch (e) {
    res.json({ success: true, streamId });
  }
});

// -------------------------------------------------------------
// Camera Hardware Capabilities (PTZ, Audio) Probing & Cache
// -------------------------------------------------------------
let cameraCapabilitiesCache = null;
let lastCapsCheck = 0;
let probingCapabilitiesPromise = null;

async function probeCameraCapabilities() {
  if (probingCapabilitiesPromise) return probingCapabilitiesPromise;

  probingCapabilitiesPromise = (async () => {
    const caps = { nvr1: {}, nvr2: {} };

    // Parallelize capabilities probing across both NVRs and requests
    await Promise.all(
      CONFIG.nvrs.map(async (nvr) => {
        caps[nvr.id] = {};
        const audioMap = {};
        const ptzMap = {};

        const [encodeRes, ptzRes] = await Promise.all([
          dahuaDigestRequest(
            `http://${nvr.ip}:${nvr.port}/cgi-bin/configManager.cgi?action=getConfig&name=Encode`,
            nvr.username,
            nvr.password
          ).catch(() => ({ body: '' })),
          dahuaDigestRequest(
            `http://${nvr.ip}:${nvr.port}/cgi-bin/configManager.cgi?action=getConfig&name=Ptz`,
            nvr.username,
            nvr.password
          ).catch(() => ({ body: '' }))
        ]);

        if (encodeRes && encodeRes.body) {
          encodeRes.body.split('\n').forEach(line => {
            const m = line.trim().match(/table\.Encode\[(\d+)\]\.MainFormat\[0\]\.AudioEnable=(.*)/);
            if (m) {
              const ch = parseInt(m[1], 10) + 1;
              audioMap[ch] = m[2].trim().toLowerCase() === 'true';
            }
          });
        }

        if (ptzRes && ptzRes.body) {
          ptzRes.body.split('\n').forEach(line => {
            const m = line.trim().match(/table\.Ptz\[(\d+)\]\.ProtocolName=(.*)/);
            if (m) {
              const ch = parseInt(m[1], 10) + 1;
              const proto = m[2].trim().toUpperCase();
              ptzMap[ch] = proto !== 'NONE' && proto !== '';
            }
          });
        }

        for (let ch = 1; ch <= 32; ch++) {
          caps[nvr.id][ch] = {
            ptz: ptzMap[ch] === true,
            audio: audioMap[ch] !== undefined ? audioMap[ch] : true
          };
        }
        const ptzCount = Object.values(caps[nvr.id]).filter(c => c.ptz).length;
        console.log(`[VOSCTV] Probed ${nvr.name} capabilities: ${ptzCount} true PTZ-configured channels detected.`);
      })
    );

    cameraCapabilitiesCache = caps;
    lastCapsCheck = Date.now();
    return caps;
  })().finally(() => {
    probingCapabilitiesPromise = null;
  });

  return probingCapabilitiesPromise;
}

// API: Camera Capabilities (PTZ, Audio)
app.get('/api/camera-capabilities', async (req, res) => {
  try {
    if (req.query.refresh === 'true' || !cameraCapabilitiesCache || Date.now() - lastCapsCheck > 3600000) {
      await probeCameraCapabilities();
    }
    res.json(cameraCapabilitiesCache);
  } catch(err) {
    res.status(500).json({ error: 'Failed to inspect capabilities', details: err.message });
  }
});

// API: Force refresh camera names directly from NVRs
app.post('/api/sync-nvr-names', async (req, res) => {
  try {
    const data = await syncOfficialNvrNames();
    res.json({ success: true, names: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Rename Camera on NVR directly (authenticated Dahua CGI)
app.post('/api/rename-nvr-camera', async (req, res) => {
  const { nvrId, channel, name } = req.body;
  const nvr = CONFIG.nvrs.find(n => n.id === nvrId);
  if (!nvr) return res.status(404).json({ error: 'NVR not found' });

  // 1. Save to local storage for instant sync across all viewers
  const localData = loadCustomNames();
  if (!localData[nvrId]) localData[nvrId] = {};
  localData[nvrId][channel] = name;
  saveCustomNames(localData);

  // 2. Write to NVR firmware directly using authenticated Digest Auth
  const chIdx = Math.max(0, parseInt(channel, 10) - 1);
  const encodedName = encodeURIComponent(name);
  const nvrUrlTitle = `http://${nvr.ip}:${nvr.port}/cgi-bin/configManager.cgi?action=setConfig&ChannelTitle[${chIdx}].Name=${encodedName}`;
  const nvrUrlWidget = `http://${nvr.ip}:${nvr.port}/cgi-bin/configManager.cgi?action=setConfig&VideoWidget[${chIdx}].ChannelTitle.ChannelName=${encodedName}`;

  try {
    const titleRes = await dahuaDigestRequest(nvrUrlTitle, nvr.username, nvr.password);
    console.log(`[VOSCTV] NVR ${nvrId} rename ChannelTitle[${chIdx}] -> "${name}" result:`, titleRes.status, titleRes.body.trim());

    // Also update VideoWidget OSD title if supported by this channel
    try {
      const widgetRes = await dahuaDigestRequest(nvrUrlWidget, nvr.username, nvr.password);
      console.log(`[VOSCTV] NVR ${nvrId} rename VideoWidget[${chIdx}] -> "${name}" result:`, widgetRes.status, widgetRes.body.trim());
    } catch(e) {}

    return res.json({
      success: true,
      nvrStatus: titleRes.status,
      nvrResponse: titleRes.body.trim(),
      channel,
      name,
      savedToNvr: titleRes.status === 200,
      savedLocally: true
    });
  } catch (err) {
    console.warn('[VOSCTV] NVR direct rename error, local alias preserved:', err.message);
    return res.json({
      success: true,
      nvrError: err.message,
      channel,
      name,
      savedLocally: true,
      fallbackUsed: true
    });
  }
});

// Start dashboard server
const dashboardServer = app.listen(CONFIG.dashboardPort, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`[VOSCTV NVR DASHBOARD] Running at http://localhost:${CONFIG.dashboardPort}`);
  console.log(`- Authentication: ${CONFIG.authEnabled ? 'ENABLED (Dashboard login enforced)' : 'DISABLED (Kiosk mode)'}`);
  console.log(`- NVR 1 (${CONFIG.nvrs[0].ip}) Proxy: http://localhost:${CONFIG.nvrs[0].proxyPort}`);
  console.log(`- NVR 2 (${CONFIG.nvrs[1].ip}) Proxy: http://localhost:${CONFIG.nvrs[1].proxyPort}`);
  console.log(`- WebRTC GPU Stream Gateway: Enabled via go2rtc`);
  console.log(`====================================================`);
  // Initialize Directus connection and pull credentials
  directusClient.init().catch(e => console.warn('[Directus] Initialization warning:', e.message));

  syncOfficialNvrNames().catch(() => {});
  probeCameraCapabilities().catch(() => {});

  // Setup go2rtc WebRTC GPU Bridge
  try {
    go2rtcManager.setupGo2rtcProxy(app, dashboardServer, isValidSession);
    go2rtcManager.startGo2rtc(CONFIG.nvrs);
  } catch (err) {
    console.warn('[go2rtc] Initialization warning:', err.message);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down servers...');
  try { directusClient.stop(); } catch (e) {}
  try { go2rtcManager.stopGo2rtc(); } catch (e) {}
  dashboardServer.close();
  proxyServers.forEach(s => s.close());
  process.exit(0);
});
