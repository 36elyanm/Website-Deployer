import { json, jsonError, getConfig, getSites, saveSites, slugify } from './_shared.js';

async function sha256hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureProject(name, accountId, token) {
  const check = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${name}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const checkData = await check.json();
  if (checkData.success) return;

  const create = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, production_branch: 'main' }),
    }
  );
  const createData = await create.json();
  if (!createData.success) throw new Error(createData.errors?.[0]?.message || 'Failed to create project');
}

export async function onRequestPost({ request, env }) {
  const cfg = await getConfig(env);
  if (!cfg) return jsonError('Cloudflare credentials not configured. Open Settings first.', 400);

  const formData = await request.formData();
  const siteName = (formData.get('siteName') || 'my-site').trim();
  const customDomain = (formData.get('customDomain') || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/$/, '');
  const projectName = slugify(siteName);

  const fileEntries = formData.getAll('files');
  if (!fileEntries.length) return jsonError('No files provided.', 400);

  // Process files
  const files = [];
  for (const entry of fileEntries) {
    if (!(entry instanceof File)) continue;
    const content = await entry.arrayBuffer();
    files.push({ path: '/' + entry.name.replace(/^\//, ''), content, name: entry.name });
  }

  if (!files.length) return jsonError('No valid files.', 400);

  // Promote single HTML file to index.html
  if (!files.some(f => f.path === '/index.html')) {
    const htmlFiles = files.filter(f => f.path.endsWith('.html'));
    if (htmlFiles.length === 1) htmlFiles[0].path = '/index.html';
  }

  // Hash every file and build manifest
  const manifest = {};
  for (const file of files) {
    file.hash = await sha256hex(file.content);
    manifest[file.path] = file.hash;
  }

  try {
    await ensureProject(projectName, cfg.accountId, cfg.token);

    // Build multipart body for Cloudflare Pages deployment API
    const cfForm = new FormData();
    cfForm.append('manifest', new Blob([JSON.stringify(manifest)], { type: 'application/json' }), 'manifest.json');
    for (const file of files) {
      cfForm.append(file.hash, new Blob([file.content]), file.name);
    }

    const deployRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/pages/projects/${projectName}/deployments`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${cfg.token}` }, body: cfForm }
    );
    const deployment = await deployRes.json();

    if (!deployment.success) {
      return jsonError('Deploy failed: ' + (deployment.errors?.[0]?.message || JSON.stringify(deployment.errors)), 500);
    }

    const pagesUrl = deployment.result?.url || `https://${projectName}.pages.dev`;

    // Attach custom domain if provided
    let customDomainStatus = null;
    if (customDomain) {
      const domRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/pages/projects/${projectName}/domains`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: customDomain }),
        }
      );
      const domData = await domRes.json();
      customDomainStatus = domData.success
        ? (domData.result?.status || 'pending')
        : `error: ${domData.errors?.[0]?.message || 'Unknown'}`;
    }

    const site = {
      id: crypto.randomUUID(),
      displayName: siteName,
      projectName,
      url: pagesUrl,
      customDomain: customDomain || null,
      customDomainStatus,
      deploymentId: deployment.result?.id,
      fileCount: files.length,
      createdAt: new Date().toISOString(),
    };

    const sites = await getSites(env);
    const existingIdx = sites.findIndex(s => s.projectName === projectName);
    if (existingIdx !== -1) { site.id = sites[existingIdx].id; sites[existingIdx] = site; }
    else sites.unshift(site);
    await saveSites(env, sites);

    return json(site, 201);
  } catch (err) {
    return jsonError(err.message, 500);
  }
}
