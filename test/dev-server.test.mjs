import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRouteTable } from '../dev/routes.mjs';
import { dispatch, startServer } from '../dev/server.mjs';
import { createAssets } from '../dev/static.mjs';
import { makeEnv, tempTree } from './helpers.mjs';

// test/fixtures holds a functions/ and a public/ folder, which is what a project root looks like.
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const SERVER_CLI = fileURLToPath(new URL('../dev/server.mjs', import.meta.url));
const VARS = { ADMIN_PASSWORD: 'server-test-password', APP_SECRET: 's'.repeat(40) };

// Starts a server on a free port with its data in a temp folder. By default it serves the fixtures;
// `files` makes a project root of its own instead. One after-hook closes the server first (which
// releases the SQLite file Windows would not let go of) and then removes the folders.
async function serve(t, { files, ...options } = {}) {
  const data = await tempTree();
  const project = files ? await tempTree(files) : null;
  const server = await startServer({ port: 0, root: project?.dir ?? FIXTURES, dataDir: join(data.dir, 'data'), vars: VARS, ...options });
  t.after(async () => {
    await server.close();
    await data.cleanup();
    await project?.cleanup();
  });
  return { ...server, dataDir: join(data.dir, 'data'), root: project?.dir ?? FIXTURES };
}

// A function that reports what it was given, for any method.
const PROBE = `export const onRequest = async ({ request }) => Response.json({
  method: request.method,
  url: request.url,
  hasBody: request.body !== null,
  text: await request.text(),
  headers: Object.fromEntries(request.headers),
});
`;

// Like fetch(), but with the raw request line and headers under the test's control.
function rawRequest(server, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port: server.port, method, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('startServer listens on the port it is given (0 = any free one) and reports its url and port', async (t) => {
  const server = await serve(t);
  assert.ok(Number.isInteger(server.port) && server.port > 0);
  assert.equal(server.url, `http://127.0.0.1:${server.port}`);
  assert.equal(typeof server.close, 'function');
});

test('a fixture function answers at its route, params included', async (t) => {
  const server = await serve(t);
  const index = await fetch(`${server.url}/`);
  assert.equal(index.status, 200);
  assert.equal(await index.text(), 'fixture: index');

  assert.deepEqual(await (await fetch(`${server.url}/img/abc123/thumb`)).json(), { id: 'abc123', variant: 'thumb' });
  assert.deepEqual(await (await fetch(`${server.url}/api/other`)).json(), { name: 'other' });
  assert.deepEqual(await (await fetch(`${server.url}/api/admin/photos/abc/replace`, { method: 'POST' })).json(), {
    method: 'POST',
    path: ['photos', 'abc', 'replace'],
  });
});

test('several Set-Cookie headers reach the client as separate headers, commas in dates intact', async (t) => {
  const server = await serve(t);
  const res = await fetch(`${server.url}/api/static`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers.getSetCookie(), [
    'a=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly',
    'b=2; Path=/api; SameSite=Strict',
  ]);
});

test('CF-Connecting-IP is the socket address, and a client cannot choose its own', async (t) => {
  const server = await serve(t);
  assert.equal((await (await fetch(`${server.url}/api/static`)).json()).ip, '127.0.0.1');

  const spoofed = await fetch(`${server.url}/api/static`, { headers: { 'CF-Connecting-IP': '6.6.6.6' } });
  assert.equal((await spoofed.json()).ip, '127.0.0.1');
});

test('request.url is built from the Host header, so a phone on the LAN passes the origin check', async (t) => {
  const server = await serve(t);
  const res = await rawRequest(server, {
    path: '/api/static?x=1',
    headers: { host: '192.168.1.50:8788', origin: 'http://192.168.1.50:8788' },
  });
  const body = JSON.parse(res.text);
  assert.equal(body.url, 'http://192.168.1.50:8788/api/static?x=1');
  assert.equal(new URL(body.url).origin, body.origin, 'the Origin the browser sends equals the request origin');
});

test('a request the server cannot turn into a Request gets 400, and the server keeps working', async (t) => {
  const server = await serve(t);
  for (const request of [
    { path: '/', headers: { host: 'bad host' } },
    { path: '*', method: 'OPTIONS' },
    { path: '/', method: 'TRACE' },
    // The absolute form that proxies use. Glued to a Host without a port it would still parse, as
    // the host "ahttp" with an empty port.
    { path: 'http://evil.test/x', headers: { host: 'a' } },
  ]) {
    const res = await rawRequest(server, request);
    assert.equal(res.status, 400, JSON.stringify(request));
  }
  assert.equal((await fetch(`${server.url}/`)).status, 200);
});

test('a request target that starts with "//" stays on the Host header host instead of moving to another one', async (t) => {
  const server = await serve(t);
  // Resolved against the Host, "//evil.test/api/static" would become http://evil.test/api/static
  // and reach the function. Glued onto it, the path has an empty segment and matches no route.
  const res = await rawRequest(server, { path: '//evil.test/api/static' });
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /evil\.test/);
});

