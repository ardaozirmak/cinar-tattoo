// Fixture: "name.ext.js" maps to "/name.ext". It only has a GET handler, so other methods get a 405.
export const onRequestGet = () => new Response('<urlset/>', { headers: { 'content-type': 'application/xml' } });
