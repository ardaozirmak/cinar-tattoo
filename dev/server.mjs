// The local stand-in for Cloudflare Pages: serves public/, runs the Functions in functions/ and
// gives them D1 and KV from dev/d1.mjs and dev/kv.mjs.
//
//   node dev/server.mjs [--port N] [--lan] [--data DIR]
//
// A request goes to the Function whose file matches its path (dev/routes.mjs), else to the static
// files (dev/static.mjs). A Function sees `env` = the vars + DB + IMAGES + ASSETS, as on Pages.
//
// Differences from the real thing:
// - There is no TLS. request.url is always http://<the Host header>, so a phone that opens
//   http://192.168.1.20:8788 sends an Origin that equals the request's origin. Browsers do not keep
//   `Secure` cookies from plain http, which is why DEV_INSECURE_COOKIES=1 is added to the vars.
// - CF-Connecting-IP is the socket's address, whatever the client sent. There is no other cf-*
//   header and no request.cf.
// - The context a Function gets is { request, env, params, data, waitUntil, next }. next() serves
//   from the static files; waitUntil() only logs a task that fails. Responses are not compressed.
// - close() cuts connections that are still open.
import { createServer } from 'node:http';
import { existsSync, realpathSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createD1 } from './d1.mjs';
import { createKV } from './kv.mjs';
import { allowedMethods, buildRouteTable, findHandler, matchRoute } from './routes.mjs';
import { createAssets } from './static.mjs';
import { loadVars } from './vars.mjs';

const TEXT = 'text/plain; charset=utf-8';

/**
 * Runs one request: the Function that matches its path, else the static files. It always comes
 * back with a Response: a Function that throws or returns something else is logged and answered
 * with a 500, and a route without a handler for the method is a 405.
 * @param {Request} request
 * @param {{ table: import('./routes.mjs').Route[], env: object, assets: { fetch(input: Request): Promise<Response> } }} context
 * @returns {Promise<Response>}
 */
export async function dispatch(request, { table, env, assets }) {
  const { pathname } = new URL(request.url);
  const label = `${request.method} ${pathname}`;
  try {
    const match = matchRoute(table, pathname);
    if (match === null) return await assets.fetch(request);

    const handler = findHandler(match.route, request.method);
    if (handler === null) return methodNotAllowed(match.route);

    const response = await handler({
      request,
      env,
      params: match.params,
      data: {},
      waitUntil: (task) => {
        Promise.resolve(task).catch((error) => console.error(`dev: ${label}: a waitUntil task failed\n${describeError(error)}`));
      },
      next: () => assets.fetch(request),
    });
    if (!(response instanceof Response)) {
      throw new TypeError(`${match.route.file} returned ${response === null ? 'null' : typeof response} instead of a Response.`);
    }
    return response;
  } catch (error) {
    console.error(`dev: ${label} failed\n${describeError(error)}`);
    return new Response('Internal Server Error', { status: 500, headers: { 'content-type': TEXT } });
  }
}

/**
 * Starts the emulator over the project in `root` (its functions/ and public/ folders), with the
 * database in `<dataDir>/db.sqlite` and the images in `<dataDir>/kv`; a relative dataDir is
 * relative to root. `vars` are the secrets: when they are not passed, `.dev.vars` is read from root,
 * falling back to `.dev.vars.example` with a warning. DEV_INSECURE_COOKIES=1 is added to them unless
 * they set it. Port 0 picks a free port.
 * @returns {Promise<{ url: string, port: number, close(): Promise<void> }>}
 */
export async function startServer({ port = 8788, host = '127.0.0.1', root = process.cwd(), dataDir = '.dev', vars } = {}) {
  const projectRoot = resolve(root);
  const dataPath = resolve(projectRoot, dataDir);

  const table = await buildRouteTable(join(projectRoot, 'functions'));
  const assets = createAssets(join(projectRoot, 'public'));
  const secrets = vars ?? loadDevVars(projectRoot);

  const DB = createD1(join(dataPath, 'db.sqlite'));
  let server;
  try {
    const env = { DEV_INSECURE_COOKIES: '1', ...secrets, DB, IMAGES: createKV(join(dataPath, 'kv')), ASSETS: assets };
    server = createServer((req, res) => {
      handle(req, res, { table, env, assets }).catch((error) => {
        console.error(`dev: ${req.method} ${req.url} failed\n${describeError(error)}`);
        if (res.headersSent) {
          res.destroy();
        } else {
          res.writeHead(500, { 'content-type': TEXT });
          res.end('Internal Server Error');
        }
      });
    });
    await listen(server, port, host);
  } catch (error) {
    // Windows cannot delete a database file that is still open.
    DB.close();
    throw error;
  }

  const actualPort = server.address().port;
  let closing;
  const close = () => {
    closing ??= (async () => {
      await new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeAllConnections();
      });
      DB.close();
    })();
    return closing;
  };
  return { url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`, port: actualPort, close };
}

function listen(server, port, host) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

async function handle(req, res, context) {
  let request;
  try {
    request = toRequest(req);
  } catch {
    res.writeHead(400, { 'content-type': TEXT });
    res.end('Bad Request');
    return;
  }
  await send(res, await dispatch(request, context), req.method === 'HEAD');
}

// The request body as a web stream. Whatever arrives is queued at once, with no backpressure, so
// the connection never depends on what the Function does with the body. A Function that answers
// without reading it (a 401 sent before it looks at an upload), stops reading half way, or cancels
// the stream (a size limit) leaves nothing stuck on the wire. Readable.toWeb(req) would, and
// cancelling it would even destroy the socket, so that the client never saw the answer. The price
// is that a body sits in memory until it is read, which for photos of a few MB on a dev machine
// does not matter.
function bodyStream(req) {
  let cancelled = false;
  return new ReadableStream({
    start(controller) {
      req.on('data', (chunk) => {
        if (!cancelled) controller.enqueue(chunk);
      });
      req.once('end', () => {
        if (!cancelled) controller.close();
      });
      req.once('error', (error) => {
        if (!cancelled) controller.error(error);
      });
    },
    cancel() {
      cancelled = true;
    },
  });
}

// The Request a Function would get on Pages. The URL is built by gluing the Host header and the
// request target together, never by resolving one against the other: "GET //evil.test/x" would
// otherwise move the request to another host.
function toRequest(req) {
  const host = req.headers.host;
  if (!host || !req.url.startsWith('/')) throw new Error('A request needs a Host header and a path.');

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  // Cloudflare sets this itself; a client must not be able to.
  headers.delete('cf-connecting-ip');
  if (req.socket.remoteAddress !== undefined) headers.set('cf-connecting-ip', req.socket.remoteAddress);

  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && hasBody(req)) {
    init.body = bodyStream(req);
    init.duplex = 'half';
  }
  return new Request(`http://${host}${req.url}`, init);
}

