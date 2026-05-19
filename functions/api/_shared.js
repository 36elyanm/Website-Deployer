export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const jsonError = (msg, status = 400) => json({ error: msg }, status);

export const getConfig = async (env) => {
  const s = await env.STORE.get('config');
  return s ? JSON.parse(s) : null;
};

export const getSites = async (env) => {
  const s = await env.STORE.get('sites');
  return s ? JSON.parse(s) : [];
};

export const saveSites = (env, sites) =>
  env.STORE.put('sites', JSON.stringify(sites));

export const slugify = (str) =>
  str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63) || 'my-site';