test('a request without a Host header gets 400', async (t) => {
  const server = await serve(t);
  const reply = await new Promise((resolve, reject) => {
    const socket = connect(server.port, '127.0.0.1', () => socket.write('GET / HTTP/1.0\r\n\r\n'));
    let text = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (text += chunk));
    socket.on('end', () => resolve(text));
    socket.on('error', reject);
  });
  assert.match(reply, /^HTTP\/1\.1 400 /);
});

test('every method reaches the function, the body arrives intact and no body means request.body is null', async (t) => {
  const server = await serve(t, { files: { 'functions/probe.js': PROBE } });

  const post = await (await fetch(`${server.url}/probe`, { method: 'POST', body: 'merhaba çınar', headers: { Origin: 'http://elsewhere.test' } })).json();
  assert.equal(post.method, 'POST');
  assert.equal(post.text, 'merhaba çınar');
  assert.equal(post.hasBody, true);
  assert.equal(post.headers['content-length'], String(Buffer.byteLength('merhaba çınar')), 'Content-Length reaches the function');
  assert.equal(post.headers.origin, 'http://elsewhere.test');

  const big = 'x'.repeat(1_000_000);
  assert.equal((await (await fetch(`${server.url}/probe`, { method: 'PUT', body: big })).json()).text.length, big.length);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const body = await (await fetch(`${server.url}/probe`, { method })).json();
    assert.equal(body.method, method);
    assert.equal(body.hasBody, false, `${method} without a body`);
  }
  assert.equal((await (await fetch(`${server.url}/probe`)).json()).hasBody, false);

  // A client that sends a body with GET is not rejected; the body is not passed on.
  const odd = await rawRequest(server, { path: '/probe', headers: { 'content-length': '5' }, body: 'hello' });
  assert.equal(odd.status, 200);
  assert.equal(JSON.parse(odd.text).hasBody, false);
});

test('multipart uploads stream through to request.formData()', async (t) => {
  const server = await serve(t, {
    files: {
      'functions/upload.js': `export const onRequestPost = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('full');
  return Response.json({ caption: form.get('caption'), bytes: [...new Uint8Array(await file.arrayBuffer())] });
};
`,
    },
  });
  const form = new FormData();
  form.set('caption', 'çınar');
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  form.set('full', new Blob([bytes], { type: 'image/jpeg' }), 'full.jpg');

  const body = await (await fetch(`${server.url}/upload`, { method: 'POST', body: form })).json();
  assert.equal(body.caption, 'çınar');
  assert.deepEqual(body.bytes, [...bytes]);
});

