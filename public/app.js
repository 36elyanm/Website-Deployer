const API = '';

// Tunnel status banner
async function pollTunnel() {
  try {
    const res = await fetch(`${API}/api/tunnel`);
    const { url, status } = await res.json();

    const dot = document.getElementById('tunnelDot');
    const statusText = document.getElementById('tunnelStatusText');
    const urlRow = document.getElementById('tunnelUrlRow');
    const urlEl = document.getElementById('tunnelUrl');
    const hint = document.getElementById('tunnelHint');

    dot.className = 'tunnel-dot ' + status;

    if (status === 'online' && url) {
      statusText.textContent = 'Public link active';
      statusText.style.color = 'var(--success)';
      urlEl.textContent = url;
      urlEl.href = url;
      urlRow.hidden = false;
      hint.textContent = 'Open this link on any device — phone, tablet, or another computer — to access the same dashboard.';
    } else if (status === 'connecting') {
      statusText.textContent = 'Getting your public link...';
      statusText.style.color = '';
      urlRow.hidden = true;
    } else {
      statusText.textContent = 'Public link offline — reconnecting';
      statusText.style.color = 'var(--danger)';
      urlRow.hidden = true;
    }
  } catch {
    // server not reachable yet
  }
}

function copyTunnelUrl() {
  const url = document.getElementById('tunnelUrl').textContent;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('tunnelCopyBtn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
  });
}

// Poll every 4 seconds so the UI stays in sync
pollTunnel();
setInterval(pollTunnel, 4000);

async function loadSites() {
  const res = await fetch(`${API}/api/sites`);
  const sites = await res.json();
  renderSites(sites);
}

function renderSites(sites) {
  const list = document.getElementById('sitesList');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('siteCount');

  count.textContent = sites.length;

  const existing = list.querySelectorAll('.site-card');
  existing.forEach(el => el.remove());

  if (sites.length === 0) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  sites.forEach(site => {
    const card = buildSiteCard(site);
    list.appendChild(card);
  });
}

function buildSiteCard(site) {
  const div = document.createElement('div');
  div.className = 'site-card';
  div.dataset.id = site.id;

  const date = new Date(site.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  div.innerHTML = `
    <div class="site-top">
      <div class="site-info">
        <div class="site-title">
          <span class="status-dot"></span>${escHtml(site.title)}
        </div>
        <div class="site-urls">
          <div class="site-url">
            <span class="label">Source</span>
            <span class="source-link">${escHtml(site.sourceUrl)}</span>
          </div>
          <div class="site-url">
            <span class="label">Domain</span>
            <span class="target-link">${escHtml(site.targetDomain)}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="site-bottom">
      <div class="site-meta">Added ${date}</div>
      <div class="site-actions">
        <button class="btn-icon primary" onclick="showInstructions('${site.id}')">Setup Guide</button>
        <button class="btn-icon danger" onclick="deleteSite('${site.id}')">Remove</button>
      </div>
    </div>
  `;
  return div;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Form submit
document.getElementById('deployForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const sourceUrl = document.getElementById('sourceUrl').value.trim();
  const targetDomain = document.getElementById('targetDomain').value.trim();
  const errEl = document.getElementById('formError');
  const btn = document.getElementById('submitBtn');
  const btnText = btn.querySelector('.btn-text');
  const btnSpinner = btn.querySelector('.btn-spinner');

  errEl.hidden = true;

  btnText.hidden = true;
  btnSpinner.hidden = false;
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/sites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl, targetDomain }),
    });

    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Something went wrong.';
      errEl.hidden = false;
      return;
    }

    document.getElementById('sourceUrl').value = '';
    document.getElementById('targetDomain').value = '';

    await loadSites();

    // Auto-open setup guide for the new site
    showInstructions(data.id);

  } catch (err) {
    errEl.textContent = 'Network error. Is the server running?';
    errEl.hidden = false;
  } finally {
    btnText.hidden = false;
    btnSpinner.hidden = true;
    btn.disabled = false;
  }
});

async function deleteSite(id) {
  if (!confirm('Remove this site deployment?')) return;

  await fetch(`${API}/api/sites/${id}`, { method: 'DELETE' });
  await loadSites();
}

