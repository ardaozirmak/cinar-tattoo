// Fixture: a one-segment param. "api/static.js" outranks it for /api/static.
export const onRequestGet = ({ params }) => Response.json({ name: params.name });