// Functions that answer a big upload in the three ways that leave part of it unread.
const UPLOAD_FUNCTIONS = {
  // The admin API answers 401 to an expired session before it reads the photo that comes with it.
  'functions/ignore.js': 'export const onRequestPost = () => new Response("ignored", { status: 401 });\n',
  // A size limit: stop reading by cancelling the body, then answer.
  'functions/cancel.js': 'export const onRequestPost = async ({ request }) => { await request.body.cancel(); return new Response("cancelled", { status: 413 }); };\n',
  // Start reading, then answer without finishing or letting go of the reader.
  'functions/partial.js': 'export const onRequestPost = async ({ request }) => { await request.body.getReader().read(); return new Response("partial", { status: 400 }); };\n',
  'functions/ok.js': 'export const onRequestGet = () => new Response("ok");\n',
};

// The client reuses its connection, so a body left unread (or a connection cut) by one request
// shows in the next ones: the answer must arrive, and so must the request after it.
async function assertAnswersBigUploads(server, path, status, text) {
  const upload = new Uint8Array(3_000_000);
  for (let round = 1; round <= 4; round += 1) {
    const answer = await fetch(`${server.url}${path}`, { method: 'POST', body: upload, signal: AbortSignal.timeout(4000) });
    assert.equal(answer.status, status, `${path}, round ${round}`);
    assert.equal(await answer.text(), text, `${path}, round ${round}`);
    const next = await fetch(`${server.url}/ok`, { signal: AbortSignal.timeout(4000) });
    assert.equal(await next.text(), 'ok', `${path}, round ${round}`);
  }
}

test('a client that hangs up in the middle of an upload ends the function\'s read with an error', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const server = await serve(t, {
    files: { 'functions/read.js': 'export const onRequestPost = async ({ request }) => { globalThis.readStarted(); return new Response(await request.text()); };\n' },
  });
  const started = new Promise((resolve) => {
    globalThis.readStarted = resolve;
  });
  t.after(() => {
    delete globalThis.readStarted;
  });

  // Promise 1000 bytes of body, send 3, and hang up.
  const socket = connect(server.port, '127.0.0.1');
  socket.on('error', () => {});
  socket.write('POST /read HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000\r\n\r\nabc');
  await started;
  socket.destroy();

  // Without the error the read would wait for the other 997 bytes for ever.
  const deadline = Date.now() + 3000;
  while (error.mock.callCount() === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(error.mock.callCount() >= 1, 'the failed read was logged');
  assert.match(error.mock.calls[0].arguments.join(' '), /POST \/read failed/);
});

test('a function that answers without reading a big upload does not wedge the connection', async (t) => {
  const server = await serve(t, { files: UPLOAD_FUNCTIONS });
  await assertAnswersBigUploads(server, '/ignore', 401, 'ignored');
});

test('a function that cancels the upload body still gets its answer to the client', async (t) => {
  const server = await serve(t, { files: UPLOAD_FUNCTIONS });
  await assertAnswersBigUploads(server, '/cancel', 413, 'cancelled');
});

test('a function that reads part of the upload and answers does not wedge the connection either', async (t) => {
  const server = await serve(t, { files: UPLOAD_FUNCTIONS });
  await assertAnswersBigUploads(server, '/partial', 400, 'partial');
});

