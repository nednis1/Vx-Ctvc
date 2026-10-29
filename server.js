const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const net = require('net');
const path = require('path');

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
    
    // Block local Windows OCX WebSocketServer (127.0.0.1:23420/23440/23510) so Dahua stays in pure HTML5 player mode
    proxyRes.headers['content-security-policy'] = "connect-src 'self' http: https: ws://localhost:* wss://localhost:* ws://192.168.1.200:* ws://192.168.1.181:*;";

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

  const server = http.createServer({ insecureHTTPParser: true }, (req, res) => {
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
