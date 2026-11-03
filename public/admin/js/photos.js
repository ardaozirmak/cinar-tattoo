// The Fotoğraflar tab (spec §6.2, §6.3): what the site sent the owner in the last 30 days, adding
// photos, the grid in the order the site shows them, and the sheet that edits one photo.
//
// Photos are prepared and uploaded one at a time (upload.js), in the order they were chosen, so a
// phone never holds more than one decoded photo. A session that ends during the uploads pauses
// them: what is left goes on after the next login.
//
// Saving a new photo and saving the order take turns. The server takes an order only when it names
// every photo there is, and it puts a new photo first. So a reorder waits while a new photo is being
// saved, then is worked out from the grid with that photo in it; the next upload waits for the order.
//
// Nothing here touches the DOM until setupPhotos runs, so the module also loads in Node (the tests).
import { api } from './api.js';
import { confirmDialog, el, messageOf, textField, toast } from './dom.js';
import { PREPARING, uploadImage } from './upload.js';

const UPLOADED = 'Yüklendi';
const GUARD = 'Kaydedilmemiş değişiklikler var. Yine de çıkılsın mı?';
const LEAVE = 'Evet, çık';

const NUMBER = new Intl.NumberFormat('tr-TR');

/**
 * `ids` with `id` moved `where`: 'first', 'earlier' (one place) or 'later' (one place). Null when `id`
 * is not there or cannot go further that way. `ids` itself stays as it is.
 */
export function moveId(ids, id, where) {
  const from = ids.indexOf(id);
  const to = where === 'first' ? 0 : where === 'earlier' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length || to === from) return null;
  const moved = ids.filter((other) => other !== id);
  moved.splice(to, 0, id);
  return moved;
}

/**
 * `photos` once the server has saved the order `ids`. A photo that is not in `ids` came while the
 * order was on its way, and the server puts a new photo first, so it stays in front. An id whose photo
 * is gone is skipped.
 */
export function applyOrder(photos, ids) {
  const named = new Set(ids);
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  return [...photos.filter((photo) => !named.has(photo.id)), ...ids.map((id) => byId.get(id)).filter(Boolean)];
}

/** A function that runs the tasks it is given one after the other: each starts once the one before has settled. */
export function oneAtATime() {
  let last = Promise.resolve();
  return (task) => {
    const result = last.then(() => task());
    last = result.catch(() => {}); // a failure is for the task's own caller; the next task runs anyway
    return result;
  };
}

