import { json, jsonError, getConfig } from './_shared.js';

export async function onRequestGet({ env }) {
  const cfg = await getConfig(env);
  return json({ accountId: cfg?.accountId || '', hasToken: !!cfg?.token });
}

export async function onRequestPost({ request, env }) {
  const { accountId, token } = await request.json();
  if (!accountId || !token) return jsonError('accountId and token are required.');
  await env.STORE.put('config', JSON.stringify({ accountId: accountId.trim(), token: token.trim() }));
  return json({ ok: true });
}
