const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const localtunnel = require('localtunnel');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sites.json');

// Tunnel state shared with the status API
let tunnelUrl = null;
let tunnelStatus = 'connecting'; // 'connecting' | 'online' | 'offline'

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /\n');
});

app.use(express.static(path.join(__dirname, 'public')));

function loadSites() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSites(sites) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(sites, null, 2));
}

function normalizeSourceUrl(url) {
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url.replace(/\/$/, '');
}

function validateSourceUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    return host.endsWith('.netlify.app') || host.endsWith('.github.io');
  } catch {
    return false;
  }
}

function validateTargetDomain(domain) {
  domain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return /^([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain);
}

function fetchSiteTitle(sourceUrl) {
  return new Promise((resolve) => {
    const protocol = sourceUrl.startsWith('https') ? https : http;
    const req = protocol.get(sourceUrl, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const match = data.match(/<title[^>]*>([^<]+)<\/title>/i);
        resolve(match ? match[1].trim() : null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// API: tunnel status
app.get('/api/tunnel', (req, res) => {
  res.json({ url: tunnelUrl, status: tunnelStatus });
});

// API: list all sites
app.get('/api/sites', (req, res) => {
  res.json(loadSites());
});

// API: add a new site
app.post('/api/sites', async (req, res) => {
  const { sourceUrl: rawSource, targetDomain: rawTarget } = req.body;

  if (!rawSource || !rawTarget) {
    return res.status(400).json({ error: 'sourceUrl and targetDomain are required.' });
  }

  const sourceUrl = normalizeSourceUrl(rawSource);
  const targetDomain = rawTarget.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

  if (!validateSourceUrl(sourceUrl)) {
    return res.status(400).json({ error: 'Source URL must be a .netlify.app or .github.io address.' });
  }

  if (!validateTargetDomain(targetDomain)) {
    return res.status(400).json({ error: 'Invalid target domain format.' });
  }

  const sites = loadSites();

  if (sites.some(s => s.targetDomain === targetDomain)) {
    return res.status(409).json({ error: 'That target domain is already registered.' });
  }

  const title = await fetchSiteTitle(sourceUrl);

  const site = {
    id: uuidv4(),
    sourceUrl,
    targetDomain,
    title: title || new URL(sourceUrl).hostname,
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  sites.push(site);
  saveSites(sites);

  res.status(201).json(site);
});

// API: delete a site
app.delete('/api/sites/:id', (req, res) => {
  const sites = loadSites();
  const idx = sites.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Site not found.' });
  const [removed] = sites.splice(idx, 1);
  saveSites(sites);
  res.json(removed);
});

// API: get nginx config for a site
app.get('/api/sites/:id/nginx', (req, res) => {
  const sites = loadSites();
  const site = sites.find(s => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found.' });

  const sourceHost = new URL(site.sourceUrl).hostname;
  const config = `server {
    listen 80;
    server_name ${site.targetDomain} www.${site.targetDomain};

    location / {
        proxy_pass ${site.sourceUrl};
        proxy_set_header Host ${sourceHost};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_server_name on;

        sub_filter '${sourceHost}' '${site.targetDomain}';
        sub_filter_once off;
        sub_filter_types text/html text/css text/javascript application/javascript;
    }
}

server {
    listen 80;
    server_name www.${site.targetDomain};
    return 301 http://${site.targetDomain}$request_uri;
}`;

  res.json({ config });
});

// Live proxy: forward requests based on Host header
app.use((req, res, next) => {
  const host = req.hostname;
  const sites = loadSites();
  const site = sites.find(s => s.targetDomain === host || `www.${s.targetDomain}` === host);

  if (!site) return next();

  const proxy = createProxyMiddleware({
    target: site.sourceUrl,
    changeOrigin: true,
    secure: true,
    on: {
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(502).send('Bad Gateway: could not reach ' + site.sourceUrl);
      },
    },
  });

  proxy(req, res, next);
});

// Start server then open tunnel
app.listen(PORT, async () => {
  console.log(`Website Deployer running on http://localhost:${PORT}`);

  if (process.env.NO_TUNNEL) return;

  async function openTunnel() {
    try {
      tunnelStatus = 'connecting';
      const tunnel = await localtunnel({ port: PORT });
      tunnelUrl = tunnel.url;
      tunnelStatus = 'online';
      console.log(`Public URL: ${tunnel.url}`);

      tunnel.on('close', () => {
        console.log('Tunnel closed, reconnecting...');
        tunnelStatus = 'offline';
        tunnelUrl = null;
        setTimeout(openTunnel, 3000);
      });

      tunnel.on('error', (err) => {
        console.error('Tunnel error:', err.message);
        tunnelStatus = 'offline';
        tunnelUrl = null;
        setTimeout(openTunnel, 5000);
      });
    } catch (err) {
      console.error('Could not open tunnel:', err.message);
      tunnelStatus = 'offline';
      setTimeout(openTunnel, 10000);
    }
  }

  openTunnel();
});
