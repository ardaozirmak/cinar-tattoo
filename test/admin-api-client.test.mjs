// The panel's API client (public/admin/js/api.js): what it sends, and how every kind of failure
// turns into an ApiError whose message tells the owner what happened and what to do.
//
// fetch is replaced per test. Node has no XMLHttpRequest, so the upload tests put a small stand-in
// on globalThis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, api, imageForm, onUnauthorized } from '../public/admin/js/api.js';

const DROPPED = 'Bağlantı koptu. İnternetini kontrol edip tekrar dene.';
const UPLOAD_DROPPED = 'Fotoğraf yüklenemedi: internet bağlantısı koptu. Tekrar dene.';
const UNEXPECTED = 'Beklenmeyen bir hata oldu. Tekrar dene.';

// Makes fetch answer `status` with `body` (JSON unless it is already text) and records the calls.
function answer(t, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return t.mock.method(globalThis, 'fetch', async () => new Response(text, { status }));
}

// Counts the calls of the onUnauthorized handler during one test.
function watchUnauthorized(t) {
  const seen = { calls: 0 };
  onUnauthorized(() => {
    seen.calls += 1;
  });
  t.after(() => onUnauthorized(null));
  return seen;
}

test('api sends JSON to /api/admin/<path> and gives back the parsed answer', async (t) => {
  const fetch = answer(t, 200, { settings: { hero_title: 'Yeni' } });

  const data = await api('settings', { method: 'PUT', json: { hero_title: 'Yeni', hero_points: ['a'] } });

  assert.deepEqual(data, { settings: { hero_title: 'Yeni' } });
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, '/api/admin/settings');
  assert.equal(init.method, 'PUT');
  assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
  assert.equal(init.body, '{"hero_title":"Yeni","hero_points":["a"]}');
});

test('api sends a GET without a body, and a form as it is', async (t) => {
  const fetch = answer(t, 200, { ok: true });
  const form = new FormData();
  form.append('width', '16');

  await api('state');
  await api('photos', { method: 'POST', form });

  const [get, post] = fetch.mock.calls.map((call) => call.arguments);
  assert.equal(get[1].method, 'GET');
  assert.equal(get[1].body, undefined);
  assert.equal(post[1].body, form);
  assert.equal(new Headers(post[1].headers).has('Content-Type'), false, 'the browser writes the multipart boundary itself');
});

test('an error answer becomes an ApiError with its status and the server message', async (t) => {
  answer(t, 400, { message: 'Giriş başlığı boş bırakılamaz.' });

  await assert.rejects(api('settings', { method: 'PUT', json: {} }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.message, 'Giriş başlığı boş bırakılamaz.');
    return true;
  });
});

test('a 401 calls the onUnauthorized handler and still rejects', async (t) => {
  const seen = watchUnauthorized(t);
  answer(t, 401, { message: 'Oturum kapandı. Tekrar giriş yap.' });

  await assert.rejects(api('state'), { status: 401, message: 'Oturum kapandı. Tekrar giriş yap.' });
  assert.equal(seen.calls, 1);
});

test('a 401 from the login request itself is a wrong password, not an ended session', async (t) => {
  const seen = watchUnauthorized(t);
  answer(t, 401, { message: 'Şifre yanlış.' });

  await assert.rejects(api('login', { method: 'POST', json: { password: 'yanlis' } }), { status: 401, message: 'Şifre yanlış.' });
  assert.equal(seen.calls, 0);
});

test('a setup problem keeps the server message word for word', async (t) => {
  answer(t, 503, { message: 'Kurulum eksik: IMAGES bağlaması yok, APP_SECRET tanımlı değil ya da 32 karakterden kısa.' });

  await assert.rejects(api('state'), {
    status: 503,
    message: 'Kurulum eksik: IMAGES bağlaması yok, APP_SECRET tanımlı değil ya da 32 karakterden kısa.',
  });
});

test('an answer that is not JSON gives a plain message, whatever its status', async (t) => {
  answer(t, 502, '<html><body>Bad gateway</body></html>');
  await assert.rejects(api('state'), { status: 502, message: UNEXPECTED });

  t.mock.restoreAll();
  answer(t, 200, '<html><body>Wi-Fi login</body></html>');
  await assert.rejects(api('settings', { method: 'PUT', json: {} }), { status: 200, message: UNEXPECTED }, 'a captive portal is not a save');

  t.mock.restoreAll();
  answer(t, 400, { error: 'no message field' });
  await assert.rejects(api('settings', { method: 'PUT', json: {} }), { status: 400, message: UNEXPECTED });
});

