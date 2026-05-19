import { json, jsonError, getConfig, getSites, saveSites } from '../../_shared.js';

export async function onRequestPost({ request, env, params }) {
  const cfg = await getConfig(env);
  if (!cfg) return jsonError('No credentials configured.', 400);

  const sites = await getSites(env);
  const site = sites.find(s => s.id === params.id);
  if (!site) return jsonError('Site not found.', 404);

  const { domain } = await request.json();
  if (!domain) return jsonError('domain is required.');
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/pages/projects/${site.projectName}/domains`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    }
  );
  const data = await res.json();
  if (!data.success) return jsonError(data.errors?.[0]?.message || 'Failed to attach domain.', 400);

  site.customDomain = clean;
  site.customDomainStatus = data.result?.status || 'pending';
  await saveSites(env, sites);
  return json(site);
}
