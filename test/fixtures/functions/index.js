// Fixture for the emulator tests: this file maps to "/".
export const onRequestGet = () => new Response('fixture: index', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
