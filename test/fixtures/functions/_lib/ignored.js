// Fixture: a file under an "_" folder is shared code, never a route.
export const onRequest = () => new Response('_lib must never be routed', { status: 500 });