test('a method handler beats onRequest, onRequest takes the other methods, and a route with neither is 405 with Allow', async (t) => {
  const server = await serve(t);
  assert.equal(await (await fetch(`${server.url}/api/static`, { method: 'PUT' })).text(), 'any PUT');
  assert.equal(await (await fetch(`${server.url}/api/static`, { method: 'DELETE' })).text(), 'any DELETE');
  assert.equal((await (await fetch(`${server.url}/api/static`, { method: 'POST', body: 'x' })).json()).text, 'x');

  const post = await fetch(`${server.url}/sitemap.xml`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  assert.equal(await post.text(), 'Method Not Allowed');
  assert.equal((await fetch(`${server.url}/sitemap.xml`)).status, 200);

  // There is no HEAD fallback to the GET handler: index.js only exports onRequestGet.
  assert.equal((await fetch(`${server.url}/`, { method: 'HEAD' })).status, 405);
});

test('HEAD to a function sends the headers and no body', async (t) => {
  const server = await serve(t);
  const res = await fetch(`${server.url}/api/admin/anything`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(await res.text(), '');
});

test('paths without a function are served from public/: 200, 304 on a matching ETag, 404 with 404.html', async (t) => {
  const server = await serve(t);

  const file = await fetch(`${server.url}/a.txt`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(await file.text(), /a fixture file/);
  const etag = file.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{40}"$/);

  const cached = await fetch(`${server.url}/a.txt`, { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');

  const head = await fetch(`${server.url}/a.txt`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('etag'), etag);
  assert.equal(await head.text(), '');

  assert.match(await (await fetch(`${server.url}/dir/`)).text(), /fixture dir index/);
  assert.match(await (await fetch(`${server.url}/page`)).text(), /fixture page/);

  const missing = await fetch(`${server.url}/nope`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /fixture not found/);
});

test('_headers rules apply to static files but never to function responses', async (t) => {
  const server = await serve(t);
  assert.equal((await fetch(`${server.url}/a.txt`)).headers.get('x-fixture'), 'all');
  assert.equal((await fetch(`${server.url}/nope`)).headers.get('x-fixture'), 'all');

  for (const path of ['/', '/api/static', '/api/other', '/sitemap.xml']) {
    assert.equal((await fetch(server.url + path)).headers.get('x-fixture'), null, path);
  }
});

test('/_headers is not served over HTTP', async (t) => {
  const server = await serve(t);
  for (const path of ['/_headers', '/_HEADERS', '/%5Fheaders']) {
    const res = await fetch(server.url + path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(await res.text(), /X-Fixture: all/, path);
  }
});

test('path traversal over HTTP is a 404', async (t) => {
  const server = await serve(t);
  // Next to public/ sit functions/index.js and, three folders up, the project's package.json.
  const attacks = [
    '/..%2ffunctions%2findex.js',
    '/%2e%2e%2ffunctions%2findex.js',
    '/..%5cfunctions%5cindex.js',
    '/..%2f..%2f..%2fpackage.json',
    '/a.txt::$DATA',
  ];
  for (const path of attacks) {
    const res = await rawRequest(server, { path });
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.text, /fixture: index|"name"/, path);
  }
});

test('a function that throws gets a 500 with the stack on the console; the server keeps working', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const server = await serve(t, {
    files: {
      'functions/boom.js': 'export const onRequestGet = () => { throw new Error("kaboom"); };\n',
      'functions/async-boom.js': 'export const onRequestGet = async () => { throw new Error("async kaboom"); };\n',
      'functions/ok.js': 'export const onRequestGet = () => new Response("fine");\n',
    },
  });

  const sync = await fetch(`${server.url}/boom`);
  assert.equal(sync.status, 500);
  assert.equal(await sync.text(), 'Internal Server Error', 'no stack in the response');
  const asyncRes = await fetch(`${server.url}/async-boom`);
  assert.equal(asyncRes.status, 500);

  assert.equal(error.mock.callCount(), 2);
  const logged = error.mock.calls.map((call) => call.arguments.join(' '));
  assert.match(logged[0], /GET \/boom/);
  assert.match(logged[0], /Error: kaboom\n\s+at /, 'the log holds the stack');
  assert.match(logged[1], /async kaboom/);

  assert.equal(await (await fetch(`${server.url}/ok`)).text(), 'fine');
});

test('a function that returns something other than a Response is a 500 naming the file', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const server = await serve(t, { files: { 'functions/nothing.js': 'export const onRequestGet = () => {};\n' } });

  assert.equal((await fetch(`${server.url}/nothing`)).status, 500);
  assert.match(error.mock.calls[0].arguments.join(' '), /nothing\.js.*Response/s);
});

test('env has the vars, DB, IMAGES and ASSETS, with data under dataDir (.dev/db.sqlite and .dev/kv by default)', async (t) => {
  const files = {
    'functions/env.js': `export const onRequestGet = async ({ env }) => {
  await env.DB.exec('CREATE TABLE IF NOT EXISTS t (v TEXT)');
  await env.DB.prepare('INSERT INTO t (v) VALUES (?)').bind('row').run();
  await env.IMAGES.put('img/abc/full', 'bytes');
  const { DB, IMAGES, ASSETS, ...vars } = env;
  return Response.json({
    vars,
    rows: (await env.DB.prepare('SELECT v FROM t').all()).results,
    kv: await env.IMAGES.get('img/abc/full'),
    asset: (await ASSETS.fetch('http://x/ok.txt')).status,
  });
};
`,
    'public/ok.txt': 'fine',
  };

  const custom = await serve(t, { files });
  assert.deepEqual(await (await fetch(`${custom.url}/env`)).json(), {
    vars: { ...VARS, DEV_INSECURE_COOKIES: '1' },
    rows: [{ v: 'row' }],
    kv: 'bytes',
    asset: 200,
  });
  assert.ok(existsSync(join(custom.dataDir, 'db.sqlite')));
  assert.ok(existsSync(join(custom.dataDir, 'kv', 'img%2Fabc%2Ffull.bin')));

  // Without dataDir the data goes to <root>/.dev, and a relative dataDir is relative to the root.
  const project = await tempTree(files);
  const byDefault = await startServer({ port: 0, root: project.dir, vars: VARS });
  const relative = await startServer({ port: 0, root: project.dir, dataDir: 'elsewhere', vars: VARS });
  t.after(async () => {
    await Promise.all([byDefault.close(), relative.close()]);
    await project.cleanup();
  });
  assert.ok(existsSync(join(project.dir, '.dev', 'db.sqlite')));
  assert.ok(existsSync(join(project.dir, '.dev', 'kv')));
  assert.ok(existsSync(join(project.dir, 'elsewhere', 'db.sqlite')));
});

test('vars: explicit vars replace .dev.vars, DEV_INSECURE_COOKIES=1 is added unless they set it', async (t) => {
  const printVars = {
    'functions/vars.js': `export const onRequestGet = ({ env }) => {
  const { DB, IMAGES, ASSETS, ...vars } = env;
  return Response.json(vars);
};
`,
    '.dev.vars': 'FROM=dev-vars\n',
    '.dev.vars.example': 'FROM=example\n',
  };
  const varsOf = async (server) => (await fetch(`${server.url}/vars`)).json();
  const warn = t.mock.method(console, 'warn', () => {});

  const plain = await serve(t, { files: printVars, vars: { A: '1' } });
  assert.deepEqual(await varsOf(plain), { A: '1', DEV_INSECURE_COOKIES: '1' });

  const overridden = await serve(t, { files: printVars, vars: { DEV_INSECURE_COOKIES: '0' } });
  assert.deepEqual(await varsOf(overridden), { DEV_INSECURE_COOKIES: '0' });

  const none = await serve(t, { files: printVars, vars: {} });
  assert.deepEqual(await varsOf(none), { DEV_INSECURE_COOKIES: '1' });
  assert.equal(warn.mock.callCount(), 0, 'explicit vars read no file and warn about nothing');
});

test('vars: .dev.vars is read when no vars are passed; .dev.vars.example is the fallback, with a warning', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const vars = `export const onRequestGet = ({ env }) => {
  const { DB, IMAGES, ASSETS, ...vars } = env;
  return Response.json(vars);
};
`;
  const varsOf = async (server) => (await fetch(`${server.url}/vars`)).json();

  const both = await serve(t, { vars: undefined, files: { 'functions/vars.js': vars, '.dev.vars': 'FROM=dev-vars\n', '.dev.vars.example': 'FROM=example\n' } });
  assert.deepEqual(await varsOf(both), { FROM: 'dev-vars', DEV_INSECURE_COOKIES: '1' });
  assert.equal(warn.mock.callCount(), 0, 'no warning when .dev.vars exists');

  const onlyExample = await serve(t, { vars: undefined, files: { 'functions/vars.js': vars, '.dev.vars.example': 'FROM=example\nDEV_INSECURE_COOKIES=0\n' } });
  assert.deepEqual(await varsOf(onlyExample), { FROM: 'example', DEV_INSECURE_COOKIES: '0' }, '.dev.vars.example can set DEV_INSECURE_COOKIES too');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments.join(' '), /\.dev\.vars\.example/);

  const neither = await serve(t, { vars: undefined, files: { 'functions/vars.js': vars } });
  assert.deepEqual(await varsOf(neither), { DEV_INSECURE_COOKIES: '1' });
  assert.equal(warn.mock.callCount(), 2);
  assert.match(warn.mock.calls[1].arguments.join(' '), /ADMIN_PASSWORD/);
});

test('the server starts with neither functions/ nor public/, and answers 404', async (t) => {
  const server = await serve(t, { files: {} });
  for (const path of ['/', '/a.txt', '/api/x']) {
    const res = await fetch(server.url + path);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), 'Not found', path);
  }
});

