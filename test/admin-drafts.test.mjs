// The panel's drafts (public/admin/js/drafts.js): what the owner typed and has not saved yet is kept
// in the browser, so that a session that ends while he types does not lose it (Review Focus 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrafts } from '../public/admin/js/drafts.js';

// A Storage stand-in over a Map, with the three methods drafts.js uses.
function memoryStorage() {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

// A storage whose every call throws, as Safari's does when the quota is used up or storage is blocked.
function brokenStorage() {
  const fail = () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

test('a saved draft comes back from a new createDrafts over the same storage (Review Focus 5)', () => {
  const storage = memoryStorage();
  createDrafts(storage).save('hero', { hero_title: 'x' });

  assert.deepEqual(createDrafts(storage).load('hero'), { hero_title: 'x' });
});

test('a draft is kept under the key cinar-admin-draft:<group>', () => {
  const storage = memoryStorage();
  createDrafts(storage).save('reviews', [{ name: 'Defne G.', rating: 5 }]);

  assert.deepEqual([...storage.items.keys()], ['cinar-admin-draft:reviews']);
  assert.deepEqual(JSON.parse(storage.items.get('cinar-admin-draft:reviews')), [{ name: 'Defne G.', rating: 5 }]);
});

test('clear removes the draft of that group only', () => {
  const storage = memoryStorage();
  const drafts = createDrafts(storage);
  drafts.save('hero', { hero_title: 'x' });
  drafts.save('about', { about_title: 'y' });

  drafts.clear('hero');

  assert.equal(drafts.load('hero'), null);
  assert.deepEqual(drafts.load('about'), { about_title: 'y' });
});

test('load gives null when there is no draft, or when what is stored is not JSON', () => {
  const storage = memoryStorage();
  storage.setItem('cinar-admin-draft:visit', '{"hours":');

  const drafts = createDrafts(storage);
  assert.equal(drafts.load('hero'), null);
  assert.equal(drafts.load('visit'), null);
});

test('a storage that throws makes no call throw: save, load and clear just do nothing', () => {
  const drafts = createDrafts(brokenStorage());

  assert.doesNotThrow(() => drafts.save('hero', { hero_title: 'x' }));
  assert.equal(drafts.load('hero'), null);
  assert.doesNotThrow(() => drafts.clear('hero'));
});

test('createDrafts() works where even reading localStorage throws', (t) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (saved === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', saved);
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    },
  });

  const drafts = createDrafts();
  assert.doesNotThrow(() => drafts.save('hero', { hero_title: 'x' }));
  assert.equal(drafts.load('hero'), null);
  assert.doesNotThrow(() => drafts.clear('hero'));
});