async function showInstructions(siteId) {
  const sitesRes = await fetch(`${API}/api/sites`);
  const sites = await sitesRes.json();
  const site = sites.find(s => s.id === siteId);
  if (!site) return;

  const nginxRes = await fetch(`${API}/api/sites/${siteId}/nginx`);
  const { config } = await nginxRes.json();

  const sourceHost = new URL(site.sourceUrl).hostname;
  const isNetlify = sourceHost.endsWith('.netlify.app');

  document.getElementById('modalTitle').textContent = `Setup: ${site.targetDomain}`;
  document.getElementById('modalBody').innerHTML = buildInstructions(site, config, isNetlify);
  document.getElementById('modal').hidden = false;
}

function buildInstructions(site, nginxConfig, isNetlify) {
  const escaped = escHtml(nginxConfig);
  const serverIp = 'YOUR_SERVER_IP';

  return `
    <div class="step">
      <span class="step-num">1</span>
      <h4>Point your domain's DNS to this server</h4>
      <p>In your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.), add these DNS records:</p>
      <table class="dns-table">
        <thead>
          <tr><th>Type</th><th>Name</th><th>Value</th><th>TTL</th></tr>
        </thead>
        <tbody>
          <tr><td>A</td><td>@</td><td>${serverIp}</td><td>Auto</td></tr>
          <tr><td>A</td><td>www</td><td>${serverIp}</td><td>Auto</td></tr>
        </tbody>
      </table>
      <p>Replace <strong>${serverIp}</strong> with the public IP of the machine running this app.</p>
    </div>

    <hr class="divider"/>

    <div class="step">
      <span class="step-num">2</span>
      <h4>Run this app on your server on port 80</h4>
      <p>This app acts as a reverse proxy. Start it with:</p>
      <div class="code-block">
        <button class="copy-btn" onclick="copyText(this, 'PORT=80 node server.js')">Copy</button>
        PORT=80 node server.js
      </div>
      <p>Or use PM2 to keep it running in the background:</p>
      <div class="code-block">
        <button class="copy-btn" onclick="copyText(this, 'PORT=80 pm2 start server.js --name website-deployer')">Copy</button>
        PORT=80 pm2 start server.js --name website-deployer
      </div>
    </div>

    <hr class="divider"/>

    <div class="step">
      <span class="step-num">3</span>
      <h4>How the proxy works</h4>
      <p>When a visitor opens <strong>${site.targetDomain}</strong>, this app forwards all requests to <strong>${site.sourceUrl}</strong> transparently. No files are copied — it's a live mirror.</p>
    </div>

    <hr class="divider"/>

    <div class="step">
      <span class="step-num">4</span>
      <h4>(Optional) Use Nginx for better performance + HTTPS</h4>
      <p>Install Nginx on your server and use this config:</p>
      <div class="code-block" style="white-space:pre;overflow-x:auto">
        <button class="copy-btn" onclick="copyText(this, \`${nginxConfig.replace(/`/g, '\\`')}\`)">Copy</button>${escaped}</div>
      <p>Then get a free SSL certificate with Certbot:</p>
      <div class="code-block">
        <button class="copy-btn" onclick="copyText(this, 'sudo certbot --nginx -d ${site.targetDomain} -d www.${site.targetDomain}')">Copy</button>
        sudo certbot --nginx -d ${site.targetDomain} -d www.${site.targetDomain}
      </div>
    </div>

    ${isNetlify ? `
    <hr class="divider"/>
    <div class="note">
      <strong>Netlify tip:</strong> If you have access to the Netlify dashboard for <em>${site.sourceUrl}</em>,
      you can also add <em>${site.targetDomain}</em> directly as a custom domain there — Netlify will handle HTTPS automatically without needing a proxy server.
    </div>` : `
    <hr class="divider"/>
    <div class="note">
      <strong>GitHub Pages tip:</strong> In your repository settings under "Pages", you can set a custom domain to <em>${site.targetDomain}</em> directly.
      GitHub Pages will verify domain ownership via a DNS TXT record and handle HTTPS for you.
    </div>`}
  `;
}

function closeModal() {
  document.getElementById('modal').hidden = true;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 1800);
  });
}

loadSites();
