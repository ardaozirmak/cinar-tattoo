import { siteRedirect } from './_lib/http.js';

// GET /sitemap.xml : the one page the site has, at the address it was asked for.
export function onRequestGet({ request, env }) {
  const away = siteRedirect(request, env);
  if (away) return away;
  const origin = new URL(request.url).origin;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>\n`;
  return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
