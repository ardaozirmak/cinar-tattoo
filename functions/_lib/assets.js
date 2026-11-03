// The version in the page's stylesheet and script URLs (/assets/site.css?v=<version>), so that a
// visitor's browser, which may keep /assets/* for a year, fetches them again after a deploy.
//
// It is the first 10 hex characters of the SHA-256 over the bytes of the hashed files, in order. It
// is '1' when ASSETS is missing, a fetch throws or a file is not there: the page must still render.
// A real hash is kept for the life of the isolate (a deploy starts new isolates); '1' never is, and
// nothing is kept under the local emulator (DEV_INSECURE_COOKIES), so an edited file shows up.
const HASHED = ['/assets/site.css', '/assets/site.js'];

let cached = null;

/** @returns {Promise<string>} */
export async function assetVersion(env, origin) {
  const dev = env?.DEV_INSECURE_COOKIES === '1';
  if (cached !== null && !dev) return cached;
  if (!env?.ASSETS) return '1';
  try {
    const parts = [];
    for (const path of HASHED) {
      const response = await env.ASSETS.fetch(new URL(path, origin));
      if (response.status !== 200) return '1';
      parts.push(new Uint8Array(await response.arrayBuffer()));
    }
    const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
    const version = Array.from(digest.slice(0, 5), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!dev) cached = version;
    return version;
  } catch (error) {
    console.error('assetVersion: the asset files could not be read', error);
    return '1';
  }
}
