// ── State ────────────────────────────────────────────────────────────────────

let selectedFiles = []; // [{name, path, file}]
let uploadMode = null;  // 'files' | 'folder' | 'zip'
let renameSiteId = null;
let domainSiteId = null;

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  await loadConfig();
  await loadSites();
  setupDropZone();
  setupFileInputs();
})();

// ── Settings ─────────────────────────────────────────────────────────────────

function toggleSettings() {
  const card = document.getElementById('settingsCard');
  const btn  = document.getElementById('settingsBtn');
  const open = !card.hidden;
  card.hidden = open;
  btn.classList.toggle('active', !open);
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.accountId) document.getElementById('cfAccountId').value = cfg.accountId;
    updateCfStatus(cfg.hasToken ? 'ok' : null);
  } catch { /* silent */ }
}

function updateCfStatus(state) {
  const el = document.getElementById('cfStatus');
  if (state === 'ok') {
    el.textContent = 'Connected';
    el.className = 'badge-status ok';
    el.hidden = false;
  } else if (state === 'error') {
    el.textContent = 'Invalid credentials';
    el.className = 'badge-status error';
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

async function saveSettings() {
  const accountId = document.getElementById('cfAccountId').value.trim();
  const token     = document.getElementById('cfToken').value.trim();
  const msg       = document.getElementById('settingsMsg');

  if (!accountId || !token) {
    showSettingsMsg('Please enter both Account ID and API Token.', 'error');
    return;
  }

  const res  = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, token }),
  });
  const data = await res.json();

  if (data.ok) {
    showSettingsMsg('Credentials saved.', 'success');
    updateCfStatus('ok');
    document.getElementById('cfToken').value = '';
  } else {
    showSettingsMsg(data.error || 'Could not save.', 'error');
  }
}

async function verifyCreds() {
  const btn  = document.getElementById('verifyText');
  btn.textContent = 'Verifying...';

  const accountId = document.getElementById('cfAccountId').value.trim();
  const token     = document.getElementById('cfToken').value.trim();

  if (accountId || token) await saveSettings();

  try {
    const res  = await fetch('/api/config/verify', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showSettingsMsg('Connection verified! Cloudflare credentials are valid.', 'success');
      updateCfStatus('ok');
    } else {
      showSettingsMsg(data.error || 'Verification failed.', 'error');
      updateCfStatus('error');
    }
  } catch {
    showSettingsMsg('Network error.', 'error');
  } finally {
    btn.textContent = 'Verify Connection';
  }
}

function showSettingsMsg(text, type) {
  const el = document.getElementById('settingsMsg');
  el.textContent = text;
  el.className = `settings-msg ${type}`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

// ── Domain picker preview ─────────────────────────────────────────────────────

function updateSlugPreview() {
  const name    = document.getElementById('siteName').value.trim();
  const slug    = slugify(name);
  const preview = document.getElementById('domainPickerPreview');
  const full    = document.getElementById('domainPickerFull');

  if (slug) {
    full.textContent = `${slug}.pages.dev — yours for free`;
    preview.classList.add('ready');
  } else {
    full.textContent = 'Type a name to claim your free address';
    preview.classList.remove('ready');
  }
  checkDeployReady();
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63) || '';
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function setupDropZone() {
  const zone = document.getElementById('uploadZone');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleDroppedItems(e.dataTransfer.items || e.dataTransfer.files);
  });
}

