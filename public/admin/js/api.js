// The panel's calls to the admin API, /api/admin/<path> (spec §8).
//
// api() gives the parsed JSON answer, or throws an ApiError whose message the panel shows as it is:
// - an error answer carries the server's Turkish message (a setup problem's "Kurulum eksik: …"
//   included, word for word);
// - an answer that is not JSON, whatever its status, is unexpected (a proxy's error page, or a Wi-Fi
//   login page that answers 200 although the request never reached the site);
// - a request that never got an answer is status 0 and says to check the connection.
// A 401 means the session has ended, so the registered onUnauthorized handler runs first. The login
// request's own 401 is a wrong password, not an ended session: it only throws.
//
// Requests with an onProgress go through XMLHttpRequest, the only browser API that reports how much
// of an upload is sent; the others use fetch. Both send the session cookie and, for anything but a
// GET, the Origin header the server checks.

const BASE = '/api/admin/';
const LOGIN = 'login';

const DROPPED = 'Bağlantı koptu. İnternetini kontrol edip tekrar dene.';
const UPLOAD_DROPPED = 'Fotoğraf yüklenemedi: internet bağlantısı koptu. Tekrar dene.';
const UNEXPECTED = 'Beklenmeyen bir hata oldu. Tekrar dene.';

/** A failed call: `status` is the HTTP status (0 when no answer came) and `message` is for the owner. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let unauthorizedHandler = null;

/** Registers what runs when a call finds the session ended (any 401 but the login's); null removes it. */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

/**
 * Calls /api/admin/<path>. `json` is sent as a JSON body, `form` (a FormData) as multipart. With
 * `onProgress`, it is called with the percent of the body sent so far (a whole number, 0–100).
 */
export async function api(path, { method = 'GET', json, form, onProgress } = {}) {
  const url = BASE + path;
  const headers = json === undefined ? {} : { 'Content-Type': 'application/json' };
  const body = json === undefined ? form : JSON.stringify(json);
  const dropped = form === undefined ? DROPPED : UPLOAD_DROPPED;

  const { status, text } = onProgress === undefined
    ? await sendWithFetch(url, { method, headers, body }, dropped)
    : await sendWithXhr(url, { method, headers, body, onProgress }, dropped);

  const data = parse(text);
  if (status >= 200 && status < 300 && data !== undefined) return data;
  if (status === 401 && path !== LOGIN) unauthorizedHandler?.();
  const message = typeof data?.message === 'string' && data.message !== '' ? data.message : UNEXPECTED;
  throw new ApiError(status, message);
}

/**
 * The multipart form of a photo prepared by resizeImage, as POST photos, photos/:id/replace and
 * hero-image take it: the two JPEGs `full` and `thumb`, and the size of the full one.
 */
export function imageForm({ full, thumb, width, height }) {
  const form = new FormData();
  form.append('full', full, 'full.jpg');
  form.append('thumb', thumb, 'thumb.jpg');
  form.append('width', String(width));
  form.append('height', String(height));
  return form;
}

async function sendWithFetch(url, init, dropped) {
  try {
    const response = await fetch(url, { ...init, credentials: 'same-origin' });
    return { status: response.status, text: await response.text() };
  } catch {
    // No answer, or the connection broke while the answer came in.
    throw new ApiError(0, dropped);
  }
}

function sendWithXhr(url, { method, headers, body, onProgress }, dropped) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    // A stalled upload on a weak signal would hold the upload queue forever: give up after 2 minutes.
    xhr.timeout = 120000;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new ApiError(0, dropped));
    xhr.onabort = xhr.onerror;
    xhr.ontimeout = xhr.onerror;
    xhr.send(body ?? null);
  });
}

// The JSON in `text`, or undefined when it is not JSON (an empty body included).
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