test('listen errors reject, and do not leave the database open', async (t) => {
  const first = await serve(t);
  const data = await tempTree();
  t.after(data.cleanup);
  const dataDir = join(data.dir, 'data');
  await assert.rejects(startServer({ port: first.port, root: FIXTURES, dataDir, vars: VARS }), { code: 'EADDRINUSE' });
  // Windows refuses to delete a SQLite file that is still open. There are no retries here on
  // purpose: the garbage collector closes an abandoned database in the end, which would hide a leak.
  await assert.doesNotReject(rm(dataDir, { recursive: true }));
});

test('a function file that cannot be loaded makes startServer reject, naming the file', async (t) => {
  const data = await tempTree();
  const project = await tempTree({ 'functions/broken.js': 'export const onRequest = (;\n' });
  t.after(() => Promise.all([data.cleanup(), project.cleanup()]));
  await assert.rejects(startServer({ port: 0, root: project.dir, dataDir: join(data.dir, 'data'), vars: VARS }), /broken\.js/);
});

test('close() stops the server and releases the database; calling it twice is fine', async (t) => {
  const server = await serve(t);
  assert.equal((await fetch(`${server.url}/`)).status, 200);

  await server.close();
  await server.close();
  await assert.rejects(fetch(`${server.url}/`), (error) => error.cause?.code === 'ECONNREFUSED');
  // Windows can delete the database file only when nothing holds it open.
  await rm(server.dataDir, { recursive: true });
});