async function handleDroppedItems(items) {
  const files = [];
  const traverse = async (entry, prefix = '') => {
    if (entry.isFile) {
      await new Promise(resolve => {
        entry.file(f => {
          files.push({ name: f.name, path: prefix + f.name, file: f });
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      await new Promise(resolve => {
        reader.readEntries(async entries => {
          for (const e of entries) await traverse(e, prefix + entry.name + '/');
          resolve();
        });
      });
    }
  };

  if (items instanceof DataTransferItemList) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) await traverse(entry);
    }
  } else {
    for (const f of items) {
      files.push({ name: f.name, path: f.name, file: f });
    }
  }

  if (files.length > 0) {
    uploadMode = files.length === 1 && files[0].name.endsWith('.zip') ? 'zip' : 'files';
    selectedFiles = files;
    renderFileList();
  }
}

// ── File inputs ───────────────────────────────────────────────────────────────

function setupFileInputs() {
  document.getElementById('fileInput').addEventListener('change', e => {
    uploadMode = 'files';
    selectedFiles = Array.from(e.target.files).map(f => ({ name: f.name, path: f.name, file: f }));
    renderFileList();
    e.target.value = '';
  });

  document.getElementById('folderInput').addEventListener('change', e => {
    uploadMode = 'folder';
    selectedFiles = Array.from(e.target.files).map(f => ({
      name: f.name,
      path: f.webkitRelativePath || f.name,
      file: f,
    }));
    renderFileList();
    e.target.value = '';
  });

  document.getElementById('zipInput').addEventListener('change', e => {
    uploadMode = 'zip';
    selectedFiles = Array.from(e.target.files).map(f => ({ name: f.name, path: f.name, file: f }));
    renderFileList();
    e.target.value = '';
  });
}

function renderFileList() {
  const zone      = document.getElementById('uploadZone');
  const iconEl    = document.getElementById('uploadIconEl');
  const titleEl   = document.getElementById('uploadTitle');
  const subEl     = document.getElementById('uploadSub');
  const listEl    = document.getElementById('fileList');

  if (selectedFiles.length === 0) {
    zone.classList.remove('has-files');
    listEl.hidden = true;
    titleEl.textContent = 'Drop files here';
    subEl.textContent = 'or choose an option below';
    checkDeployReady();
    return;
  }

  zone.classList.add('has-files');
  const label = uploadMode === 'zip' ? 'ZIP archive selected' : `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} selected`;
  titleEl.textContent = label;
  subEl.textContent = 'Ready to deploy';

  listEl.innerHTML = selectedFiles.slice(0, 20).map(f => `
    <div class="file-item">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="file-name">${esc(f.path)}</span>
      <span class="file-size">${formatBytes(f.file.size)}</span>
    </div>`).join('') + (selectedFiles.length > 20 ? `<div class="file-item" style="color:var(--text4)">… and ${selectedFiles.length - 20} more</div>` : '');

  listEl.hidden = false;
  checkDeployReady();
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Deploy ────────────────────────────────────────────────────────────────────

function checkDeployReady() {
  const name  = document.getElementById('siteName').value.trim();
  const btn   = document.getElementById('deployBtn');
  btn.disabled = !(name && selectedFiles.length > 0);
}

async function deploysite() {
  const siteName = document.getElementById('siteName').value.trim();
  const errEl    = document.getElementById('deployError');
  const okEl     = document.getElementById('deploySuccess');
  const btn      = document.getElementById('deployBtn');
  const content  = document.getElementById('deployBtnContent');
  const spinner  = document.getElementById('deploySpinner');

  errEl.hidden = true;
  okEl.hidden  = true;
  btn.disabled = true;
  content.hidden = true;
  spinner.hidden = false;

  try {
    const fd = new FormData();
    fd.append('siteName', siteName);
    const customDomain = document.getElementById('customDomain').value.trim();
    if (customDomain) fd.append('customDomain', customDomain);

    if (uploadMode === 'zip') {
      fd.append('zip', selectedFiles[0].file);
    } else {
      for (const f of selectedFiles) {
        fd.append('files', f.file, f.path);
      }
    }

    const res  = await fetch('/api/deploy', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Deployment failed.';
      errEl.hidden = false;
      return;
    }

    let successHtml = `Deployed! Your site is live at <a href="${esc(data.url)}" target="_blank" rel="noopener">${esc(data.url)}</a>.`;
    if (data.customDomain) {
      const statusLabel = data.customDomainStatus?.startsWith('error')
        ? `<strong style="color:#c0392b">Domain attachment failed: ${esc(data.customDomainStatus.replace('error: ', ''))}</strong>`
        : `Custom domain <strong>${esc(data.customDomain)}</strong> is being activated — DNS and SSL will be ready within a few minutes.`;
      successHtml += ` ${statusLabel}`;
    } else {
      successHtml += ` It may take a minute to propagate.`;
    }
    okEl.innerHTML = successHtml;
    okEl.hidden = false;

    // Reset upload
    selectedFiles = [];
    uploadMode = null;
    renderFileList();
    document.getElementById('siteName').value = '';
    document.getElementById('customDomain').value = '';
    updateSlugPreview();

    await loadSites();
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.hidden = false;
  } finally {
    content.hidden = false;
    spinner.hidden = true;
    btn.disabled = false;
    checkDeployReady();
  }
}

// ── Sites ─────────────────────────────────────────────────────────────────────

async function loadSites() {
  try {
    const res   = await fetch('/api/sites');
    const sites = await res.json();
    renderSites(sites);
  } catch { /* silent */ }
}

function renderSites(sites) {
  const list  = document.getElementById('sitesList');
  const empty = document.getElementById('emptyState');
  document.getElementById('siteCount').textContent = sites.length;

  list.querySelectorAll('.site-card').forEach(el => el.remove());

  if (sites.length === 0) {
    if (!list.contains(empty)) list.appendChild(empty);
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  sites.forEach(s => list.appendChild(buildSiteCard(s)));
}

function buildSiteCard(site) {
  const div = document.createElement('div');
  div.className = 'site-card';
  div.dataset.id = site.id;

  const date = new Date(site.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const domainRow = site.customDomain
    ? `<div class="site-url-row">
        <span class="site-url-label">Domain</span>
        <a class="site-url-link" href="https://${esc(site.customDomain)}" target="_blank" rel="noopener">${esc(site.customDomain)}</a>
        ${domainStatusChip(site.customDomainStatus)}
      </div>`
    : '';

  const domainBtn = site.customDomain
    ? ''
    : `<button class="btn-sm" onclick="openDomainModal('${site.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20"/><line x1="12" y1="8" x2="12" y2="8.01"/></svg>
        Add Domain
      </button>`;

  div.innerHTML = `
    <div class="site-top">
      <div class="site-info">
        <div class="site-name">
          <span class="live-dot"></span>
          ${esc(site.displayName || site.projectName)}
        </div>
        <div class="site-url-row">
          <span class="site-url-label">${site.customDomain ? 'Pages' : 'URL'}</span>
          <a class="site-url-link" href="${esc(site.url)}" target="_blank" rel="noopener">${esc(site.url)}</a>
        </div>
        ${domainRow}
        <div class="site-url-row">
          <span class="site-url-label">Project</span>
          <span class="site-url-link" style="color:var(--text3)">${esc(site.projectName)}</span>
        </div>
        <div class="site-meta">${site.fileCount} file${site.fileCount !== 1 ? 's' : ''} · Deployed ${date}</div>
      </div>
      <div class="site-actions">
        ${domainBtn}
        <button class="btn-sm accent" onclick="openRenameModal('${site.id}', ${JSON.stringify(esc(site.displayName || site.projectName))})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Rename
        </button>
        <button class="btn-sm danger" onclick="deleteSite('${site.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Remove
        </button>
      </div>
    </div>`;
  return div;
}

async function deleteSite(id) {
  if (!confirm('Remove this site from the dashboard? (The Cloudflare Pages project itself is not deleted.)')) return;
  await fetch(`/api/sites/${id}`, { method: 'DELETE' });
  await loadSites();
}

// ── Domain modal ──────────────────────────────────────────────────────────────

function domainStatusChip(status) {
  if (!status) return '';
  if (status === 'active') return `<span class="domain-status active">Active</span>`;
  if (status?.startsWith('error')) return `<span class="domain-status error">Error</span>`;
  return `<span class="domain-status pending">Pending</span>`;
}

function openDomainModal(id) {
  domainSiteId = id;
  document.getElementById('domainInput').value = '';
  document.getElementById('domainModalMsg').hidden = true;
  document.getElementById('domainModal').hidden = false;
  document.getElementById('domainInput').focus();

  document.getElementById('domainSaveBtn').onclick = async () => {
    const domain = document.getElementById('domainInput').value.trim();
    const msgEl  = document.getElementById('domainModalMsg');
    const btn    = document.getElementById('domainSaveBtn');
    if (!domain) return;

    btn.disabled = true;
    btn.textContent = 'Attaching...';
    msgEl.hidden = true;

    try {
      const res  = await fetch(`/api/sites/${domainSiteId}/domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();

      if (!res.ok) {
        msgEl.textContent = data.error || 'Failed to attach domain.';
        msgEl.className = 'msg msg-error';
        msgEl.hidden = false;
        return;
      }

      closeDomainModal();
      await loadSites();
    } catch (err) {
      msgEl.textContent = 'Network error: ' + err.message;
      msgEl.className = 'msg msg-error';
      msgEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Attach Domain';
    }
  };
}

function closeDomainModal() {
  document.getElementById('domainModal').hidden = true;
  domainSiteId = null;
}

// ── Rename Modal ──────────────────────────────────────────────────────────────

function openRenameModal(id, currentName) {
  renameSiteId = id;
  document.getElementById('renameInput').value = currentName;
  document.getElementById('renameModal').hidden = false;
  document.getElementById('renameInput').focus();

  document.getElementById('renameSaveBtn').onclick = async () => {
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName) return;
    await fetch(`/api/sites/${renameSiteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: newName }),
    });
    closeRenameModal();
    await loadSites();
  };
}

function closeRenameModal() {
  document.getElementById('renameModal').hidden = true;
  renameSiteId = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeRenameModal(); closeDomainModal(); }
  if (e.key === 'Enter' && !document.getElementById('renameModal').hidden) {
    document.getElementById('renameSaveBtn').click();
  }
  if (e.key === 'Enter' && !document.getElementById('domainModal').hidden) {
    document.getElementById('domainSaveBtn').click();
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
