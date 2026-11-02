import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1 } from '../dev/d1.mjs';

// An in-memory database per test, closed when the test ends.
function memoryDb(t) {
  const db = createD1(':memory:');
  t.after(() => db.close());
  return db;
}

// The same, with a small table to write to.
async function tableDb(t) {
  const db = memoryDb(t);
  await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  return db;
}

const rowsOf = async (stmt) => (await stmt.all()).results;

// assert.deepEqual here is the strict one, so it also compares prototypes: the plain
// `{ ... }` expectations below fail if rows come back with node:sqlite's null prototype.

test('first() returns null when no row matches', async (t) => {
  const db = memoryDb(t);
  assert.equal(await db.prepare('SELECT 1 AS a WHERE 0').first(), null);
  assert.equal(await db.prepare('SELECT 1 AS a WHERE 0').first('a'), null);
});

test('first() returns the first row as a plain object', async (t) => {
  const db = memoryDb(t);
  assert.deepEqual(await db.prepare('SELECT 7 AS a, ? AS b UNION ALL SELECT 8, 9').bind('x').first(), { a: 7, b: 'x' });
});

test('first(col) returns the column value', async (t) => {
  const db = memoryDb(t);
  assert.equal(await db.prepare('SELECT 7 AS a').first('a'), 7);
  assert.equal(await db.prepare('SELECT NULL AS a').first('a'), null, 'a NULL column is not a missing column');
});

test('first(col) throws D1_COLUMN_NOTFOUND for unknown col', async (t) => {
  const db = memoryDb(t);
  await assert.rejects(db.prepare('SELECT 7 AS a').first('nope'), /D1_COLUMN_NOTFOUND: Column not found \(nope\)/);
});

