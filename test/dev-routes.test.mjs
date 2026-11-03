import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedMethods, buildRouteTable, findHandler, matchRoute } from '../dev/routes.mjs';
import { tempTree } from './helpers.mjs';

const FIXTURE_FUNCTIONS = fileURLToPath(new URL('./fixtures/functions', import.meta.url));

// A route table over a temp functions/ folder holding the given files. `files` maps a path inside
// functions/ to its source; a plain array of paths gives every file a do-nothing handler.
async function tableOf(t, files) {
  const sources = Array.isArray(files) ? Object.fromEntries(files.map((file) => [file, 'export const onRequest = () => {};\n'])) : files;
  const tree = await tempTree(Object.fromEntries(Object.entries(sources).map(([file, source]) => [`functions/${file}`, source])));
  t.after(tree.cleanup);
  return buildRouteTable(join(tree.dir, 'functions'));
}

const fileOf = (table, pathname) => matchRoute(table, pathname)?.route.file ?? null;

test('buildRouteTable maps files to URL patterns and ignores everything starting with "_"', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  // The fixtures also hold _lib/ignored.js, which must not show up.
  assert.deepEqual(Object.fromEntries(table.map((route) => [route.file, route.pattern])), {
    'index.js': '/',
    'sitemap.xml.js': '/sitemap.xml',
    'img/[id]/[variant].js': '/img/[id]/[variant]',
    'api/admin/[[path]].js': '/api/admin/[[path]]',
    'api/static.js': '/api/static',
    'api/[name].js': '/api/[name]',
  });
});

test('index.js maps to its folder; only .js and .mjs files are routes; "_" files and folders are not', async (t) => {
  const table = await tableOf(t, [
    'index.js',
    'docs/index.js',
    'a/b/index.js',
    'plain.js',
    'module.mjs',
    'index/inner.js', // only the file index.js is special, not a folder called index
    '_middleware.js',
    '_private/hidden.js',
    'docs/_helper.js',
    'readme.md',
    'data.json',
  ]);
  assert.deepEqual(table.map((route) => route.pattern).sort(), ['/', '/a/b', '/docs', '/index/inner', '/module', '/plain']);
});

test('a missing functions folder gives an empty table, and nothing matches it', async (t) => {
  const tree = await tempTree();
  t.after(tree.cleanup);
  const table = await buildRouteTable(join(tree.dir, 'functions'));
  assert.deepEqual(table, []);
  assert.equal(matchRoute(table, '/'), null);
});

test('a catch-all must be the last segment', async (t) => {
  await assert.rejects(tableOf(t, ['[[rest]]/more.js']), /catch-all.*last/i);
});

test('a function file that fails to load makes buildRouteTable fail, naming the file and keeping the cause', async (t) => {
  await assert.rejects(tableOf(t, { 'ok.js': 'export const onRequest = () => {};\n', 'sub/broken.js': 'export const onRequest = (;\n' }), (error) => {
    assert.match(error.message, /sub\/broken\.js/);
    assert.ok(error.cause instanceof SyntaxError, 'the original error is the cause');
    return true;
  });
});

test('static beats [x] beats [[x]]: /api/static, /api/other and /api/admin/... go to the right files', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  const match = (pathname) => {
    const found = matchRoute(table, pathname);
    return found && { file: found.route.file, params: found.params };
  };

  assert.deepEqual(match('/api/static'), { file: 'api/static.js', params: {} });
  assert.deepEqual(match('/api/other'), { file: 'api/[name].js', params: { name: 'other' } });
  assert.deepEqual(match('/api/admin/photos/abc/replace'), {
    file: 'api/admin/[[path]].js',
    params: { path: ['photos', 'abc', 'replace'] },
  });
});

test('[[x]] matches zero segments too, and a static segment still beats [x] there', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  // api/[name].js would also match /api/admin, but "admin" is a static segment of the catch-all route.
  for (const pathname of ['/api/admin', '/api/admin/']) {
    assert.deepEqual(matchRoute(table, pathname).params, { path: [] }, pathname);
    assert.equal(matchRoute(table, pathname).route.file, 'api/admin/[[path]].js', pathname);
  }
  assert.deepEqual(matchRoute(table, '/api/admin/one').params, { path: ['one'] });
});

test('/ goes to index.js, /sitemap.xml to sitemap.xml.js, and [x] params are captured by name', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  assert.equal(fileOf(table, '/'), 'index.js');
  assert.equal(fileOf(table, '/sitemap.xml'), 'sitemap.xml.js');
  const img = matchRoute(table, '/img/0123abcd/thumb');
  assert.equal(img.route.file, 'img/[id]/[variant].js');
  assert.deepEqual(img.params, { id: '0123abcd', variant: 'thumb' });
});

test('_lib is not a route, and paths with no route match nothing', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  for (const pathname of ['/_lib/ignored', '/_lib', '/nope', '/api', '/index', '/sitemap']) {
    assert.equal(matchRoute(table, pathname), null, pathname);
  }
});

test('a route matches its exact segment count: [x] is one segment, extra or missing ones do not match', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  for (const pathname of ['/img/abc', '/img/abc/full/extra', '/api/static/extra', '/sitemap.xml/extra']) {
    assert.equal(matchRoute(table, pathname), null, pathname);
  }
});

test('a trailing slash is ignored, but an empty segment matches nothing', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  assert.equal(fileOf(table, '/api/static/'), 'api/static.js');
  assert.equal(fileOf(table, '/img/abc/full/'), 'img/[id]/[variant].js');
  for (const pathname of ['/api//static', '//', '//api/static', '/img//full']) {
    assert.equal(matchRoute(table, pathname), null, pathname);
  }
});

