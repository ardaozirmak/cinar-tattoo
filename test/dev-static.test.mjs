import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssets, parseHeadersFile } from '../dev/static.mjs';
import { tempTree } from './helpers.mjs';

const FIXTURE_PUBLIC = fileURLToPath(new URL('./fixtures/public', import.meta.url));
const ORIGIN = 'https://cinar.test';

const sha1Etag = (bytes) => `"${createHash('sha1').update(bytes).digest('hex')}"`;
const get = (assets, path, init) => assets.fetch(new Request(ORIGIN + path, init));

// Assets over a temp public/ folder holding `files` (paths relative to public/). A test that also
// needs a file outside public/ uses `tempTree` directly.
async function publicOf(t, files) {
  const tree = await tempTree(Object.fromEntries(Object.entries(files).map(([file, content]) => [`public/${file}`, content])));
  t.after(tree.cleanup);
  return { assets: createAssets(join(tree.dir, 'public')), dir: join(tree.dir, 'public') };
}

test('serves a file with its content type, a quoted sha1 ETag and its length', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  const bytes = await readFile(join(FIXTURE_PUBLIC, 'a.txt'));

  const res = await get(assets, '/a.txt');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(res.headers.get('etag'), /^"[0-9a-f]{40}"$/);
  assert.equal(res.headers.get('etag'), sha1Etag(bytes));
  assert.equal(res.headers.get('content-length'), String(bytes.length));
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
});

test('fetch takes a Request, a URL, an absolute URL string or just a path, and a query string is ignored', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  const expected = await readFile(join(FIXTURE_PUBLIC, 'a.txt'), 'utf8');
  const inputs = [new Request(`${ORIGIN}/a.txt`), new URL(`${ORIGIN}/a.txt`), `${ORIGIN}/a.txt`, '/a.txt', `${ORIGIN}/a.txt?v=abc123`];
  for (const input of inputs) {
    const res = await assets.fetch(input);
    assert.equal(res.status, 200, String(input));
    assert.equal(await res.text(), expected, String(input));
  }
});

test('the object it returns has an own fetch that works detached from it (it is the env.ASSETS binding)', async () => {
  const { fetch } = createAssets(FIXTURE_PUBLIC);
  assert.equal((await fetch('/a.txt')).status, 200);
});

test('If-None-Match with the current ETag gives 304 without a body; another ETag gives the file', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  const etag = (await get(assets, '/a.txt')).headers.get('etag');

  const same = await get(assets, '/a.txt', { headers: { 'If-None-Match': etag } });
  assert.equal(same.status, 304);
  assert.equal(await same.text(), '');
  assert.equal(same.headers.get('etag'), etag);
  assert.equal(same.headers.get('x-fixture'), 'all', 'the _headers rules go on a 304 too');

  const other = await get(assets, '/a.txt', { headers: { 'If-None-Match': '"0000000000000000000000000000000000000000"' } });
  assert.equal(other.status, 200);
  assert.ok((await other.text()).length > 0);
});

test('If-None-Match also accepts a weak validator, a list of them and *', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  const etag = (await get(assets, '/a.txt')).headers.get('etag');
  for (const header of [`W/${etag}`, `"nope", ${etag}`, `${etag}, "nope"`, '*', ` ${etag} `]) {
    assert.equal((await get(assets, '/a.txt', { headers: { 'If-None-Match': header } })).status, 304, header);
  }
  for (const header of ['"nope"', '', `${etag}x`, `"x${etag.slice(1)}`]) {
    assert.equal((await get(assets, '/a.txt', { headers: { 'If-None-Match': header } })).status, 200, JSON.stringify(header));
  }
});

test('the ETag follows the content, and files are read on every request', async (t) => {
  const { assets, dir } = await publicOf(t, { 'a.txt': 'one' });
  const first = (await get(assets, '/a.txt')).headers.get('etag');

  await writeFile(join(dir, 'a.txt'), 'two');
  const second = await get(assets, '/a.txt', { headers: { 'If-None-Match': first } });
  assert.equal(second.status, 200, 'the old ETag no longer matches');
  assert.equal(await second.text(), 'two');
  assert.equal(second.headers.get('etag'), sha1Etag('two'));
  assert.notEqual(second.headers.get('etag'), first);
});

