// The panel's photo preparation (public/admin/js/resize.js): the size arithmetic, and the order in
// which resizeImage uses the browser's decoders and releases what it made.
//
// Node has no canvas, <img> or createImageBitmap, so the resizeImage tests put small stand-ins on
// globalThis. A stand-in canvas "encodes" to the text "<width>x<height>@<quality>", which is how a
// test sees what would have been written as a JPEG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, resizeImage } from '../public/admin/js/resize.js';

const UNREADABLE = 'Bu fotoğraf açılamadı. Başka bir fotoğraf dene ya da ekran görüntüsünü alıp onu yükle.';

test('fitWithin brings the longest side down to max and keeps the shape', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 640), { width: 480, height: 640 });
  assert.deepEqual(fitWithin(5000, 5000, 640), { width: 640, height: 640 });
});

test('fitWithin leaves an image that already fits as it is', () => {
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1600, 900, 1600), { width: 1600, height: 900 });
});

test('fitWithin rounds to whole pixels and never gives a side of 0', () => {
  assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(4000, 1, 640), { width: 640, height: 1 });
});

class FakeCanvas {
  width = 300;
  height = 150;
  source = null;

  getContext(kind) {
    assert.equal(kind, '2d');
    return {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      drawImage: (source, x, y, width, height) => {
        assert.deepEqual([x, y, width, height], [0, 0, this.width, this.height], 'the source fills the whole canvas');
        this.source = source;
      },
    };
  }

  toBlob(callback, type, quality) {
    const text = `${this.width}x${this.height}@${quality}`;
    setTimeout(() => callback(new Blob([text], { type })), 0);
  }
}

// Puts the stand-ins on globalThis for one test: `document` makes FakeCanvas elements, and
// createImageBitmap and Image are what the test passes (left out: not there, as in an old browser).
// Everything is put back after the test.
function fakeBrowser(t, { createImageBitmap, Image } = {}) {
  const canvases = [];
  const names = ['document', 'createImageBitmap', 'Image'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  });
  const fakes = {
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const canvas = new FakeCanvas();
        canvases.push(canvas);
        return canvas;
      },
    },
    createImageBitmap,
    Image,
  };
  for (const name of names) {
    if (fakes[name] === undefined) delete globalThis[name];
    else globalThis[name] = fakes[name];
  }
  return { canvases };
}

const photoFile = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

function fakeBitmap(width, height) {
  return { width, height, closed: false, close() { this.closed = true; } };
}

// An <img> whose decode() gives an image of `width` x `height`, or fails when `fails` is set.
function fakeImageClass({ width = 0, height = 0, fails = false } = {}) {
  return class FakeImage {
    static last = null;
    src = '';
    naturalWidth = 0;
    naturalHeight = 0;

    constructor() {
      FakeImage.last = this;
    }

    decode() {
      if (fails) return Promise.reject(new DOMException('The source image cannot be decoded.', 'EncodingError'));
      this.naturalWidth = width;
      this.naturalHeight = height;
      return Promise.resolve();
    }

    removeAttribute(name) {
      if (name === 'src') this.src = '';
    }
  };
}

test('resizeImage makes a 1600 px full JPEG at 0.82 and a 640 px thumb at 0.78', async (t) => {
  const bitmap = fakeBitmap(4000, 3000);
  const calls = [];
  fakeBrowser(t, {
    createImageBitmap: async (...args) => {
      calls.push(args);
      return bitmap;
    },
  });
  const file = photoFile();

  const result = await resizeImage(file);

  assert.equal(result.width, 1600);
  assert.equal(result.height, 1200);
  assert.equal(result.full.type, 'image/jpeg');
  assert.equal(await result.full.text(), '1600x1200@0.82');
  assert.equal(result.thumb.type, 'image/jpeg');
  assert.equal(await result.thumb.text(), '640x480@0.78');
  assert.deepEqual(calls, [[file, { imageOrientation: 'from-image' }]], 'the EXIF orientation is applied while decoding');
});

test('resizeImage closes the bitmap and empties its canvases when it is done', async (t) => {
  const bitmap = fakeBitmap(3000, 4000);
  const { canvases } = fakeBrowser(t, { createImageBitmap: async () => bitmap });

  await resizeImage(photoFile());

  assert.equal(bitmap.closed, true);
  assert.ok(canvases.length > 0);
  for (const canvas of canvases) assert.deepEqual([canvas.width, canvas.height], [0, 0], 'a canvas keeps no pixels');
});

test('resizeImage opens the photo with an <img> when createImageBitmap refuses it', async (t) => {
  const FakeImage = fakeImageClass({ width: 1200, height: 1600 });
  fakeBrowser(t, {
    createImageBitmap: async () => {
      throw new TypeError("Failed to execute 'createImageBitmap': The provided value 'from-image' is not a valid enum value.");
    },
    Image: FakeImage,
  });
  const revoked = t.mock.method(URL, 'revokeObjectURL');

  const result = await resizeImage(photoFile());

  assert.equal(result.width, 1200, 'a photo that fits keeps its size');
  assert.equal(result.height, 1600);
  assert.equal(await result.full.text(), '1200x1600@0.82');
  assert.equal(await result.thumb.text(), '480x640@0.78');
  assert.match(revoked.mock.calls[0]?.arguments[0] ?? '', /^blob:/, 'the object URL of the file is released');
  assert.equal(FakeImage.last.src, '', 'the <img> lets go of the file');
});

test('resizeImage uses an <img> in a browser without createImageBitmap', async (t) => {
  fakeBrowser(t, { Image: fakeImageClass({ width: 2000, height: 1000 }) });

  const result = await resizeImage(photoFile());

  assert.deepEqual([result.width, result.height], [1600, 800]);
  assert.equal(await result.thumb.text(), '640x320@0.78');
});

test('resizeImage says in Turkish what to do when the photo cannot be opened', async (t) => {
  fakeBrowser(t, {
    createImageBitmap: async () => {
      throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    },
    Image: fakeImageClass({ fails: true }),
  });
  const revoked = t.mock.method(URL, 'revokeObjectURL');

  await assert.rejects(resizeImage(photoFile()), { message: UNREADABLE });
  assert.equal(revoked.mock.callCount(), 1, 'the object URL is released after a failure too');
});

test('resizeImage treats an image without a size as one it cannot open', async (t) => {
  const bitmap = fakeBitmap(0, 0);
  fakeBrowser(t, { createImageBitmap: async () => bitmap, Image: fakeImageClass({ width: 0, height: 0 }) });

  await assert.rejects(resizeImage(photoFile()), { message: UNREADABLE });
  assert.equal(bitmap.closed, true);
});