test('close() does not wait for idle keep-alive connections', async (t) => {
  const server = await serve(t);
  await fetch(`${server.url}/`); // leaves a keep-alive connection open

  const started = Date.now();
  await server.close();
  assert.ok(Date.now() - started < 2000, `close() took ${Date.now() - started} ms`);
});

test('close() cuts a request that is still being handled instead of waiting for it', async (t) => {
  const server = await serve(t, {
    files: { 'functions/hang.js': 'export const onRequestGet = () => { globalThis.hangReached(); return new Promise(() => {}); };\n' },
  });
  const reached = new Promise((resolve) => {
    globalThis.hangReached = resolve;
  });
  t.after(() => {
    delete globalThis.hangReached;
  });
  const pending = fetch(`${server.url}/hang`);
  const outcome = assert.rejects(pending);
  await reached;

  const started = Date.now();
  await server.close();
  assert.ok(Date.now() - started < 2000, `close() took ${Date.now() - started} ms`);
  await outcome;
});

test('host 0.0.0.0 (what --lan uses) still reports a loopback url and answers there', async (t) => {
  const server = await serve(t, { host: '0.0.0.0' });
  assert.equal(server.url, `http://127.0.0.1:${server.port}`);
  assert.equal(await (await fetch(`${server.url}/`)).text(), 'fixture: index');
});

