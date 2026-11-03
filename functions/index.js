// GET / : the public page, written on the server from what is in D1. When D1 is missing or fails,
// the page still answers 200 with the default content (spec §8), and the failure is logged.
import { assetVersion } from './_lib/assets.js';
import { defaultContent, ensureSchema, getContent } from './_lib/db.js';
import { htmlHeaders } from './_lib/http.js';
import { renderPage } from './_lib/render.js';

const YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric' });

async function loadContent(db) {
  try {
    if (!db) throw new Error('the DB binding is missing');
    await ensureSchema(db);
    return await getContent(db);
  } catch (error) {
    console.error('Ana sayfa: içerik okunamadı, varsayılan içerik gösteriliyor.', error);
    return defaultContent();
  }
}

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const content = await loadContent(env.DB);
  const year = Number(YEAR.format(new Date()));
  const html = renderPage({ content, origin, assetVersion: await assetVersion(env, origin), year });
  return new Response(html, { status: 200, headers: htmlHeaders() });
}

// The platform sends no body for HEAD.
export const onRequestHead = onRequestGet;