test('a dropped connection is an ApiError with status 0 that says what to do', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Failed to fetch');
  });

  await assert.rejects(api('state'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.message, DROPPED);
    return true;
  });
  await assert.rejects(api('photos', { method: 'POST', form: new FormData() }), { status: 0, message: UPLOAD_DROPPED });
});

// An XMLHttpRequest stand-in: send() runs `script(xhr)` a moment later, which plays the events.
function fakeXhr(t, script) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  t.after(() => {
    if (saved === undefined) delete globalThis.XMLHttpRequest;
    else Object.defineProperty(globalThis, 'XMLHttpRequest', saved);
  });
  const sent = [];
  globalThis.XMLHttpRequest = class FakeXMLHttpRequest {
    upload = {};
    status = 0;
    responseText = '';
    headers = {};

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headers[name] = value;
    }

    send(body) {
      this.body = body;
      sent.push(this);
      setTimeout(() => script(this), 0);
    }
  };
  return sent;
}

test('with onProgress the upload goes through XMLHttpRequest and reports whole percents', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  const sent = fakeXhr(t, (xhr) => {
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 70, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 200, total: 200 });
    xhr.status = 201;
    xhr.responseText = JSON.stringify({ photo: { id: 'abc' } });
    xhr.onload?.();
  });
  const form = new FormData();
  const percents = [];

  const data = await api('photos', { method: 'POST', form, onProgress: (percent) => percents.push(percent) });

  assert.deepEqual(data, { photo: { id: 'abc' } });
  assert.deepEqual(percents, [25, 100]);
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].url, '/api/admin/photos');
  assert.equal(sent[0].body, form);
  assert.equal(fetch.mock.callCount(), 0);
});

test('an upload through XMLHttpRequest fails the same ways as fetch', async (t) => {
  const seen = watchUnauthorized(t);
  const replies = [
    (xhr) => xhr.onerror?.(),
    (xhr) => {
      xhr.status = 413;
      xhr.responseText = JSON.stringify({ message: 'Fotoğraf çok büyük. Daha küçük bir fotoğraf seç.' });
      xhr.onload?.();
    },
    (xhr) => {
      xhr.status = 401;
      xhr.responseText = JSON.stringify({ message: 'Oturum kapandı. Tekrar giriş yap.' });
      xhr.onload?.();
    },
  ];
  fakeXhr(t, (xhr) => replies.shift()(xhr));
  const upload = () => api('hero-image', { method: 'POST', form: new FormData(), onProgress() {} });

  await assert.rejects(upload(), { status: 0, message: UPLOAD_DROPPED });
  await assert.rejects(upload(), { status: 413, message: 'Fotoğraf çok büyük. Daha küçük bir fotoğraf seç.' });
  await assert.rejects(upload(), { status: 401 });
  assert.equal(seen.calls, 1);
});

test('an upload that stalls times out after 2 minutes with the upload-dropped message', async (t) => {
  // A weak signal can stall an upload forever; the timeout frees the queue and shows "Tekrar dene".
  const sent = fakeXhr(t, (xhr) => xhr.ontimeout?.());

  await assert.rejects(api('photos', { method: 'POST', form: new FormData(), onProgress() {} }), { status: 0, message: UPLOAD_DROPPED });
  assert.equal(sent[0].timeout, 120000);
});

test('imageForm is the multipart form of a prepared photo: full, thumb, width and height', async () => {
  const full = new Blob(['full bytes'], { type: 'image/jpeg' });
  const thumb = new Blob(['thumb bytes'], { type: 'image/jpeg' });

  const form = imageForm({ full, thumb, width: 1600, height: 1200 });

  assert.deepEqual([...form.keys()], ['full', 'thumb', 'width', 'height']);
  assert.equal(await form.get('full').text(), 'full bytes');
  assert.equal(form.get('full').name, 'full.jpg');
  assert.equal(form.get('full').type, 'image/jpeg');
  assert.equal(await form.get('thumb').text(), 'thumb bytes');
  assert.equal(form.get('thumb').name, 'thumb.jpg');
  assert.equal(form.get('width'), '1600');
  assert.equal(form.get('height'), '1200');
});
