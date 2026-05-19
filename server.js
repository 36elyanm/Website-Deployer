const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sites.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSites() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function saveSites(sites) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(sites, null, 2));
}

function loadConfig() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function saveConfig(cfg) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63) || 'my-site';
}

async function cfFetch(path, token, opts = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  });
  return res.json();
}

async function ensurePagesProject(projectName, accountId, token) {
  const existing = await cfFetch(`/accounts/${accountId}/pages/projects/${projectName}`, token);
  if (existing.success) return existing.result;

  const created = await cfFetch(`/accounts/${accountId}/pages/projects`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: projectName, production_branch: 'main' }),
  });

  if (!created.success) throw new Error(created.errors?.[0]?.message || 'Failed to create project');
  return created.result;
}

async function deployFiles(projectName, accountId, token, files) {
  // files: [{path: '/index.html', content: Buffer}, ...]
  const manifest = {};
  for (const file of files) {
    const hash = crypto.createHash('sha256').update(file.content).digest('hex');
    file.hash = hash;
    manifest[file.path] = hash;
  }

  const boundary = `----FormBoundary${crypto.randomBytes(16).toString('hex')}`;
  const parts = [];

  const addField = (name, value, contentType = 'application/octet-stream', filename = null) => {
    const cd = filename
      ? `Content-Disposition: form-data; name="${name}"; filename="${filename}"`
      : `Content-Disposition: form-data; name="${name}"`;
    const ct = `Content-Type: ${contentType}`;
    parts.push(Buffer.from(`--${boundary}\r\n${cd}\r\n${ct}\r\n\r\n`));
    parts.push(typeof value === 'string' ? Buffer.from(value) : value);
    parts.push(Buffer.from('\r\n'));
  };

  addField('manifest', JSON.stringify(manifest), 'application/json');
  for (const file of files) {
    const fname = file.path.replace(/^\//, '');
    addField(file.hash, file.content, 'application/octet-stream', fname);
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    }
  );
  return res.json();
}

// ── Config API ────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  res.json({ accountId: cfg.accountId || '', hasToken: !!cfg.token });
});

app.post('/api/config', (req, res) => {
  const { accountId, token } = req.body;
  if (!accountId || !token) return res.status(400).json({ error: 'accountId and token are required.' });
  saveConfig({ accountId: accountId.trim(), token: token.trim() });
  res.json({ ok: true });
});

app.post('/api/config/verify', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.token || !cfg.accountId) return res.status(400).json({ error: 'No credentials saved.' });
  try {
    const result = await cfFetch(`/accounts/${cfg.accountId}/pages/projects?per_page=1`, cfg.token);
    if (result.success) return res.json({ ok: true });
    return res.status(401).json({ error: result.errors?.[0]?.message || 'Invalid credentials.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sites API ─────────────────────────────────────────────────────────────────

app.get('/api/sites', (req, res) => res.json(loadSites()));

app.patch('/api/sites/:id', (req, res) => {
  const { displayName } = req.body;
  const sites = loadSites();
  const site = sites.find(s => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: 'Not found.' });
  if (displayName) site.displayName = displayName.trim().slice(0, 80);
  saveSites(sites);
  res.json(site);
});

app.post('/api/sites/:id/domain', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.token || !cfg.accountId) return res.status(400).json({ error: 'No credentials configured.' });

  const sites = loadSites();
  const site = sites.find(s => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found.' });

  const domain = (req.body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain) return res.status(400).json({ error: 'domain is required.' });

  const result = await cfFetch(
    `/accounts/${cfg.accountId}/pages/projects/${site.projectName}/domains`,
    cfg.token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: domain }),
    }
  );

  if (!result.success) {
    const msg = result.errors?.[0]?.message || 'Failed to attach domain.';
    return res.status(400).json({ error: msg });
  }

  site.customDomain = domain;
  site.customDomainStatus = result.result?.status || 'pending';
  saveSites(sites);
  res.json(site);
});

app.delete('/api/sites/:id', (req, res) => {
  const sites = loadSites();
  const idx = sites.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found.' });
  const [removed] = sites.splice(idx, 1);
  saveSites(sites);
  res.json(removed);
});

// ── Deploy API ────────────────────────────────────────────────────────────────

app.post('/api/deploy', upload.fields([
  { name: 'files', maxCount: 500 },
  { name: 'zip', maxCount: 1 },
]), async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.token || !cfg.accountId) {
    return res.status(400).json({ error: 'Cloudflare credentials not configured. Set them in Settings first.' });
  }

  const siteName = (req.body.siteName || 'my-site').trim();
  const projectName = slugify(siteName);
  const customDomain = (req.body.customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

  let files = [];

  // Handle zip upload
  if (req.files?.zip?.[0]) {
    try {
      const zip = new AdmZip(req.files.zip[0].buffer);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        let entryPath = entry.entryName.replace(/^[^/]+\//, ''); // strip top-level folder
        if (!entryPath) continue;
        files.push({ path: '/' + entryPath, content: entry.getData() });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Could not read zip file: ' + err.message });
    }
  }

  // Handle individual file uploads
  if (req.files?.files?.length) {
    for (const f of req.files.files) {
      const filePath = '/' + (f.originalname || 'index.html');
      files.push({ path: filePath, content: f.buffer });
    }
  }

  if (files.length === 0) {
    return res.status(400).json({ error: 'No files provided.' });
  }

  // Ensure there is an index.html at root
  const hasIndex = files.some(f => f.path === '/index.html');
  if (!hasIndex) {
    // Try to find any .html file and rename to index.html if only one
    const htmlFiles = files.filter(f => f.path.endsWith('.html'));
    if (htmlFiles.length === 1) {
      htmlFiles[0].path = '/index.html';
    }
  }

  try {
    await ensurePagesProject(projectName, cfg.accountId, cfg.token);
    const deployment = await deployFiles(projectName, cfg.accountId, cfg.token, files);

    if (!deployment.success) {
      const errMsg = deployment.errors?.[0]?.message || JSON.stringify(deployment.errors);
      return res.status(500).json({ error: 'Cloudflare deploy failed: ' + errMsg });
    }

    const pagesUrl = deployment.result?.url || `https://${projectName}.pages.dev`;

    // Attach custom domain if provided
    let customDomainStatus = null;
    if (customDomain) {
      const domainRes = await cfFetch(
        `/accounts/${cfg.accountId}/pages/projects/${projectName}/domains`,
        cfg.token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: customDomain }),
        }
      );
      if (domainRes.success) {
        customDomainStatus = domainRes.result?.status || 'pending';
      } else {
        // Non-fatal: report but still return success
        const msg = domainRes.errors?.[0]?.message || 'Unknown error';
        customDomainStatus = `error: ${msg}`;
      }
    }

    const site = {
      id: uuidv4(),
      displayName: siteName,
      projectName,
      url: pagesUrl,
      customDomain: customDomain || null,
      customDomainStatus,
      deploymentId: deployment.result?.id,
      fileCount: files.length,
      createdAt: new Date().toISOString(),
    };

    const sites = loadSites();
    // Update existing entry for same project, or add new
    const existingIdx = sites.findIndex(s => s.projectName === projectName);
    if (existingIdx !== -1) {
      site.id = sites[existingIdx].id;
      sites[existingIdx] = site;
    } else {
      sites.unshift(site);
    }
    saveSites(sites);

    res.status(201).json(site);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ensureDataDir();
app.listen(PORT, () => console.log(`Cloudflare Pages Deployer running on http://localhost:${PORT}`));
