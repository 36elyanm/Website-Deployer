import { json, getSites } from './_shared.js';

export async function onRequestGet({ env }) {
  return json(await getSites(env));
}