// ---- dispatch: the same routing without a socket ----

async function dispatcher(t, files) {
  const tree = await tempTree(files);
  const { env, cleanup } = makeEnv();
  t.after(async () => {
    cleanup();
    await tree.cleanup();
  });
  const table = await buildRouteTable(join(tree.dir, 'functions'));
  const assets = createAssets(join(tree.dir, 'public'));
  return (request) => dispatch(typeof request === 'string' ? new Request(request) : request, { table, env, assets });
}

test('dispatch gives a function the Pages context: request, env, params, data, waitUntil, next', async (t) => {
  const send = await dispatcher(t, {
    'functions/ctx/[id].js': `export const onRequestGet = (context) => Response.json({
  keys: Object.keys(context).sort(),
  url: context.request.url,
  params: context.params,
  data: context.data,
  env: typeof context.env.DB.prepare,
  waitUntil: typeof context.waitUntil,
  next: typeof context.next,
});
`,
  });
  assert.deepEqual(await (await send('https://cinar.test/ctx/42?x=1')).json(), {
    keys: ['data', 'env', 'next', 'params', 'request', 'waitUntil'],
    url: 'https://cinar.test/ctx/42?x=1',
    params: { id: '42' },
    data: {},
    env: 'function',
    waitUntil: 'function',
    next: 'function',
  });
});

test('dispatch sends paths without a route to the assets, and next() does the same from inside a function', async (t) => {
  const send = await dispatcher(t, {
    'public/ok.txt': 'static ok',
    'public/guarded.txt': 'static guarded',
    'functions/guarded.txt.js': `export const onRequestGet = ({ request, next }) => request.headers.has('x-pass') ? next() : new Response('blocked', { status: 403 });\n`,
  });
  assert.equal(await (await send('https://cinar.test/ok.txt')).text(), 'static ok');
  assert.equal((await send('https://cinar.test/missing')).status, 404);

  assert.equal((await send('https://cinar.test/guarded.txt')).status, 403);
  const passed = await send(new Request('https://cinar.test/guarded.txt', { headers: { 'x-pass': '1' } }));
  assert.equal(await passed.text(), 'static guarded');
});

test('dispatch answers 405 with Allow when a matched route has no handler for the method, and does not fall back to assets', async (t) => {
  const send = await dispatcher(t, {
    'functions/only-get.js': 'export const onRequestGet = () => new Response("get");\nexport const onRequestHead = () => new Response(null);\n',
    'public/only-get': 'a static file with the same path',
  });
  const res = await send(new Request('https://cinar.test/only-get', { method: 'DELETE' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
  assert.equal((await send('https://cinar.test/only-get')).status, 200);
});

test('dispatch turns a throw, a rejection and a non-Response into 500 and logs each with its route', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const send = await dispatcher(t, {
    'functions/throws.js': 'export const onRequestGet = () => { throw new Error("sync"); };\n',
    'functions/rejects.js': 'export const onRequestGet = () => Promise.reject(new Error("async"));\n',
    'functions/string.js': 'export const onRequestGet = () => "not a response";\n',
    'functions/throws-a-string.js': 'export const onRequestGet = () => { throw "just text"; };\n',
  });
  for (const path of ['throws', 'rejects', 'string', 'throws-a-string']) {
    const res = await send(`https://cinar.test/${path}`);
    assert.equal(res.status, 500, path);
    assert.equal(await res.text(), 'Internal Server Error', path);
  }
  const logged = error.mock.calls.map((call) => call.arguments.join(' '));
  assert.equal(logged.length, 4);
  assert.match(logged[0], /GET \/throws[\s\S]*Error: sync/);
  assert.match(logged[1], /GET \/rejects[\s\S]*Error: async/);
  assert.match(logged[2], /GET \/string[\s\S]*string\.js[\s\S]*Response/);
  assert.match(logged[3], /GET \/throws-a-string[\s\S]*just text/);
});

test('dispatch survives a failing waitUntil task: the response is fine and the failure is logged', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const send = await dispatcher(t, {
    'functions/background.js': `export const onRequestGet = ({ waitUntil }) => {
  waitUntil(Promise.reject(new Error('background failure')));
  waitUntil('not even a promise');
  return new Response('done');
};
`,
  });
  const res = await send('https://cinar.test/background');
  assert.equal(await res.text(), 'done');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(error.mock.callCount(), 1);
  assert.match(error.mock.calls[0].arguments.join(' '), /background failure/);
});

// ---- the command line ----

// Runs `node dev/server.mjs <args>` in the fixtures folder (it has a functions/ and a public/). The
// hook ends the process first and only then removes `data`, a tempTree holding the --data folder:
// Windows cannot delete the database while the process still has it open, and a process left
// running would keep the whole test file from exiting.
function runCli(t, args, { data } = {}) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_CLI, ...args], { cwd: FIXTURES, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  t.after(async () => {
    child.kill();
    await exited;
    await data?.cleanup();
  });
  return { child, exited, stdout: () => stdout, stderr: () => stderr };
}