test('a directory serves its index.html as /dir/ and /dir, and /page serves page.html', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  for (const path of ['/dir/', '/dir', '/dir/index.html']) {
    const res = await get(assets, path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', path);
    assert.match(await res.text(), /fixture dir index/, path);
  }
  for (const path of ['/page', '/page.html']) {
    const res = await get(assets, path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /fixture page/, path);
  }
});

test('/ serves index.html when there is one; with both x.html and x/index.html, /x wins for the file and /x/ for the folder', async (t) => {
  const { assets } = await publicOf(t, {
    'index.html': 'root index',
    'both.html': 'both: file',
    'both/index.html': 'both: folder index',
    'thing': 'thing: bare file',
    'thing.html': 'thing: html',
  });
  assert.equal(await (await get(assets, '/')).text(), 'root index');
  assert.equal(await (await get(assets, '/both')).text(), 'both: file');
  assert.equal(await (await get(assets, '/both/')).text(), 'both: folder index');
  assert.equal(await (await get(assets, '/thing')).text(), 'thing: bare file', 'an exact file beats x.html');
  assert.equal(await (await get(assets, '/thing.html')).text(), 'thing: html');
});

test('an unknown path gets 404.html with status 404; _headers still apply, there is no ETag and no 304', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  for (const path of ['/nope', '/dir/missing.txt', '/a.txt/', '/dir/nothing/', '/']) {
    const res = await get(assets, path, { headers: { 'If-None-Match': '*' } });
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', path);
    assert.equal(res.headers.get('etag'), null, path);
    assert.equal(res.headers.get('x-fixture'), 'all', path);
    assert.match(await res.text(), /fixture not found/, path);
  }
});

test('without a 404.html the 404 is plain text, and HEAD gets the same headers without the body', async (t) => {
  const { assets } = await publicOf(t, { 'ok.txt': 'ok' });
  const res = await get(assets, '/nope');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await res.text(), 'Not found');

  const head = await get(assets, '/nope', { method: 'HEAD' });
  assert.equal(head.status, 404);
  assert.equal(head.headers.get('content-length'), '9');
  assert.equal(await head.text(), '');
});

test('a public folder that does not exist yet answers 404 to everything instead of crashing', async (t) => {
  const tree = await tempTree();
  t.after(tree.cleanup);
  const assets = createAssets(join(tree.dir, 'public'));
  for (const path of ['/', '/a.txt', '/dir/', '/_headers']) {
    const res = await get(assets, path);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), 'Not found', path);
  }
});

test('HEAD answers like GET without a body, and 404 stays 404', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  const getRes = await get(assets, '/a.txt');
  const head = await get(assets, '/a.txt', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('etag'), getRes.headers.get('etag'));
  assert.equal(head.headers.get('content-length'), getRes.headers.get('content-length'));
  assert.equal(head.headers.get('content-type'), getRes.headers.get('content-type'));
  assert.equal(head.headers.get('x-fixture'), 'all');
  assert.equal(await head.text(), '');

  const missing = await get(assets, '/nope', { method: 'HEAD' });
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), '');
});

test('only GET and HEAD are served: anything else is 405 with an Allow header', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const res = await get(assets, '/a.txt', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, HEAD', method);
  }
});

test('content types by extension, case-insensitive, and octet-stream for anything else', async (t) => {
  const expected = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    json: 'application/json',
    webmanifest: 'application/manifest+json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    woff2: 'font/woff2',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml',
    ico: 'image/x-icon',
  };
  const files = { 'UPPER.PNG': 'x', 'unknown.xyz': 'x', LICENSE: 'x', 'dotted.name.css': 'x' };
  for (const ext of Object.keys(expected)) files[`file.${ext}`] = 'x';
  const { assets } = await publicOf(t, files);

  for (const [ext, type] of Object.entries(expected)) {
    assert.equal((await get(assets, `/file.${ext}`)).headers.get('content-type'), type, ext);
  }
  assert.equal((await get(assets, '/UPPER.PNG')).headers.get('content-type'), 'image/png');
  assert.equal((await get(assets, '/dotted.name.css')).headers.get('content-type'), 'text/css; charset=utf-8', 'the last extension counts');
  assert.equal((await get(assets, '/unknown.xyz')).headers.get('content-type'), 'application/octet-stream');
  assert.equal((await get(assets, '/LICENSE')).headers.get('content-type'), 'application/octet-stream');
});