test('bind(undefined) throws D1_TYPE_ERROR', async (t) => {
  const db = memoryDb(t);
  assert.throws(() => db.prepare('SELECT ? AS a').bind(undefined), /D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'/);
  assert.throws(() => db.prepare('SELECT ?, ?').bind(1, undefined), /D1_TYPE_ERROR/);
});

test('bind() rejects values D1 cannot store instead of binding NULL', async (t) => {
  const db = memoryDb(t);
  // node:sqlite binds {} and friends as NULL without complaint.
  for (const bad of [{}, [1], new Date(0), 5n, Symbol('s'), () => 1, Object.create(null)]) {
    assert.throws(() => db.prepare('SELECT ? AS a').bind(bad), /D1_TYPE_ERROR/);
  }
});

test('booleans bind as 1/0', async (t) => {
  const db = memoryDb(t);
  assert.equal(await db.prepare('SELECT ? AS a').bind(true).first('a'), 1);
  assert.equal(await db.prepare('SELECT ? AS a').bind(false).first('a'), 0);
});

test('strings, numbers and null bind as themselves', async (t) => {
  const db = memoryDb(t);
  const row = await db.prepare('SELECT ? AS s, ? AS i, ? AS r, ? AS n').bind('çınar', 42, 1.5, null).first();
  assert.deepEqual(row, { s: 'çınar', i: 42, r: 1.5, n: null });
});

test('ArrayBuffers and typed-array views bind as BLOBs', async (t) => {
  const db = memoryDb(t);
  const describe = (value) => db.prepare('SELECT length(?) AS bytes, typeof(?) AS type').bind(value, value).first();
  assert.deepEqual(await describe(new ArrayBuffer(4)), { bytes: 4, type: 'blob' });
  assert.deepEqual(await describe(Uint8Array.of(1, 2, 3, 4, 5).subarray(1, 4)), { bytes: 3, type: 'blob' });
  assert.deepEqual(await describe(new DataView(new ArrayBuffer(8), 2, 3)), { bytes: 3, type: 'blob' });
});

test('run() reports changes and last_row_id', async (t) => {
  const db = await tableDb(t);
  const insert = db.prepare('INSERT INTO t (v) VALUES (?)');

  const first = await insert.bind('a').run();
  assert.equal(first.success, true);
  assert.equal(first.meta.changes, 1);
  assert.equal(first.meta.last_row_id, 1);
  assert.equal(typeof first.meta.duration, 'number');

  assert.equal((await insert.bind('b').run()).meta.last_row_id, 2);
  assert.equal((await db.prepare('UPDATE t SET v = ?').bind('z').run()).meta.changes, 2);
  assert.equal((await db.prepare('DELETE FROM t WHERE id = ?').bind(99).run()).meta.changes, 0);
  assert.equal((await db.prepare('DELETE FROM t').run()).meta.changes, 2);
});

test('a read does not inherit changes and last_row_id from an earlier write', async (t) => {
  const db = await tableDb(t);
  await db.prepare('INSERT INTO t (v) VALUES (?)').bind('a').run();

  for (const result of [await db.prepare('SELECT * FROM t').all(), await db.prepare('SELECT * FROM t').run()]) {
    assert.equal(result.meta.changes, 0);
    assert.equal(result.meta.last_row_id, 0);
  }
});

test('all() returns {results, success:true, meta}', async (t) => {
  const db = memoryDb(t);
  const res = await db.prepare('SELECT 1 AS a UNION ALL SELECT 2').all();
  assert.deepEqual(res.results, [{ a: 1 }, { a: 2 }]);
  assert.equal(res.success, true);
  assert.equal(res.meta.changes, 0);
  assert.equal(res.meta.last_row_id, 0);
  assert.equal(typeof res.meta.duration, 'number');
  assert.ok(res.meta.duration >= 0);

  assert.deepEqual((await db.prepare('SELECT 1 WHERE 0').all()).results, []);
});

test('raw() returns rows as arrays of values', async (t) => {
  const db = memoryDb(t);
  assert.deepEqual(await db.prepare('SELECT 1 AS a, ? AS b UNION ALL SELECT 3, 4').bind('x').raw(), [[1, 'x'], [3, 4]]);
  assert.deepEqual(await db.prepare('SELECT 1 WHERE 0').raw(), []);
});

test('bind() returns a new statement, so one prepared statement can be reused with different values', async (t) => {
  const db = await tableDb(t);
  const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
  const a = insert.bind('a');
  const b = insert.bind('b');
  assert.notEqual(a, b);

  await db.batch([a, b, insert.bind('c')]);
  assert.deepEqual(await rowsOf(db.prepare('SELECT v FROM t ORDER BY id')), [{ v: 'a' }, { v: 'b' }, { v: 'c' }]);
});

test('batch() is atomic: a failing statement rolls back the earlier ones', async (t) => {
  const db = await tableDb(t);
  const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)');

  await assert.rejects(db.batch([insert.bind(1, 'a'), insert.bind(2, 'b'), insert.bind(1, 'duplicate id')]), /D1_ERROR: UNIQUE constraint failed/);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM t').first('n'), 0);

  // ...and the database is usable afterwards (the transaction really ended).
  await db.batch([insert.bind(1, 'a')]);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM t').first('n'), 1);
});

test('batch() returns one result per statement, in order, and later statements see earlier writes', async (t) => {
  const db = await tableDb(t);
  const [inserted, counted] = await db.batch([
    db.prepare('INSERT INTO t (v) VALUES (?)').bind('a'),
    db.prepare('SELECT count(*) AS n FROM t'),
  ]);
  assert.equal(inserted.success, true);
  assert.equal(inserted.meta.changes, 1);
  assert.equal(inserted.meta.last_row_id, 1);
  assert.deepEqual(counted.results, [{ n: 1 }]);

  assert.deepEqual(await db.batch([]), []);
});

test('batch() runs synchronously, so other writes cannot slip into its transaction', async (t) => {
  const db = await tableDb(t);
  const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)');

  const failing = db.batch([insert.bind(1, 'in the batch'), insert.bind(1, 'duplicate id')]);
  // Started while the batch's promise is still pending. A batch that awaited between its
  // statements would let this write join the open transaction and be rolled back with it.
  const bystander = insert.bind(2, 'bystander').run();

  await assert.rejects(failing, /UNIQUE/);
  await bystander;
  assert.deepEqual(await rowsOf(db.prepare('SELECT id, v FROM t')), [{ id: 2, v: 'bystander' }]);
});

