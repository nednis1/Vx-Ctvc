const express = require('express');
const fs = require('fs');
const http = require('http');
const httpProxy = require('http-proxy');
const net = require('net');
const path = require('path');
const zlib = require('zlib');

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
  dashboardPort: process.env.PORT || 8090,
  nvrs: [
    {
      id: 'nvr1',
      name: 'NVR 1 (Main Operations)',
      ip: process.env.NVR1_IP || '192.168.1.200',
      port: 80,
      rtspPort: 554,
      privatePort: 37777,
      proxyPort: 8091
    },
    {
      id: 'nvr2',
      name: 'NVR 2 (Secondary Operations)',
      ip: process.env.NVR2_IP || '192.168.1.181',
      port: 80,
      rtspPort: 554,
      privatePort: 37777,
      proxyPort: 8092
    }
  ]
};

// -------------------------------------------------------------
// 1. Setup Reverse Proxies for NVRs
// -------------------------------------------------------------
const proxyServers = [];

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
      );
  }

  const server = http.createServer({ insecureHTTPParser: true }, async (req, res) => {
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
          '$1?v=vosctv5"'
        );

        // Inject script that handles double-click or hover-rename on sidebar channel items
        const renameScript = `
<script>
window.__VOSCTV_NVR_ID = "${nvr.id}";
(function() {
  function getCustomNames() {
    try {
      return JSON.parse(localStorage.getItem('vosctv_camera_names_' + window.__VOSCTV_NVR_ID) || '{}');
    } catch(e) { return {}; }
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
  window.__vosctvName = function(chIndex, defaultTitle) {
    var ch = chIndex + 1;
    var rawTitle = (defaultTitle || "").trim();
    if (rawTitle && !__harvested[ch]) {
      __harvested[ch] = rawTitle;
      fetch("/api/sync-camera-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nvrId: window.__VOSCTV_NVR_ID, channel: ch, defaultName: rawTitle })
      }).catch(function(){});
    }
    var ch = chIndex + 1;
    var custom = getCustomNames()[ch];
    var displayName = custom || defaultTitle;
    return displayName + " ✏️";
  };

  // Fetch initial names from VOSCTV server
  fetch('/api/camera-names?nvrId=' + window.__VOSCTV_NVR_ID)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.names) {
        localStorage.setItem('vosctv_camera_names_' + window.__VOSCTV_NVR_ID, JSON.stringify(data.names));
      }
    }).catch(function(){});

  // Handle double-click or click anywhere on the camera label or pencil icon
  document.addEventListener('dblclick', handleTreeRename);
  document.addEventListener('click', function(e) {
    var txt = e.target.textContent || '';
    if (txt.includes('✏️') || e.target.closest('[title*="✏️"]')) {
      handleTreeRename(e);
    }
  });

  function handleTreeRename(e) {
    var target = e.target;
    var row = target.closest('li, .ant-tree-treenode, .ant-tree-node-content-wrapper, [role="treeitem"]') || target;
    var text = row.innerText || row.textContent || '';
    if (!text.includes('✏️') && !text.match(/(?:CAM|Channel|CH|D|A)\\s*\\d+/i)) return;

    var chMatch = text.match(/(?:CAM|Channel|CH|D|A)\\s*(\\d+)/i);
    if (!chMatch) return;
    var ch = parseInt(chMatch[1], 10);

    var currentNames = getCustomNames();
    var currentName = currentNames[ch] || text.replace(/✏️/g, '').trim();
    var newName = prompt('Enter new name for Camera ' + ch + ':', currentName);
    if (newName === null) return;
    newName = newName.trim();
    if (!newName) return;

    // 1. Try Option B: Send Dahua RPC or CGI to update NVR firmware directly
    fetch('/api/rename-nvr-camera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nvrId: window.__VOSCTV_NVR_ID,
        channel: ch,
        name: newName
      })
    }).then(function(res) {
      return res.json();
    }).then(function(data) {
      console.log('[VOSCTV] NVR rename response:', data);
    }).catch(function(err) {
      console.warn('[VOSCTV] NVR direct rename failed, falling back to local alias:', err);
    });

    // 2. Option A (Local fallback & instant UI update):
    currentNames[ch] = newName;
    saveCustomNames(currentNames);

    // Update the DOM element directly so changes are visible instantly
    if (target.textContent) {
      target.textContent = target.textContent.replace(currentName, newName);
    }
    window.location.reload();
  }
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
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  const { nvrId, channel = 1, code = 'Up', arg1 = 0, arg2 = 5, arg3 = 0, auth } = req.body;
  const nvr = CONFIG.nvrs.find(n => n.id === nvrId);

  if (!nvr) {
    return res.status(404).json({ error: 'NVR not found' });
  }

  const cgiUrl = `http://${nvr.ip}:${nvr.port}/cgi-bin/ptz.cgi?action=start&channel=${channel}&code=${code}&arg1=${arg1}&arg2=${arg2}&arg3=${arg3}`;
  
  try {
    const headers = {};
    if (auth && auth.username && auth.password) {
      const basic = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${basic}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(cgiUrl, { headers, signal: controller.signal });
    clearTimeout(timeoutId);

    const text = await response.text();
    res.json({
      success: response.ok,
      status: response.status,
      nvr: nvr.ip,
      channel,
      command: code,
      response: text.trim()
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

// API: Rename Camera on NVR directly (Option B with Dahua RPC/CGI)
app.post('/api/rename-nvr-camera', async (req, res) => {
  const { nvrId, channel, name } = req.body;
  const nvr = CONFIG.nvrs.find(n => n.id === nvrId);
  if (!nvr) return res.status(404).json({ error: 'NVR not found' });

  // 1. Save to local fallback storage
  const localData = loadCustomNames();
  if (!localData[nvrId]) localData[nvrId] = {};
  localData[nvrId][channel] = name;
  saveCustomNames(localData);

  // 2. Attempt to write to NVR ChannelTitle via configManager.cgi
  // Dahua syntax: /cgi-bin/configManager.cgi?action=setConfig&ChannelTitle[ch-1].Name=encodedName
  const chIdx = Math.max(0, parseInt(channel, 10) - 1);
  const encodedName = encodeURIComponent(name);
  const nvrUrl = `http://${nvr.ip}:${nvr.port}/cgi-bin/configManager.cgi?action=setConfig&ChannelTitle[${chIdx}].Name=${encodedName}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const nvrRes = await fetch(nvrUrl, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await nvrRes.text();
    return res.json({
      success: true,
      nvrStatus: nvrRes.status,
      nvrResponse: text.trim(),
      channel,
      name,
      savedLocally: true
    });
  } catch (err) {
    // Return success since local alias is stored
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
  console.log(`- NVR 1 (${CONFIG.nvrs[0].ip}) Proxy: http://localhost:${CONFIG.nvrs[0].proxyPort}`);
  console.log(`- NVR 2 (${CONFIG.nvrs[1].ip}) Proxy: http://localhost:${CONFIG.nvrs[1].proxyPort}`);
  console.log(`====================================================`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down servers...');
  dashboardServer.close();
  proxyServers.forEach(s => s.close());
  process.exit(0);
});
