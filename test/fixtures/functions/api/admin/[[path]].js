// Fixture: a catch-all (params.path is an array) with a method-less handler that takes every method.
export const onRequest = ({ request, params }) => Response.json({ method: request.method, path: params.path });
