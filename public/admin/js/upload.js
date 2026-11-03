// Uploading one photo, the same way everywhere (spec §6.3): new photos, "Fotoğrafı değiştir" and the
// picture of the shop sign. The photo is prepared in the browser (resize.js) and sent as the form the
// API takes (api.js), while a status line with a progress bar says where it is.
//
// Nothing here touches the DOM until uploadImage runs, so the module also loads in Node (the tests).
import { api, imageForm } from './api.js';
import { resizeImage } from './resize.js';

/** The status while a photo is being prepared, or waits for its turn to be. */
export const PREPARING = 'Hazırlanıyor…';

/** The status while a photo is being sent; `percent` is a whole number, 0–100. */
export const uploadingText = (percent) => `Yükleniyor %${percent}`;

/**
 * Prepares `file`, POSTs it to /api/admin/<path> (photos, photos/:id/replace or hero-image) and gives
 * the API's answer. It throws what resizeImage and api throw, whose messages are for the owner.
 *
 * `status` (an element) and `bar` (a <progress>) show the steps: "Hazırlanıyor…" with a bar that has
 * no value yet, then "Yükleniyor %n" with the bar at n. `line`, when given, is the element that holds
 * them: it is shown for the upload and hidden after it, whether the upload worked or not.
 * `onPrepared(prepared)` runs once the photo is ready, before it is sent.
 */
export async function uploadImage(path, file, { status, bar, line, onPrepared }) {
  status.textContent = PREPARING;
  bar.removeAttribute('value'); // no percent yet: the bar only shows that something is going on
  if (line !== undefined) line.hidden = false;
  try {
    const prepared = await resizeImage(file);
    onPrepared?.(prepared);
    const progress = (percent) => {
      status.textContent = uploadingText(percent);
      bar.value = percent;
    };
    progress(0);
    return await api(path, { method: 'POST', form: imageForm(prepared), onProgress: progress });
  } finally {
    if (line !== undefined) line.hidden = true;
  }
}