async function printedUrl(cli) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(cli.stdout());
    if (match) return { url: match[0], port: Number(match[1]) };
    if (cli.child.exitCode !== null) throw new Error(`the server exited with ${cli.child.exitCode}: ${cli.stderr()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`no URL was printed. stdout: ${cli.stdout()} stderr: ${cli.stderr()}`);
}

const lanAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);

test('the command line serves the current folder on --port, keeps its data in --data and logs the URL', async (t) => {
  const data = await tempTree();
  const dataDir = join(data.dir, 'cli-data');
  const cli = runCli(t, ['--port', '0', '--data', dataDir], { data });
  const { url, port } = await printedUrl(cli);

  assert.ok(port > 0);
  assert.equal(await (await fetch(`${url}/`)).text(), 'fixture: index');
  assert.ok(existsSync(join(dataDir, 'db.sqlite')));
  assert.match(cli.stderr(), /\.dev\.vars/, 'no .dev.vars in the fixtures, so it warns');
  assert.equal(cli.stdout().includes('LAN'), false, 'only --lan prints LAN addresses');

  // Not bound to the LAN without --lan.
  for (const address of lanAddresses()) {
    await assert.rejects(fetch(`http://${address}:${port}/`, { signal: AbortSignal.timeout(5000) }), address);
  }
});

test('--lan binds every interface and prints one URL per LAN IPv4 address', async (t) => {
  const data = await tempTree();
  const cli = runCli(t, ['--lan', '--port', '0', '--data', join(data.dir, 'cli-data')], { data });
  const { url, port } = await printedUrl(cli);
  assert.equal(await (await fetch(`${url}/`)).text(), 'fixture: index');

  for (const address of lanAddresses()) {
    assert.ok(cli.stdout().includes(`http://${address}:${port}`), `${address} is listed`);
    const res = await fetch(`http://${address}:${port}/`, { signal: AbortSignal.timeout(5000) });
    assert.equal(await res.text(), 'fixture: index', `${address} answers`);
  }
});

test('the command line refuses a bad --port, an unknown flag and a port that is taken', async (t) => {
  for (const args of [['--port', 'abc'], ['--port', '70000'], ['--port', '-1'], ['--port'], ['--nope'], ['stray']]) {
    const cli = runCli(t, args);
    assert.equal(await cli.exited, 1, args.join(' '));
    assert.match(cli.stderr(), /--port|--lan|--data|Usage/i, args.join(' '));
    assert.equal(cli.stdout(), '', 'nothing is served');
  }

  const taken = await serve(t);
  const data = await tempTree();
  const cli = runCli(t, ['--port', String(taken.port), '--data', join(data.dir, 'cli-data')], { data });
  assert.equal(await cli.exited, 1);
  assert.match(cli.stderr(), new RegExp(`${taken.port}.*in use`, 's'));
});