test('binary files come back byte for byte', async (t) => {
  const everyByte = Uint8Array.from({ length: 256 }, (_, i) => i);
  const { assets } = await publicOf(t, { 'bytes.png': everyByte });
  const res = await get(assets, '/bytes.png');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), everyByte);
  assert.equal(res.headers.get('content-length'), '256');
});

test('percent-encoded names work: non-ASCII letters and spaces', async (t) => {
  const { assets } = await publicOf(t, { 'çınar tattoo.txt': 'merhaba' });
  assert.equal(await (await get(assets, '/%C3%A7%C4%B1nar%20tattoo.txt')).text(), 'merhaba');
  assert.equal(await (await get(assets, '/çınar tattoo.txt')).text(), 'merhaba');
  assert.equal((await get(assets, '/%E0%A4%A')).status, 404, 'a malformed escape is a 404, not a crash');
});

test('_headers: every matching block applies in file order, "*" is a splat, repeated names are joined with ", "', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  const headersOf = async (path) => Object.fromEntries([...(await get(assets, path)).headers].filter(([name]) => name.startsWith('x-') || name === 'link'));

  // /* then /a.txt
  assert.deepEqual(await headersOf('/a.txt'), { 'x-fixture': 'all', 'x-joined': 'one, two', 'x-exact': 'yes' });
  // /* only
  assert.deepEqual(await headersOf('/page.html'), { 'x-fixture': 'all', 'x-joined': 'one' });
  // /* then /dir/*, whose Link appears twice and whose X-Url has colons in the value
  assert.deepEqual(await headersOf('/dir/'), {
    'x-fixture': 'all',
    'x-joined': 'one',
    'x-splat': 'dir',
    'x-url': 'http://example.test:8080/x',
    link: '</one>; rel=preload, </two>; rel=preload',
  });
  // The rule is matched against the requested path, not the file behind it: /dir is not /dir/*.
  assert.deepEqual(await headersOf('/dir'), { 'x-fixture': 'all', 'x-joined': 'one' });
});

test('_headers patterns: "*" crosses slashes, an exact path matches only itself, other characters are literal', async (t) => {
  const { assets } = await publicOf(t, {
    '_headers': [
      '/a.b',
      '  X-Dot: yes',
      '/files/*',
      '  X-Files: yes',
      '/x/*/y',
      '  X-Mid: yes',
      '/(group)+[1]',
      '  X-Meta: yes',
      '/*',
      '  X-All: yes',
      '',
    ].join('\n'),
  });
  const has = async (path, header) => (await get(assets, path)).headers.get(header) === 'yes';

  assert.ok(await has('/a.b', 'x-dot'));
  assert.ok(!(await has('/aXb', 'x-dot')), 'the dot is not a wildcard');
  assert.ok(!(await has('/a.b/more', 'x-dot')), 'an exact path does not match longer ones');

  assert.ok(await has('/files/', 'x-files'));
  assert.ok(await has('/files/a/b/c.txt', 'x-files'));
  assert.ok(!(await has('/files', 'x-files')));

  assert.ok(await has('/x/p/q/y', 'x-mid'));
  assert.ok(!(await has('/x/p/q/z', 'x-mid')));

  assert.ok(await has('/(group)+[1]', 'x-meta'));
  assert.ok(!(await has('/groupgroup1', 'x-meta')), 'regex characters are literal');

  assert.ok(await has('/', 'x-all'), '/* matches the root');
  assert.ok(await has('/anything/at/all', 'x-all'));
  assert.ok(await has('/a.b?query=1', 'x-dot'), 'the query string is not part of the match');
});

