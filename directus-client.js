/**
 * Directus Integration Module for VOSCCTV
 * Connects to Directus database collection 'iot_cctv_credentials'
 * Provides dynamic authentication, periodic caching, and resilient fallback.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

class DirectusCctvClient {
  constructor() {
    const rawUrl = process.env.DIRECTUS_URL || 'http://goatedcodoer:8056';
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.token = (process.env.DIRECTUS_TOKEN || 'AAKv73dkIV8DfAIA5vEt3eXVdIebzmBW').trim();
    this.collection = 'iot_cctv_credentials';
    this.cachedCredentials = [];
    this.lastSyncedAt = null;
    this.syncInterval = null;
    this.syncIntervalMs = 60000; // Auto-sync every 60 seconds
  }

  /**
   * Perform raw HTTP/HTTPS request to Directus API
   */
  async _request(method, endpoint, payload = null) {
    return new Promise((resolve) => {
      try {
        const targetUrl = new URL(endpoint, this.baseUrl);
        const isHttps = targetUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers = {
          'Accept': 'application/json'
        };

        if (this.token) {
          headers['Authorization'] = `Bearer ${this.token}`;
        }

        let dataString = null;
        if (payload) {
          headers['Content-Type'] = 'application/json';
          dataString = JSON.stringify(payload);
          headers['Content-Length'] = Buffer.byteLength(dataString);
        }

        const options = {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: method,
          headers: headers,
          timeout: 4500
        };

        const req = client.request(options, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            let parsed = null;
            try {
              parsed = body ? JSON.parse(body) : null;
            } catch (e) {
              parsed = { raw: body };
            }
            resolve({
              status: res.statusCode,
              ok: res.statusCode >= 200 && res.statusCode < 300,
              data: parsed ? parsed.data : null
            });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ status: 408, ok: false, error: 'Request Timeout' });
        });

        req.on('error', (err) => {
          resolve({ status: 0, ok: false, error: err.message });
        });

        if (dataString) {
          req.write(dataString);
        }
        req.end();
      } catch (err) {
        resolve({ status: 0, ok: false, error: err.message });
      }
    });
  }

  /**
   * Pull active CCTV credentials from Directus collection
   */
  async syncCredentials() {
    try {
      const res = await this._request('GET', `/items/${this.collection}?filter[status][_eq]=active`);
      if (res.ok && Array.isArray(res.data)) {
        this.cachedCredentials = res.data;
        this.lastSyncedAt = Date.now();
        console.log(`[Directus] Synced ${this.cachedCredentials.length} credentials from collection "${this.collection}"`);
        return this.cachedCredentials;
      } else {
        console.warn(`[Directus] Sync warning (Status ${res.status}):`, res.error || 'Unknown response');
      }
    } catch (err) {
      console.warn('[Directus] Sync exception:', err.message);
    }
    return this.cachedCredentials;
  }

  /**
   * Authenticate a user against Directus credentials
   */
  async authenticate(username, password) {
    if (!username || !password) return null;
    const cleanUser = username.trim().toLowerCase();

    // 1. Check in-memory cached credentials
    let match = this.cachedCredentials.find(
      c => (c.username || '').trim().toLowerCase() === cleanUser && c.password === password
    );

    if (match) {
      return {
        authenticated: true,
        user: match.username,
        role: match.role || 'admin',
        nvr_id: match.nvr_id,
        source: 'directus_cache'
      };
    }

    // 2. If not found in cache, perform fresh live query against Directus
    try {
      await this.syncCredentials();
      match = this.cachedCredentials.find(
        c => (c.username || '').trim().toLowerCase() === cleanUser && c.password === password
      );
      if (match) {
        return {
          authenticated: true,
          user: match.username,
          role: match.role || 'admin',
          nvr_id: match.nvr_id,
          source: 'directus_live'
        };
      }
    } catch (e) {}

    return null;
  }

  /**
   * Get specific NVR credentials by nvr_id (e.g. 'nvr1', 'nvr2')
   */
  getNvrCredentials(nvrId) {
    if (!nvrId) return null;
    return this.cachedCredentials.find(c => c.nvr_id === nvrId && c.status === 'active') || null;
  }

  /**
   * Initialize client and start background periodic synchronization
   */
  async init() {
    console.log(`[Directus] Connecting to Directus at ${this.baseUrl} (Collection: ${this.collection})`);
    await this.syncCredentials();
    if (!this.syncInterval) {
      this.syncInterval = setInterval(() => {
        this.syncCredentials().catch(() => {});
      }, this.syncIntervalMs);
      if (this.syncInterval.unref) this.syncInterval.unref();
    }
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

const directusClient = new DirectusCctvClient();
module.exports = directusClient;
