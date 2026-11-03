// The order logic of the panel's photo tab (public/admin/js/photos.js): where a move puts a photo,
// how the grid takes in an order the server has saved while new photos kept arriving, and the turns
// that keep new photos and reorders from crossing on the server.
//
// The server takes an order only when it names every photo there is, and it puts a new photo first.
// A reorder sent while a new photo was being saved was either refused ("Sıralama güncel değil.") or,
// when its answer came after the new photo, dropped that photo from the grid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOrder, moveId, oneAtATime } from '../public/admin/js/photos.js';

test('moveId takes a photo to the front, one place earlier or one place later', () => {
  const ids = ['a', 'b', 'c', 'd'];

  assert.deepEqual(moveId(ids, 'c', 'first'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(moveId(ids, 'c', 'earlier'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveId(ids, 'c', 'later'), ['a', 'b', 'd', 'c']);
  assert.deepEqual(moveId(ids, 'b', 'first'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'], 'the list it was given stays as it was');
});

test('moveId gives null for a move that cannot be made', () => {
  const ids = ['a', 'b', 'c'];

  assert.equal(moveId(ids, 'a', 'first'), null, 'already first');
  assert.equal(moveId(ids, 'a', 'earlier'), null, 'nothing before the first');
  assert.equal(moveId(ids, 'c', 'later'), null, 'nothing after the last');
  assert.equal(moveId(ids, 'x', 'first'), null, 'a photo that is not there');
  assert.equal(moveId([], 'a', 'later'), null);
});

test('applyOrder keeps a photo that was added while the order was on its way, in front', () => {
  const [a, b, c] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const uploaded = { id: 'new' };

  // The owner chose "Başa al" for c while a new photo was being saved; the photo landed first.
  const photos = applyOrder([uploaded, a, b, c], ['c', 'a', 'b']);

  assert.deepEqual(photos.map((photo) => photo.id), ['new', 'c', 'a', 'b']);
  assert.equal(photos[0], uploaded, 'the same photo objects, not copies');
  assert.equal(photos[1], c);
});

test('applyOrder keeps several new photos in front, newest first, as the server has them', () => {
  const photos = [{ id: 'n2' }, { id: 'n1' }, { id: 'a' }, { id: 'b' }];

  assert.deepEqual(applyOrder(photos, ['b', 'a']).map((photo) => photo.id), ['n2', 'n1', 'b', 'a']);
});

test('applyOrder puts the photos in the saved order and skips a photo that is gone', () => {
  const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.deepEqual(applyOrder(photos, ['c', 'a', 'b']).map((photo) => photo.id), ['c', 'a', 'b']);
  assert.deepEqual(applyOrder([{ id: 'a' }, { id: 'c' }], ['c', 'b', 'a']).map((photo) => photo.id), ['c', 'a']);
});

// A promise and the functions that settle it, for a task the test finishes when it wants.
function later() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('oneAtATime starts a task only once the one before it has settled', async () => {
  const inTurn = oneAtATime();
  const log = [];
  const upload = later();

  const first = inTurn(async () => {
    log.push('upload starts');
    const answer = await upload.promise;
    log.push('upload ends');
    return answer;
  });
  const second = inTurn(async () => {
    log.push('reorder starts');
    return 'order saved';
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(log, ['upload starts'], 'the reorder waits while the upload is on its way');

  upload.resolve('photo saved');
  assert.equal(await first, 'photo saved');
  assert.equal(await second, 'order saved');
  assert.deepEqual(log, ['upload starts', 'upload ends', 'reorder starts']);
});

test('oneAtATime gives a failure to its own caller and goes on with the next task', async () => {
  const inTurn = oneAtATime();
  const upload = later();
  const failed = inTurn(() => upload.promise);
  const next = inTurn(async () => 'next ran');

  upload.reject(new Error('Fotoğraf yüklenemedi: internet bağlantısı koptu. Tekrar dene.'));

  await assert.rejects(failed, { message: 'Fotoğraf yüklenemedi: internet bağlantısı koptu. Tekrar dene.' });
  assert.equal(await next, 'next ran');
});

test('oneAtATime goes on after a task that throws before it awaits anything', async () => {
  const inTurn = oneAtATime();

  const failed = inTurn(() => {
    throw new Error('at once');
  });
  const next = inTurn(() => 'next ran');

  await assert.rejects(failed, { message: 'at once' });
  assert.equal(await next, 'next ran');
});
