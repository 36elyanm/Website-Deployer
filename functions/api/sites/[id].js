import { json, jsonError, getSites, saveSites } from '../_shared.js';

export async function onRequestPatch({ request, env, params }) {
  const { displayName } = await request.json();
  const sites = await getSites(env);
  const site = sites.find(s => s.id === params.id);
  if (!site) return jsonError('Not found.', 404);
  if (displayName) site.displayName = displayName.trim().slice(0, 80);
  await saveSites(env, sites);
  return json(site);
}

export async function onRequestDelete({ env, params }) {
  const sites = await getSites(env);
  const idx = sites.findIndex(s => s.id === params.id);
  if (idx === -1) return jsonError('Not found.', 404);
  const [removed] = sites.splice(idx, 1);
  await saveSites(env, sites);
  return json(removed);
}
