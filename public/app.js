const API = '';

// ── Tunnel banner ────────────────────────────────────────────────────────────

async function pollTunnel() {
  try {
    const res = await fetch(`${API}/api/tunnel`);
    const { url, status } = await res.json();

    const dot        = document.getElementById('tunnelDot');
    const statusText = document.getElementById('tunnelStatusText');
    const urlRow     = document.getElementById('tunnelUrlRow');
    const urlEl      = document.getElementById('tunnelUrl');

    dot.className = 'tunnel-dot ' + status;

    if (status === 'online' && url) {
      statusText.textContent = 'Public link active';
      statusText.style.color = 'var(--success)';
      urlEl.textContent = url;
      urlEl.href = url;
      urlRow.hidden = false;
      // Pre-fill the free domain target field with tunnel URL
      const fdTarget = document.getElementById('fdTarget');
      if (!fdTarget.value) {
        fdTarget.value = url.replace(/^https?:\/\//, '');
        updateFreeDomainPreview();
      }
    } else if (status === 'connecting') {
      statusText.textContent = 'Getting your public link...';
      statusText.style.color = '';
      urlRow.hidden = true;
    } else {
      statusText.textContent = 'Public link offline — reconnecting';
      statusText.style.color = 'var(--danger)';
      urlRow.hidden = true;
    }
  } catch { /* server not ready */ }
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

pollTunnel();
setInterval(pollTunnel, 4000);

// ── Free domain wizard ───────────────────────────────────────────────────────

function toggleFreeDomain() {
  const body    = document.getElementById('freeDomainBody');
  const chevron = document.getElementById('freeDomainChevron');
  const open    = !body.hidden;
  body.hidden   = open;
  chevron.classList.toggle('open', !open);
}

function updateFreeDomainPreview() {
  const sub     = document.getElementById('fdSubdomain').value.trim().toLowerCase();
  const github  = document.getElementById('fdGithub').value.trim();
  const target  = document.getElementById('fdTarget').value.trim().replace(/^https?:\/\//, '');
  const preview = document.getElementById('fdPreview');
  const previewDomain = document.getElementById('fdPreviewDomain');
  const btn     = document.getElementById('fdGenerateBtn');

  if (sub) {
    preview.hidden = false;
    previewDomain.textContent = `${sub}.is-a.dev`;
  } else {
    preview.hidden = true;
  }

  btn.disabled = !(sub && github && target);
}

function generateFreeDomain() {
  const sub    = document.getElementById('fdSubdomain').value.trim().toLowerCase();
  const github = document.getElementById('fdGithub').value.trim();
  const target = document.getElementById('fdTarget').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

  const json = JSON.stringify({
    description: `${sub}.is-a.dev — deployed via Website Deployer`,
    repo: `https://github.com/${github}`,
    owner: { username: github },
    record: { CNAME: target }
  }, null, 2);

  document.getElementById('fdFilename').textContent = `${sub}.json`;
  document.getElementById('fdJson').textContent = json;
  document.getElementById('fdFinalDomain').textContent = `${sub}.is-a.dev`;
  document.getElementById('fdSteps').hidden = false;

  document.getElementById('fdSteps').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyCode(btnId, text) {
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(btnId);
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
  });
}

// ── Sites list ───────────────────────────────────────────────────────────────

async function loadSites() {
  const res   = await fetch(`${API}/api/sites`);
  const sites = await res.json();
  renderSites(sites);
}

function renderSites(sites) {
  const list  = document.getElementById('sitesList');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('siteCount');

  count.textContent = sites.length;
  list.querySelectorAll('.site-card').forEach(el => el.remove());

  if (sites.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  sites.forEach(site => list.appendChild(buildSiteCard(site)));
}

function buildSiteCard(site) {
  const div  = document.createElement('div');
  div.className   = 'site-card';
  div.dataset.id  = site.id;

  const date = new Date(site.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  div.innerHTML = `
    <div class="site-top">
      <div class="site-info">
        <div class="site-title"><span class="status-dot"></span>${escHtml(site.title)}</div>
        <div class="site-urls">
          <div class="site-url"><span class="label">Source</span><span class="source-link">${escHtml(site.sourceUrl)}</span></div>
          <div class="site-url"><span class="label">Domain</span><span class="target-link">${escHtml(site.targetDomain)}</span></div>
        </div>
      </div>
    </div>
    <div class="site-bottom">
      <div class="site-meta">Added ${date}</div>
      <div class="site-actions">
        <button class="btn-icon primary" onclick="showInstructions('${site.id}')">Setup Guide</button>
        <button class="btn-icon danger"  onclick="deleteSite('${site.id}')">Remove</button>
      </div>
    </div>`;
  return div;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Deploy form ──────────────────────────────────────────────────────────────

document.getElementById('deployForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const sourceUrl    = document.getElementById('sourceUrl').value.trim();
  const targetDomain = document.getElementById('targetDomain').value.trim();
  const errEl        = document.getElementById('formError');
  const btn          = document.getElementById('submitBtn');
  const btnText      = btn.querySelector('.btn-text');
  const btnSpinner   = btn.querySelector('.btn-spinner');

  errEl.hidden = true;
  btnText.hidden = true;
  btnSpinner.hidden = false;
  btn.disabled = true;

  try {
    const res  = await fetch(`${API}/api/sites`, {
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

    document.getElementById('sourceUrl').value    = '';
    document.getElementById('targetDomain').value = '';
    await loadSites();
    showInstructions(data.id);
  } catch {
    errEl.textContent = 'Network error. Is the server running?';
    errEl.hidden = false;
  } finally {
    btnText.hidden = false;
    btnSpinner.hidden = true;
    btn.disabled = false;
  }
});

// ── Delete / instructions ────────────────────────────────────────────────────

async function deleteSite(id) {
  if (!confirm('Remove this site deployment?')) return;
  await fetch(`${API}/api/sites/${id}`, { method: 'DELETE' });
  await loadSites();
}

async function showInstructions(siteId) {
  const sites    = await fetch(`${API}/api/sites`).then(r => r.json());
  const site     = sites.find(s => s.id === siteId);
  if (!site) return;

  const { config } = await fetch(`${API}/api/sites/${siteId}/nginx`).then(r => r.json());
  const isNetlify   = new URL(site.sourceUrl).hostname.endsWith('.netlify.app');

  document.getElementById('modalTitle').textContent = `Setup: ${site.targetDomain}`;
  document.getElementById('modalBody').innerHTML    = buildInstructions(site, config, isNetlify);
  document.getElementById('modal').hidden           = false;
}

function buildInstructions(site, nginxConfig, isNetlify) {
  const escaped  = escHtml(nginxConfig);
  const serverIp = 'YOUR_SERVER_IP';

  return `
    <div class="step">
      <span class="step-num">1</span>
      <h4>Point your domain's DNS to this server</h4>
      <p>In your domain registrar or DNS provider, add these records:</p>
      <table class="dns-table">
        <thead><tr><th>Type</th><th>Name</th><th>Value</th><th>TTL</th></tr></thead>
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
      <h4>Run this app on port 80</h4>
      <div class="code-block">
        <button class="copy-btn" onclick="copyText(this,'PORT=80 node server.js')">Copy</button>
        PORT=80 node server.js
      </div>
    </div>
    <hr class="divider"/>
    <div class="step">
      <span class="step-num">3</span>
      <h4>How the proxy works</h4>
      <p>Visitors to <strong>${site.targetDomain}</strong> are transparently forwarded to <strong>${site.sourceUrl}</strong>.</p>
    </div>
    <hr class="divider"/>
    <div class="step">
      <span class="step-num">4</span>
      <h4>(Optional) Nginx + HTTPS</h4>
      <div class="code-block" style="white-space:pre;overflow-x:auto">
        <button class="copy-btn" onclick="copyText(this,\`${nginxConfig.replace(/`/g,'\\`')}\`)">Copy</button>${escaped}</div>
      <div class="code-block" style="margin-top:10px">
        <button class="copy-btn" onclick="copyText(this,'sudo certbot --nginx -d ${site.targetDomain}')">Copy</button>
        sudo certbot --nginx -d ${site.targetDomain}
      </div>
    </div>
    ${isNetlify
      ? `<hr class="divider"/><div class="note"><strong>Netlify tip:</strong> You can also add <em>${site.targetDomain}</em> as a custom domain directly in the Netlify dashboard — no proxy needed.</div>`
      : `<hr class="divider"/><div class="note"><strong>GitHub Pages tip:</strong> Set <em>${site.targetDomain}</em> as your custom domain in repository Settings → Pages.</div>`}`;
}

function closeModal() { document.getElementById('modal').hidden = true; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
  });
}

loadSites();