test('path segments are percent-decoded one by one: %2F stays inside its segment, a bad escape is kept as typed', async (t) => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  assert.deepEqual(matchRoute(table, '/api/caf%C3%A9').params, { name: 'café' });
  assert.deepEqual(matchRoute(table, '/api/a%2Fb').params, { name: 'a/b' });
  assert.deepEqual(matchRoute(table, '/api/100%25').params, { name: '100%' });
  assert.deepEqual(matchRoute(table, '/api/100%').params, { name: '100%' });
  assert.deepEqual(matchRoute(table, '/api/admin/a%20b/c%2Fd').params, { path: ['a b', 'c/d'] });

  // A static segment compares with the decoded text, which is how a browser sends a non-ASCII name.
  const unicode = await tableOf(t, ['çınar.js']);
  assert.equal(fileOf(unicode, '/%C3%A7%C4%B1nar'), 'çınar.js');
});

test('priority does not depend on the order the files are listed in', async (t) => {
  // Sorted by name, the catch-all would come first and the exact name last.
  const table = await tableOf(t, ['[x].js', '[[y]].js', 'foo.js']);
  assert.equal(fileOf(table, '/foo'), 'foo.js');
  assert.equal(fileOf(table, '/bar'), '[x].js');
  assert.equal(fileOf(table, '/a/b'), '[[y]].js');
  assert.equal(fileOf(table, '/'), '[[y]].js', '[x] needs a segment, [[y]] takes none');
});

test('segments are compared from left to right: a static first segment wins over a later one', async (t) => {
  const table = await tableOf(t, ['[a]/x.js', 'y/[b].js']);
  assert.equal(fileOf(table, '/y/x'), 'y/[b].js');
  assert.equal(fileOf(table, '/z/x'), '[a]/x.js');
  assert.equal(fileOf(table, '/y/q'), 'y/[b].js');
});

test('within one folder the exact file, [x] and [[x]] rank in that order, and index.js beats the catch-all', async (t) => {
  const table = await tableOf(t, ['a/b.js', 'a/[c].js', 'a/[[d]].js', 'index.js', 'api/index.js', 'api/[[rest]].js', '[[all]].js']);
  assert.equal(fileOf(table, '/a/b'), 'a/b.js');
  assert.equal(fileOf(table, '/a/q'), 'a/[c].js');
  assert.equal(fileOf(table, '/a/q/r'), 'a/[[d]].js');
  assert.equal(fileOf(table, '/'), 'index.js');
  assert.equal(fileOf(table, '/api'), 'api/index.js');
  assert.equal(fileOf(table, '/api/x/y'), 'api/[[rest]].js');
  assert.equal(fileOf(table, '/elsewhere/deep'), '[[all]].js');
});

test('findHandler picks onRequest<Method> first, then onRequest, and nothing when neither exists', async () => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  const staticRoute = matchRoute(table, '/api/static').route;
  const { onRequestGet, onRequestPost, onRequest } = staticRoute.module;
  assert.equal(findHandler(staticRoute, 'GET'), onRequestGet, 'a method handler beats onRequest');
  assert.equal(findHandler(staticRoute, 'POST'), onRequestPost);
  assert.equal(findHandler(staticRoute, 'PUT'), onRequest, 'onRequest takes the rest');
  assert.equal(findHandler(staticRoute, 'DELETE'), onRequest);

  const sitemapRoute = matchRoute(table, '/sitemap.xml').route;
  assert.equal(findHandler(sitemapRoute, 'GET'), sitemapRoute.module.onRequestGet);
  assert.equal(findHandler(sitemapRoute, 'POST'), null);

  const adminRoute = matchRoute(table, '/api/admin/x').route;
  assert.equal(findHandler(adminRoute, 'PATCH'), adminRoute.module.onRequest);
});

test('findHandler ignores the case of the method and any export that is not a function', async (t) => {
  const table = await tableOf(t, {
    'patchy.js': 'export const onRequestPatch = () => {};\nexport const onRequestGet = 5;\nexport const onrequestPost = () => {};\n',
  });
  const route = matchRoute(table, '/patchy').route;
  assert.equal(findHandler(route, 'patch'), route.module.onRequestPatch);
  assert.equal(findHandler(route, 'PATCH'), route.module.onRequestPatch);
  assert.equal(findHandler(route, 'GET'), null, 'onRequestGet is not a function');
  assert.equal(findHandler(route, 'POST'), null, 'handler names are case sensitive');
  assert.equal(findHandler(route, 'CONSTRUCTOR'), null);
  assert.equal(findHandler(route, '__proto__'), null);
});

test('allowedMethods lists the methods that have a handler of their own, for the Allow header of a 405', async (t) => {
  const table = await buildRouteTable(FIXTURE_FUNCTIONS);
  assert.deepEqual(allowedMethods(matchRoute(table, '/sitemap.xml').route), ['GET']);
  assert.deepEqual(allowedMethods(matchRoute(table, '/api/static').route), ['GET', 'POST']);

  // Only functions count: a value named like a handler, or a helper with any other name, does not.
  const several = await tableOf(t, {
    'many.js': [
      'export const onRequestDelete = () => {};',
      'export const onRequestGet = () => {};',
      'export const onRequestHead = () => {};',
      'export const onRequestOptions = () => {};',
      'export const onRequestPut = "not a function";',
      'export const helper = () => {};',
      '',
    ].join('\n'),
  });
  assert.deepEqual(allowedMethods(matchRoute(several, '/many').route), ['DELETE', 'GET', 'HEAD', 'OPTIONS']);
});
