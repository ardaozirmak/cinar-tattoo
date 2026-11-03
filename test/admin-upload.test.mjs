// The panel's one way of uploading a photo (public/admin/js/upload.js), used for new photos,
// "Fotoğrafı değiştir" and the shop sign: the photo is prepared, then sent, and a status line with a
// progress bar says where it is, in the exact words of the brief.
//
// The real resizeImage and api run here. Node has no canvas, createImageBitmap or XMLHttpRequest, so
// small stand-ins go on globalThis for each test; the status, the bar and the line are stand-ins that
// write down every change made to them, in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/admin/js/api.js';
import { PREPARING, uploadImage, uploadingText } from '../public/admin/js/upload.js';

const UNREADABLE = 'Bu fotoğraf açılamadı. Başka bir fotoğraf dene ya da ekran görüntüsünü alıp onu yükle.';
const UPLOAD_DROPPED = 'Fotoğraf yüklenemedi: internet bağlantısı koptu. Tekrar dene.';

// A browser for one test: a 4000 x 3000 photo (or one that cannot be opened), canvases that "encode"
// to text, and an XMLHttpRequest whose send() plays `reply(xhr)` a moment later. Gives the requests sent.
function fakeBrowser(t, { reply, unreadable = false }) {
  const names = ['document', 'createImageBitmap', 'Image', 'XMLHttpRequest'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  });

  const sent = [];
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob(callback, type, quality) {
        const text = `${this.width}x${this.height}@${quality}`;
        setTimeout(() => callback(new Blob([text], { type })), 0);
      },
    }),
  };
  globalThis.createImageBitmap = async () => {
    if (unreadable) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    return { width: 4000, height: 3000, close() {} };
  };
  // The second decoder, tried only when createImageBitmap fails: it cannot open the photo either.
  globalThis.Image = class {
    naturalWidth = 0;
    naturalHeight = 0;
    decode() {
      return Promise.reject(new DOMException('The source image cannot be decoded.', 'EncodingError'));
    }
    removeAttribute() {}
  };
  globalThis.XMLHttpRequest = class {
    upload = {};
    status = 0;
    responseText = '';
    open(method, url) {
      Object.assign(this, { method, url });
    }
    setRequestHeader() {}
    send(body) {
      this.body = body;
      sent.push(this);
      setTimeout(() => reply(this), 0);
    }
  };
  return sent;
}

// The status, the bar and the line of an upload; every change made to them goes into `log`.
function progressLine(log) {
  return {
    status: {
      set textContent(text) {
        log.push(`status: ${text}`);
      },
    },
    bar: {
      set value(percent) {
        log.push(`bar: ${percent}`);
      },
      removeAttribute(name) {
        log.push(`bar: no ${name}`);
      },
    },
    line: {
      set hidden(hidden) {
        log.push(hidden ? 'line: hidden' : 'line: shown');
      },
    },
  };
}

// An upload that goes well: 25% sent, then all of it, then the server's 201 answer.
const answers = (body) => (xhr) => {
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
  xhr.status = 201;
  xhr.responseText = JSON.stringify(body);
  xhr.onload?.();
};

const photoFile = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

test('the upload states are the exact words of the brief', () => {
  assert.equal(PREPARING, 'Hazırlanıyor…');
  assert.equal(uploadingText(0), 'Yükleniyor %0');
  assert.equal(uploadingText(42), 'Yükleniyor %42');
});

test('uploadImage prepares the photo, sends it with its progress, and gives the answer', async (t) => {
  const sent = fakeBrowser(t, { reply: answers({ photo: { id: 'abc' } }) });
  const log = [];
  const { status, bar, line } = progressLine(log);

  const answer = await uploadImage('photos/abc/replace', photoFile(), {
    status,
    bar,
    line,
    onPrepared: (prepared) => log.push(`prepared: ${prepared.width}x${prepared.height}`),
  });

  assert.deepEqual(answer, { photo: { id: 'abc' } });
  assert.deepEqual(log, [
    'status: Hazırlanıyor…',
    'bar: no value',
    'line: shown',
    'prepared: 1600x1200',
    'status: Yükleniyor %0',
    'bar: 0',
    'status: Yükleniyor %25',
    'bar: 25',
    'status: Yükleniyor %100',
    'bar: 100',
    'line: hidden',
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].url, '/api/admin/photos/abc/replace');
  const form = sent[0].body;
  assert.deepEqual([...form.keys()], ['full', 'thumb', 'width', 'height']);
  assert.equal(await form.get('full').text(), '1600x1200@0.82');
  assert.equal(await form.get('thumb').text(), '640x480@0.78');
  assert.deepEqual([form.get('width'), form.get('height')], ['1600', '1200']);
});

test('uploadImage hides the line when the photo cannot be opened, and sends nothing', async (t) => {
  const sent = fakeBrowser(t, { reply: answers({}), unreadable: true });
  const log = [];
  let prepared = false;

  await assert.rejects(
    uploadImage('hero-image', photoFile(), { ...progressLine(log), onPrepared: () => (prepared = true) }),
    { message: UNREADABLE },
  );

  assert.deepEqual(log, ['status: Hazırlanıyor…', 'bar: no value', 'line: shown', 'line: hidden']);
  assert.equal(sent.length, 0);
  assert.equal(prepared, false);
});

test('uploadImage hides the line when the upload fails, and gives the ApiError', async (t) => {
  fakeBrowser(t, { reply: (xhr) => xhr.onerror?.() });
  const log = [];

  await assert.rejects(uploadImage('hero-image', photoFile(), progressLine(log)), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.message, UPLOAD_DROPPED);
    return true;
  });
  assert.equal(log.at(-1), 'line: hidden');
});

test('uploadImage without a line leaves showing and hiding to the caller (the upload list)', async (t) => {
  fakeBrowser(t, { reply: answers({ photo: { id: 'new' } }) });
  const log = [];
  const { status, bar } = progressLine(log);

  await uploadImage('photos', photoFile(), { status, bar });

  assert.equal(log.some((entry) => entry.startsWith('line:')), false);
  assert.equal(log.at(-2), 'status: Yükleniyor %100', 'the last status stays until the caller writes its own');
});
