import { json, jsonError, getConfig } from '../_shared.js';

export async function onRequestPost({ env }) {
  const cfg = await getConfig(env);
  if (!cfg) return jsonError('No credentials saved.', 400);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/pages/projects?per_page=1`,
    { headers: { 'Authorization': `Bearer ${cfg.token}` } }
  );
  const data = await res.json();

  if (data.success) return json({ ok: true });
  return jsonError(data.errors?.[0]?.message || 'Invalid credentials.', 401);
}
