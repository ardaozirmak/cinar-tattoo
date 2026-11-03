// Prepares a photo in the browser before it is uploaded (spec §6.3): the photo is opened with its
// EXIF orientation applied, brought down to at most 1600 px on its longest side as a JPEG at quality
// 0.82, and again to 640 px at 0.78 for the gallery. Re-encoding drops every EXIF field, the location
// included.
//
// Phones take 12–48 MP photos, so memory matters: the decoded photo is released as soon as the large
// version is drawn, the small one is drawn from the large one, and every canvas is emptied once the
// JPEGs are made, or when anything fails. The panel calls this for one photo at a time.
//
// Nothing here touches the DOM until resizeImage runs, so the module also loads in Node (the tests).

const FULL_SIDE = 1600;
const FULL_QUALITY = 0.82;
const THUMB_SIDE = 640;
const THUMB_QUALITY = 0.78;

const UNREADABLE = 'Bu fotoğraf açılamadı. Başka bir fotoğraf dene ya da ekran görüntüsünü alıp onu yükle.';

/**
 * The size of a `width` x `height` image whose longest side is brought down to `max`, in whole
 * pixels. An image that already fits keeps its size; no side becomes 0.
 */
export function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The two JPEGs of `file` (a File or Blob from an <input type=file>): { full, thumb, width, height },
 * where width and height are the size of `full`. A photo the browser cannot open (some HEIC files,
 * say) rejects with an Error whose message tells the owner what to do.
 */
export async function resizeImage(file) {
  const source = await decode(file);
  const canvases = [];
  try {
    const full = draw(canvases, source.image, fitWithin(source.width, source.height, FULL_SIDE));
    source.release();
    const thumb = draw(canvases, full, fitWithin(full.width, full.height, THUMB_SIDE));
    return {
      full: await jpeg(full, FULL_QUALITY),
      thumb: await jpeg(thumb, THUMB_QUALITY),
      width: full.width,
      height: full.height,
    };
  } finally {
    source.release();
    for (const canvas of canvases) empty(canvas);
  }
}

// The opened photo: { image, width, height, release() }, where release() may be called more than
// once. createImageBitmap applies the EXIF orientation where it knows the option; a browser that does
// not (it throws on the value), or that cannot decode the file this way, gets a second try with an
// <img>, which applies the orientation by default.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      }
      bitmap.close();
    } catch {
      // Tried again with an <img> below.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  };
  try {
    image.src = url;
    await image.decode();
    if (image.naturalWidth === 0 || image.naturalHeight === 0) throw new Error('empty image');
  } catch {
    release();
    throw new Error(UNREADABLE);
  }
  return { image, width: image.naturalWidth, height: image.naturalHeight, release };
}

// A new canvas of `size`, added to `canvases`, with `source` drawn over all of it. A browser that has
// no memory left for it gives no context.
function draw(canvases, source, { width, height }) {
  const canvas = document.createElement('canvas');
  canvases.push(canvas);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error(UNREADABLE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function jpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob === null ? reject(new Error(UNREADABLE)) : resolve(blob)), 'image/jpeg', quality);
  });
}

// A canvas of 0 x 0 holds no pixels, so the browser can free its memory at once (iOS Safari caps the
// memory of all canvases together).
function empty(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}