test('_headers is read on every request, so an edit needs no restart; without the file there are no extra headers', async (t) => {
  const { assets, dir } = await publicOf(t, { 'a.txt': 'x' });
  assert.equal((await get(assets, '/a.txt')).headers.get('x-test'), null);

  await writeFile(join(dir, '_headers'), '/*\n  X-Test: first\n');
  assert.equal((await get(assets, '/a.txt')).headers.get('x-test'), 'first');
  await writeFile(join(dir, '_headers'), '/*\n  X-Test: second\n');
  assert.equal((await get(assets, '/a.txt')).headers.get('x-test'), 'second');
  await rm(join(dir, '_headers'));
  assert.equal((await get(assets, '/a.txt')).headers.get('x-test'), null);
});

test('a _headers rule replaces a header the emulator set itself, such as Content-Type', async (t) => {
  const { assets } = await publicOf(t, { 'a.txt': 'x', '_headers': '/a.txt\n  Content-Type: text/x-custom\n' });
  assert.equal((await get(assets, '/a.txt')).headers.get('content-type'), 'text/x-custom');
});

test('_headers itself is never served, however it is spelled', async () => {
  const assets = createAssets(FIXTURE_PUBLIC);
  const paths = ['/_headers', '/_HEADERS', '/_Headers', '/%5Fheaders', '/_headers/', '/_headers::$DATA', '/_headers%3A%3A%24DATA', '/_headers:stream'];
  for (const path of paths) {
    const res = await get(assets, path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(await res.text(), /X-Fixture: all|# Rules for/, path);
  }
});

test('anything that resolves outside the public folder is a 404 and never reads the file', async (t) => {
  const tree = await tempTree({
    'secret.txt': 'TOP SECRET OUTSIDE THE PUBLIC FOLDER',
    'public/ok.txt': 'fine',
    'public/sub/ok.txt': 'fine too',
    'public/404.html': '<p>nothing here</p>',
  });
  t.after(tree.cleanup);
  const assets = createAssets(join(tree.dir, 'public'));

  // The setup serves what is inside, so the 404s below are not just a broken setup.
  assert.equal(await (await get(assets, '/ok.txt')).text(), 'fine');
  assert.equal(await (await get(assets, '/sub/ok.txt')).text(), 'fine too');

  const attacks = [
    '/../secret.txt',
    '/sub/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E/secret.txt',
    '/sub/%2e%2e/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/..%2Fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/sub%2f..%2f..%2fsecret.txt',
    '/sub/..%2f..%2fsecret.txt',
    '/..%5csecret.txt',
    '/%2e%2e%5csecret.txt',
    '/sub%5c..%5c..%5csecret.txt',
    '/..\\secret.txt',
    '/sub\\..\\..\\secret.txt',
    '/C:/secret.txt',
    '/c%3A/secret.txt',
    '/C%3A%5Csecret.txt',
    '/ok.txt::$DATA',
    '/ok.txt:stream',
    '/ok.txt%00.png',
    '/%00',
    '/sub/%00/ok.txt',
  ];
  for (const path of attacks) {
    const res = await get(assets, path);
    const body = await res.text();
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(body, /TOP SECRET/, path);
  }
});

test('an encoded slash or backslash is part of a name, not a separator, even when the path stays inside the folder', async (t) => {
  const { assets } = await publicOf(t, { 'sub/ok.txt': 'fine' });
  assert.equal((await get(assets, '/sub/ok.txt')).status, 200);
  // These would reach sub/ok.txt if %2F or %5C were turned into a separator before looking the file up.
  for (const path of ['/sub%2fok.txt', '/sub%2Fok.txt', '/sub%5cok.txt', '/sub%5Cok.txt']) {
    assert.equal((await get(assets, path)).status, 404, path);
  }
});

test('"//" in the path is a 404', async (t) => {
  const { assets } = await publicOf(t, { 'ok.txt': 'fine', 'sub/ok.txt': 'fine too' });
  for (const path of ['//ok.txt', '/sub//ok.txt', '//']) {
    assert.equal((await get(assets, path)).status, 404, path);
  }
});

test('parseHeadersFile reads blocks: an unindented pattern, then indented "Name: value" lines', () => {
  const text = [
    '# comment lines and blank lines are skipped',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/admin',
    '/admin/*',
    "\tContent-Security-Policy: default-src 'self'; img-src 'self' blob: data:",
    '  X-Robots-Tag:noindex',
    '  # an indented comment',
    '/*',
    '  X-Content-Type-Options: nosniff',
  ].join('\n');

  assert.deepEqual(parseHeadersFile(text), [
    { pattern: '/assets/*', headers: [['Cache-Control', 'public, max-age=31536000, immutable']] },
    { pattern: '/admin', headers: [] },
    {
      pattern: '/admin/*',
      headers: [
        ['Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:"],
        ['X-Robots-Tag', 'noindex'],
      ],
    },
    { pattern: '/*', headers: [['X-Content-Type-Options', 'nosniff']] },
  ]);
});

test('parseHeadersFile keeps colons in values and repeated names, and copes with CRLF and a BOM', () => {
  const BOM = String.fromCharCode(0xfeff);
  const text = `${BOM}/page  \r\n  Link: <https://a.test:8443/x>; rel=preload\r\n  Link: </y>; rel=preload\r\n  X-Time: 12:30:45  \r\n`;
  assert.deepEqual(parseHeadersFile(text), [
    {
      pattern: '/page',
      headers: [
        ['Link', '<https://a.test:8443/x>; rel=preload'],
        ['Link', '</y>; rel=preload'],
        ['X-Time', '12:30:45'],
      ],
    },
  ]);
});

test('parseHeadersFile skips what it cannot read: header lines before a pattern, lines without a name or a colon, values Headers would refuse', () => {
  const text = [
    '  X-Orphan: before any pattern',
    '/ok',
    '  no colon here',
    '  : no name',
    '  Bad Name: has a space',
    '  X-Wide: çınar', // "ı" is outside Latin-1, which Headers rejects with a TypeError
    '  X-Latin-1: çok', // "ç" is inside it
    '  X-Fine: yes',
    '  X-Empty:',
  ].join('\n');
  assert.deepEqual(parseHeadersFile(text), [
    {
      pattern: '/ok',
      headers: [
        ['X-Latin-1', 'çok'],
        ['X-Fine', 'yes'],
        ['X-Empty', ''],
      ],
    },
  ]);
  assert.deepEqual(parseHeadersFile(''), []);
  assert.deepEqual(parseHeadersFile('# only a comment\n\n'), []);
});

// ---------------------------------------------------------------------------------------------
// Video and byte ranges (Task 6): iOS Safari plays a video only from a server that answers ranges.
// ---------------------------------------------------------------------------------------------

const CLIP = Buffer.from('0123456789abcdefghij'); // 20 bytes

test('an .mp4 is video/mp4, and every file says it takes byte ranges', async (t) => {
  const { assets } = await publicOf(t, { 'clip.mp4': CLIP });
  const res = await get(assets, '/clip.mp4');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), CLIP);
});

test('Range: bytes=2-5 is a 206 with those 4 bytes; bytes=15- runs to the end; an end past the file is capped', async (t) => {
  const { assets } = await publicOf(t, { 'clip.mp4': CLIP });
  const res = await get(assets, '/clip.mp4', { headers: { Range: 'bytes=2-5' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/20');
  assert.equal(res.headers.get('content-length'), '4');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), '2345');

  const tail = await get(assets, '/clip.mp4', { headers: { Range: 'bytes=15-' } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), 'bytes 15-19/20');
  assert.equal(Buffer.from(await tail.arrayBuffer()).toString(), 'fghij');

  const capped = await get(assets, '/clip.mp4', { headers: { Range: 'bytes=18-99' } });
  assert.equal(capped.status, 206);
  assert.equal(capped.headers.get('content-range'), 'bytes 18-19/20');
});

test('Range: bytes=20- starts past the end: 416 with Content-Range bytes */20', async (t) => {
  const { assets } = await publicOf(t, { 'clip.mp4': CLIP });
  const res = await get(assets, '/clip.mp4', { headers: { Range: 'bytes=20-' } });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */20');
  await res.arrayBuffer();
});

test('a range this server does not do (other units, several ranges, a suffix, start after end) gets the whole file', async (t) => {
  const { assets } = await publicOf(t, { 'clip.mp4': CLIP });
  for (const range of ['lines=1', 'bytes=0-1,4-5', 'bytes=-5', 'bytes=6-2', 'bytes=x-']) {
    const res = await get(assets, '/clip.mp4', { headers: { Range: range } });
    assert.equal(res.status, 200, range);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), CLIP, range);
  }
});