/** The photos tab. Returns { render(state), loadStats() }. */
export function setupPhotos() {
  const input = document.getElementById('photo-input');
  const grid = document.getElementById('photo-grid');
  const empty = document.getElementById('photo-empty');
  const uploads = document.getElementById('upload-list');
  const sheet = document.getElementById('photo-dialog');

  let photos = [];
  let categories = [];
  let limits = {};

  // Saving a new photo and saving the order take turns (see the top of this file).
  const inTurn = oneAtATime();

  // ---------------------------------------------------------------------------------------------
  // Uploads
  // ---------------------------------------------------------------------------------------------

  const queue = [];
  let working = false;
  let paused = false;

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = ''; // the same photo can be chosen again
    if (files.length === 0) return;
    for (const item of uploads.querySelectorAll('.upload-item.is-done')) item.remove();
    for (const file of files) enqueue(newUpload(file));
  });

  function newUpload(file) {
    const thumb = el('span', { class: 'upload-thumb' }); // the picture comes once the photo is prepared
    const status = el('p', { class: 'upload-status' });
    const progress = el('progress', { max: '100' });
    const item = el('li', { class: 'upload-item' }, [thumb, el('p', { class: 'upload-name', text: file.name }), status, progress]);
    uploads.append(item);
    return { file, item, thumb, status, progress, retry: null };
  }

  function enqueue(job) {
    job.item.classList.remove('is-done', 'is-error');
    job.retry?.remove();
    job.retry = null;
    job.status.textContent = PREPARING;
    job.progress.hidden = false;
    job.progress.removeAttribute('value'); // no percent yet
    queue.push(job);
    work();
  }

  async function work() {
    if (working) return;
    working = true;
    while (queue.length > 0 && !paused) await upload(queue.shift());
    working = false;
  }

  async function upload(job) {
    try {
      await inTurn(async () => {
        const { photo } = await uploadImage('photos', job.file, {
          status: job.status,
          bar: job.progress,
          onPrepared: (prepared) => showThumb(job, prepared.thumb),
        });
        addPhoto(photo);
      });
      job.item.classList.add('is-done');
      job.status.textContent = UPLOADED;
      job.progress.hidden = true;
    } catch (error) {
      if (error.status === 401) {
        // The login view is up. This photo and the ones after it wait for the next login.
        paused = true;
        queue.unshift(job);
        job.status.textContent = PREPARING;
        job.progress.removeAttribute('value');
        return;
      }
      job.item.classList.add('is-error');
      job.status.textContent = messageOf(error);
      job.progress.hidden = true;
      job.retry = el('button', { type: 'button', class: 'button button-small', text: 'Tekrar dene', onclick: () => enqueue(job) });
      job.item.append(job.retry);
    }
  }

  // The small version just made, as the picture of the upload. Its object URL is let go once shown.
  function showThumb(job, blob) {
    const url = URL.createObjectURL(blob);
    const release = () => URL.revokeObjectURL(url);
    const image = el('img', { class: 'upload-thumb', alt: '', onload: release, onerror: release });
    image.src = url;
    job.thumb.replaceWith(image);
    job.thumb = image;
  }

  // ---------------------------------------------------------------------------------------------
  // The grid
  // ---------------------------------------------------------------------------------------------

  const labelOf = (category) => categories.find((option) => option.value === category)?.label ?? category;

  // Up to 400 tiles: the thumbs load lazily, as they come near the screen. A photo added or moved
  // changes the place of the one whose sheet is open, so the sheet's n/N and move buttons follow.
  function renderGrid() {
    grid.replaceChildren(
      ...photos.map((photo, index) =>
        el('button', { type: 'button', class: 'photo-tile', 'data-id': photo.id, onclick: () => openSheet(photo.id) }, [
          el('img', { loading: 'lazy', decoding: 'async', alt: photo.caption || `Fotoğraf ${index + 1}`, onerror: tileImageFailed, src: photo.thumb }),
          el('span', { class: 'tile-tag', text: labelOf(photo.category) }),
        ]),
      ),
    );
    empty.hidden = photos.length > 0;
    if (sheet.open) showPosition();
  }

  // A picture that does not load (a dropped connection, say) leaves its caption on the tile, so that
  // the owner still knows which photo it is and can open it.
  function tileImageFailed(event) {
    const image = event.currentTarget;
    image.closest('.photo-tile')?.append(el('span', { class: 'tile-missing', 'aria-hidden': 'true', text: image.alt }));
    image.classList.add('is-broken');
  }

  // A new photo goes first, as on the site. It is there already when the list was loaded again (after
  // a login) while the photo was on its way.
  function addPhoto(photo) {
    photos = [photo, ...photos.filter((item) => item.id !== photo.id)];
    renderGrid();
  }

  function putPhoto(photo) {
    photos = photos.map((item) => (item.id === photo.id ? photo : item));
    renderGrid();
  }

  // ---------------------------------------------------------------------------------------------
  // The sheet of one photo
  // ---------------------------------------------------------------------------------------------

  const form = sheet.querySelector('[data-photo-form]');
  const preview = sheet.querySelector('[data-photo-preview]');
  const captionHost = sheet.querySelector('[data-photo-caption]');
  const segments = sheet.querySelector('[data-photo-segments]');
  const sheetError = sheet.querySelector('[data-photo-error]');
  const position = sheet.querySelector('[data-photo-position]');
  const moves = [...sheet.querySelectorAll('[data-photo-move]')];
  const replaceInput = document.getElementById('replace-input');
  const progressLine = sheet.querySelector('[data-photo-progress]');
  const progressStatus = sheet.querySelector('[data-photo-status]');
  const progressBar = progressLine.querySelector('progress');
  let caption = null;
  let currentId = null;
  let busy = false;

  const current = () => photos.find((photo) => photo.id === currentId) ?? null;
  const chosenCategory = () => segments.querySelector('input:checked')?.value;
  const changed = () => {
    const photo = current();
    return photo !== null && (caption.input.value !== photo.caption || chosenCategory() !== photo.category);
  };

  function buildSheetFields() {
    caption = textField({ label: 'Açıklama', name: 'caption', max: limits.captionMax });
    captionHost.replaceChildren(caption.element);
    segments.replaceChildren(
      ...categories.map((option) =>
        el('label', { class: 'segment' }, [
          el('input', { type: 'radio', name: 'category', value: option.value }),
          el('span', { class: 'segment-face', text: option.label }),
        ]),
      ),
    );
  }

  function openSheet(id) {
    currentId = id;
    const photo = current();
    if (photo === null) return;
    preview.src = photo.thumb;
    preview.alt = photo.caption;
    caption.input.value = photo.caption;
    caption.input.dispatchEvent(new Event('input')); // the counter
    for (const radio of segments.querySelectorAll('input')) radio.checked = radio.value === photo.category;
    sheetError.textContent = '';
    progressLine.hidden = true;
    showPosition();
    sheet.showModal();
  }

  function showPosition() {
    const index = photos.findIndex((photo) => photo.id === currentId);
    if (index < 0) return; // the photo has just been deleted, and its sheet is closing
    position.textContent = `${index + 1}/${photos.length}`;
    for (const button of moves) {
      const where = button.dataset.photoMove;
      button.disabled = where === 'later' ? index === photos.length - 1 : index === 0;
    }
  }

  // Runs one change of the open photo. Clicks in the meantime are ignored. An error is shown in the
  // sheet, or as a toast when the owner has closed it.
  async function run(task) {
    if (busy) return;
    busy = true;
    replaceInput.disabled = true;
    sheetError.textContent = '';
    try {
      await task();
    } catch (error) {
      if (sheet.open) sheetError.textContent = messageOf(error);
      else toast(messageOf(error), { error: true });
    } finally {
      busy = false;
      replaceInput.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = currentId;
    run(async () => {
      const { photo } = await api(`photos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        json: { caption: caption.input.value, category: chosenCategory() },
      });
      putPhoto(photo);
      sheet.close();
      toast('Kaydedildi');
    });
  });

  // A move is worked out when its turn comes, from the grid as it is then: a new photo that was being
  // saved when the button was pressed is in it by then, so the order names every photo there is.
  for (const button of moves) {
    button.addEventListener('click', () => {
      const id = currentId;
      const where = button.dataset.photoMove;
      run(() =>
        inTurn(async () => {
          const ids = moveId(photos.map((photo) => photo.id), id, where);
          if (ids === null) return;
          await api('photos/order', { method: 'PUT', json: { ids } });
          photos = applyOrder(photos, ids);
          renderGrid();
          // At the end of the line the pressed button is disabled: keep the focus on one that is not.
          if (sheet.open && currentId === id && button.disabled) moves.find((other) => !other.disabled)?.focus();
          toast('Sıralama kaydedildi');
        }),
      );
    });
  }

  replaceInput.addEventListener('change', () => {
    const file = replaceInput.files[0];
    replaceInput.value = '';
    if (file === undefined) return;
    const id = currentId;
    run(async () => {
      const { photo } = await uploadImage(`photos/${encodeURIComponent(id)}/replace`, file, {
        status: progressStatus,
        bar: progressBar,
        line: progressLine,
      });
      putPhoto(photo);
      if (currentId === id) preview.src = photo.thumb;
      toast('Fotoğraf değiştirildi');
    });
  });

  sheet.querySelector('[data-photo-delete]').addEventListener('click', async () => {
    if (busy) return;
    const id = currentId;
    const sure = await confirmDialog({ message: 'Bu fotoğraf silinsin mi? Bu işlem geri alınamaz.', confirm: 'Evet, sil', danger: true });
    if (!sure) return;
    run(async () => {
      await api(`photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      photos = photos.filter((photo) => photo.id !== id);
      renderGrid();
      sheet.close();
      toast('Silindi');
    });
  });

  // Closing asks first when the caption or the type was changed and not saved.
  async function requestClose() {
    if (changed() && !(await confirmDialog({ message: GUARD, confirm: LEAVE }))) return;
    sheet.close();
  }

  sheet.querySelector('[data-photo-close]').addEventListener('click', requestClose);
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestClose();
  });
  // A tap on the dimmed page around the sheet (the backdrop's clicks reach the dialog itself; the
  // sheet's own scrollbar is inside its box).
  sheet.addEventListener('click', (event) => {
    if (event.target !== sheet) return;
    const box = sheet.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) requestClose();
  });
  // The grid may have been drawn again meanwhile: the focus goes back to this photo's tile, or to
  // the add button when the photo is gone.
  sheet.addEventListener('close', () => {
    const tile = [...grid.children].find((element) => element.dataset.id === currentId);
    (tile ?? input).focus({ preventScroll: tile === undefined });
  });

  // ---------------------------------------------------------------------------------------------
  // The summary of the clicks
  // ---------------------------------------------------------------------------------------------

  const stats = document.getElementById('stats-card');
  const statsMain = stats.querySelector('[data-stats-main]');
  const statsSub = stats.querySelector('[data-stats-sub]');

  async function loadStats() {
    try {
      const { totals } = await api('stats');
      showStats(totals);
      stats.hidden = false;
    } catch {
      stats.hidden = true; // a summary that cannot be loaded is left out
    }
  }

  function showStats(totals) {
    const count = (kind) => Math.max(0, Number(totals?.[kind]) || 0);
    const all = ['whatsapp', 'call', 'directions', 'form', 'instagram'].reduce((sum, kind) => sum + count(kind), 0);
    stats.classList.toggle('is-empty', all === 0);
    statsSub.hidden = all === 0;
    if (all === 0) {
      statsMain.textContent = 'Henüz sayım yok. Site yayına girince burada göreceksin.';
      statsSub.textContent = '';
      return;
    }
    const number = (kind) => el('strong', { class: 'stat-num', text: NUMBER.format(count(kind)) });
    statsMain.replaceChildren(
      'Son 30 günde site seni ',
      number('whatsapp'),
      " kez WhatsApp'a, ",
      number('call'),
      ' kez aramaya, ',
      number('directions'),
      ' kez yol tarifine yönlendirdi.',
    );
    statsSub.textContent = `Randevu formu: ${NUMBER.format(count('form'))} · Instagram: ${NUMBER.format(count('instagram'))}`;
  }

  // ---------------------------------------------------------------------------------------------

  return {
    render(state) {
      photos = state.photos;
      categories = state.categories;
      limits = state.limits;
      buildSheetFields();
      renderGrid();
      paused = false;
      work(); // uploads a lost session paused
    },
    loadStats,
  };
}