// Whether the request carries a body: a Transfer-Encoding, or a Content-Length above zero.
// Without one, request.body is null, as in the Workers runtime.
function hasBody(req) {
  return req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
}

// Writes a Response to the socket. The headers go out as a flat list of name, value pairs, which
// unlike an object can hold one name twice: each Set-Cookie must be its own header, because
// joining them with a comma would break cookie dates (Expires=Wed, 21 Oct ...). Iterating Headers
// already yields every Set-Cookie separately.
async function send(res, response, head) {
  const headers = [];
  for (const [name, value] of response.headers) headers.push(name, value);
  res.writeHead(response.status, headers);

  // (A 204, 205 or 304 cannot have a body: the Response constructor refuses one.)
  if (head || response.body === null) {
    res.end();
    response.body?.cancel().catch(() => {});
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    // A client that goes away mid-response needs no reply. Anything else cannot change the status
    // any more, so say so and drop the connection.
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(`dev: the response body failed\n${describeError(error)}`);
    res.destroy();
  }
}

function methodNotAllowed(route) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { allow: allowedMethods(route).join(', '), 'content-type': TEXT },
  });
}

function describeError(error) {
  return error instanceof Error ? error.stack : String(error);
}

// `.dev.vars` is the local copy of the secrets. Without it the committed example is used so the
// project still starts, but the example's values are public, so say so: with --lan, anyone on the
// same network could open /admin with them.
function loadDevVars(root) {
  const own = join(root, '.dev.vars');
  if (existsSync(own)) return loadVars(own);

  const example = join(root, '.dev.vars.example');
  if (existsSync(example)) {
    console.warn('dev: .dev.vars was not found, so .dev.vars.example is used. Its values are public: copy it to .dev.vars and change them, especially before using --lan.');
    return loadVars(example);
  }
  console.warn('dev: neither .dev.vars nor .dev.vars.example was found, so ADMIN_PASSWORD and APP_SECRET are not set.');
  return {};
}

// ---- command line ----

const USAGE = `Usage: node dev/server.mjs [--port N] [--lan] [--data DIR]

  --port N    port to listen on (default 8788; 0 picks a free one)
  --lan       listen on every network interface and print the LAN addresses,
              to try the site on a phone on the same Wi-Fi
  --data DIR  folder for the database and the images (default .dev)`;

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string' }, lan: { type: 'boolean' }, data: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  const options = {};
  if (values.port !== undefined) {
    if (!/^\d+$/.test(values.port) || Number(values.port) > 65535) {
      throw new Error(`--port must be a number from 0 to 65535, not "${values.port}".`);
    }
    options.port = Number(values.port);
  }
  if (values.lan) options.host = '0.0.0.0';
  if (values.data !== undefined) options.dataDir = values.data;
  return { options, lan: Boolean(values.lan) };
}

function lanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal).map((entry) => ({ name, address: entry.address })),
  );
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  try {
    const server = await startServer(parsed.options);
    console.log(`Dev server running at ${server.url}`);
    if (parsed.lan) {
      const addresses = lanAddresses();
      if (addresses.length === 0) console.log('No LAN address found: is this computer on a network?');
      for (const { name, address } of addresses) console.log(`  LAN: http://${address}:${server.port}  (${name})`);
    }
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${parsed.options.port ?? 8788} is already in use. Stop the other server, or pick another port with --port N.`);
    } else {
      console.error(describeError(error));
    }
    process.exitCode = 1;
  }
}

// Whether this file is the script node was started with, as opposed to a module that a test or
// another script imports. Any launcher without a real script path (-e, a REPL) is "not main".
function isMainModule() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) await main(process.argv.slice(2));