test('batch() only accepts statements made by its own prepare()', async (t) => {
  const db = memoryDb(t);
  const other = memoryDb(t);
  await assert.rejects(db.batch([{ run() {} }]), /prepare/);
  await assert.rejects(db.batch([other.prepare('SELECT 1')]), /prepare/);
});

test('exec() runs one statement per line (D1 quirk)', async (t) => {
  const db = memoryDb(t);

  // A statement split over two lines fails, and nothing is created.
  await assert.rejects(db.exec('CREATE TABLE a (\n x INTEGER)'), /D1_EXEC_ERROR: Error in line 1: CREATE TABLE a \(/);
  assert.deepEqual(await rowsOf(db.prepare('SELECT name FROM sqlite_master')), []);

  // Blank lines are skipped and CRLF is fine; count is the number of statements run.
  const { count, duration } = await db.exec('CREATE TABLE a (x INTEGER)\r\n\r\nCREATE TABLE b (y INTEGER)\r\n');
  assert.equal(count, 2);
  assert.equal(typeof duration, 'number');
  assert.deepEqual(await rowsOf(db.prepare('SELECT name FROM sqlite_master ORDER BY name')), [{ name: 'a' }, { name: 'b' }]);
});

test('a statement may bind at most 100 values (D1 limit), batch or not', async (t) => {
  const db = memoryDb(t);
  const sum = (n) => `SELECT ${Array(n).fill('?').join(' + ')} AS total`;

  const hundred = db.prepare(sum(100)).bind(...Array(100).fill(1));
  assert.equal(await hundred.first('total'), 100);
  assert.equal((await db.batch([hundred, hundred])).length, 2, 'the limit is per statement, not per batch');

  assert.throws(() => db.prepare(sum(101)).bind(...Array(101).fill(1)), /too many SQL variables/);
});

test('SQL errors reject with a D1_ERROR; prepare() itself never throws', async (t) => {
  const db = memoryDb(t);
  const broken = db.prepare('SELEC 1');
  await assert.rejects(broken.all(), /D1_ERROR: .*syntax error/);
  await assert.rejects(broken.first(), /D1_ERROR/);
  await assert.rejects(db.prepare('SELECT * FROM missing_table').run(), /D1_ERROR: no such table: missing_table/);
});

test('createD1 makes missing folders and persists to the file; close() releases it (Windows cannot delete an open file)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cinar-d1-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const file = join(dir, 'nested', 'db.sqlite');

  const db = createD1(file);
  await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  await db.prepare('INSERT INTO t (v) VALUES (?)').bind('kalıcı').run();
  db.close();
  db.close(); // closing twice is harmless
  await assert.rejects(db.prepare('SELECT 1').all(), /D1_ERROR/);

  const reopened = createD1(file);
  assert.equal(await reopened.prepare('SELECT v FROM t').first('v'), 'kalıcı');
  reopened.close();

  // A leaked handle never goes away, so it still fails here (EBUSY); the few short retries
  // only cover a virus scanner that briefly holds the freshly written file.
  await rm(join(dir, 'nested'), { recursive: true, maxRetries: 3, retryDelay: 100 });
});

test('the returned object can be wrapped: its methods are own functions that work detached from it', async (t) => {
  const db = memoryDb(t);
  for (const name of ['prepare', 'batch', 'exec', 'close']) {
    assert.ok(Object.hasOwn(db, name) && typeof db[name] === 'function', name);
  }

  // What a test that wraps env.DB does: copy the object and override prepare().
  const { prepare, batch, exec } = db;
  const wrapped = {
    ...db,
    prepare(sql) {
      if (sql.startsWith('INSERT')) throw new Error('blocked by the wrapper');
      return prepare(sql);
    },
  };
  await exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  assert.throws(() => wrapped.prepare('INSERT INTO t DEFAULT VALUES'), /blocked by the wrapper/);

  const [read] = await wrapped.batch([wrapped.prepare('SELECT 1 AS one')]);
  assert.deepEqual(read.results, [{ one: 1 }]);
  const [write] = await batch([prepare('INSERT INTO t DEFAULT VALUES')]);
  assert.equal(write.meta.changes, 1);
});
