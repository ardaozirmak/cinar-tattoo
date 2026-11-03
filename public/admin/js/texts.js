// The forms the owner types into: the settings groups (the Yazılar tab, and the Google reviews link on
// the Yorumlar tab), the services, the price list and the reviews (spec §6.2).
//
// Every form works the same way:
// - It is built from a value: the server's, or a draft the owner left behind.
// - Every edit saves the form's value as its draft (drafts.js). A draft is cleared only after a save
//   succeeds, so a session that ends while he types loses nothing: the next time the forms are built,
//   a draft that differs from the server's value is put back, with a notice (Review Focus 5).
// - "Kaydet" sends the whole value. The answer is what is stored now, and the form shows that.
// - A form whose value differs from the server's is dirty: main.js asks before its tab is left.
//
// The values are sent with the types the server checks: settings as strings (the announcement flag
// as '1' or '0') with the two lists as arrays of strings, and a review's rating as a number.
import { api } from './api.js';
import { button, el, messageOf, textField, toast, uid } from './dom.js';

const SAVED = 'Kaydedildi';
const RESTORED = 'Kaydedilmemiş bir taslak geri getirildi.';
const FLAG_LABEL = 'Duyuruyu sitede göster';
const PRICES_NOTE = 'Fiyat girmediğin sürece sitede fiyat bölümü görünmez.';
const REVIEWS_NOTE = 'Yalnızca müşterilerin gerçekten yazdığı yorumları ekle.';
const SERVICES_TITLE = 'Hizmetler';

// The services form comes right after this settings group on the Yazılar tab.
const SERVICES_AFTER = 'about';

const INPUT_TYPES = { phone: 'tel', url: 'url', email: 'email' };
const NO_SPELLCHECK = { spellcheck: 'false', autocapitalize: 'off' };

// What happens on the site when a field is left empty (spec §5 and §6.2).
const HINTS = {
  whatsapp: 'Boş bırakırsan sitedeki WhatsApp düğmeleri görünmez.',
  maps_url: 'Boş bırakırsan yol tarifi adresten hazırlanır.',
  payment_text: 'Örn: Nakit ve kredi kartı. Boş bırakırsan ödeme kartı görünmez.',
  instagram_followers: 'Örn: 18 bin+. Boş bırakırsan sitede görünmez.',
  google_reviews_url: "Boş bırakırsan sitedeki \"Google'da gör\" düğmesi görünmez.",
  announcement_text: 'Sitenin en üstünde tek satır olarak görünür.',
};

// Two removals closer than this are one tap too many: the next row has moved under the finger.
const REMOVE_PAUSE_MS = 600;

/**
 * The text forms. `onDirtyChange(tab)` runs whenever a form of `tab` may have become dirty or clean.
 * Returns { render(state) → how many drafts were put back, isDirty(tab), anyDirty() }.
 */
export function setupTextForms({ drafts, onDirtyChange }) {
  let forms = [];

  function render(state) {
    forms = [];
    const fieldsByKey = new Map(state.fields.map((field) => [field.key, field]));
    const { limits } = state;

    const textsHost = document.getElementById('texts-host');
    textsHost.replaceChildren();
    const textGroups = state.groups.filter((group) => group.tab === 'texts');
    for (const group of textGroups) {
      forms.push(settingsForm(textsHost, group, fieldsByKey, state.settings));
      if (group.id === SERVICES_AFTER) forms.push(servicesForm(textsHost, state.services, limits));
    }
    if (!textGroups.some((group) => group.id === SERVICES_AFTER)) forms.push(servicesForm(textsHost, state.services, limits));
    document.getElementById('texts-nav').replaceChildren(
      ...forms.map((form) => el('a', { href: `#${form.element.id}`, text: form.title })),
    );

    const pricesHost = document.getElementById('prices-host');
    pricesHost.replaceChildren();
    forms.push(pricesForm(pricesHost, state.prices, limits));

    const reviewsHost = document.getElementById('reviews-host');
    reviewsHost.replaceChildren();
    for (const group of state.groups.filter((entry) => entry.tab === 'reviews')) {
      forms.push(settingsForm(reviewsHost, group, fieldsByKey, state.settings));
    }
    forms.push(reviewsForm(reviewsHost, state.reviews, limits, state.reviewSources));

    return forms.filter((form) => form.restore()).length;
  }

  // ---------------------------------------------------------------------------------------------
  // The form every editor shares
  // ---------------------------------------------------------------------------------------------

  /**
   * Mounts a form in `host`. `build(body, value, edited)` fills `body` with the fields of `value` and
   * gives a function that reads the value back from them; it calls `edited` when it changes the
   * fields itself (a row added, moved or removed). `normalize(draft)` gives a stored draft in the
   * value's shape, or null when it cannot be used. `save(value)` stores it and gives the value the
   * server now has.
   */
  function mountForm({ host, group, tab, title, label, notes = [], value, build, normalize, save }) {
    const titleId = title === undefined ? undefined : uid('baslik');
    const notice = el('p', { class: 'draft-notice', text: RESTORED, hidden: true });
    const body = el('div', { class: 'form-body' });
    const error = el('p', { class: 'form-error', role: 'alert' });
    const submit = el('button', { type: 'submit', class: 'button button-primary button-block', text: 'Kaydet' });
    const element = el(
      'form',
      { class: 'plate', id: `form-${group}`, 'data-group': group, novalidate: true, 'aria-labelledby': titleId, 'aria-label': label },
      [
        title === undefined ? null : el('h2', { id: titleId, class: 'plate-title', text: title }),
        notes.map((note) => el('p', { class: 'plate-note', text: note })),
        notice,
        body,
        error,
        submit,
      ],
    );
    host.append(element);

    let server = value;
    let read;
    const edited = () => {
      drafts.save(group, read());
      onDirtyChange(tab);
    };
    read = build(body, server, edited);
    element.addEventListener('input', edited);
    element.addEventListener('change', edited);

    element.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const sent = read();
      submit.disabled = true;
      error.textContent = '';
      try {
        server = await save(sent);
        const now = read();
        if (same(now, sent)) {
          if (!same(now, server)) read = build(body, server, edited);
          drafts.clear(group);
          notice.hidden = true;
        } else {
          drafts.save(group, now); // typed while the save was on its way: still a draft
        }
        toast(SAVED);
      } catch (failure) {
        error.textContent = messageOf(failure);
      } finally {
        submit.disabled = false;
        onDirtyChange(tab);
      }
    });

    return {
      tab,
      title,
      element,
      isDirty: () => !same(read(), server),
      restore() {
        const draft = normalize(drafts.load(group));
        if (draft === null || same(draft, server)) return false;
        read = build(body, draft, edited);
        notice.hidden = false;
        return true;
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Settings groups
  // ---------------------------------------------------------------------------------------------

  function settingsForm(host, group, fieldsByKey, settings) {
    const fields = group.keys.map((key) => fieldsByKey.get(key)).filter(Boolean);
    const valueOf = (source) => Object.fromEntries(fields.map(({ key }) => [key, source[key]]));
    return mountForm({
      host,
      group: group.id,
      tab: group.tab,
      title: group.title,
      value: valueOf(settings),
      build: settingsBuilder(fields, group.title),
      normalize: (draft) => settingsDraft(draft, fields, valueOf(settings)),
      save: async (value) => valueOf((await api('settings', { method: 'PUT', json: value })).settings),
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Services, prices and reviews
  // ---------------------------------------------------------------------------------------------

  function servicesForm(host, services, limits) {
    return mountForm({
      host,
      group: 'services',
      tab: 'texts',
      title: SERVICES_TITLE,
      value: serviceValues(services),
      build: (body, value, edited) => {
        const rows = repeater({
          items: value,
          max: limits.maxServices,
          min: 1,
          addLabel: 'Hizmet ekle',
          blank: () => ({ name: '', description: '' }),
          edited,
          createRow: fieldsetRow('Hizmet', (row, item) => {
            const name = textField({ label: 'Ad', value: item.name, max: limits.serviceNameMax, singleLine: true });
            const description = textField({ label: 'Açıklama', value: item.description, max: limits.serviceDescriptionMax, rows: 2 });
            row.append(name.element, description.element);
            return () => ({ name: name.input.value, description: description.input.value });
          }),
        });
        body.replaceChildren(rows.element);
        return rows.read;
      },
      normalize: (draft) => listDraft(draft, (item) => ({ name: text(item.name), description: text(item.description) })),
      save: async (value) => serviceValues((await api('services', { method: 'PUT', json: { services: value } })).services),
    });
  }

  function pricesForm(host, prices, limits) {
    const itemRow = fieldsetRow('Kalem', (row, item) => {
      const name = textField({ label: 'Ad', value: item.name, max: limits.priceItemNameMax, singleLine: true });
      const detail = textField({ label: 'Açıklama', value: item.detail, max: limits.priceItemDetailMax, singleLine: true });
      const price = textField({ label: 'Fiyat', value: item.price, max: limits.priceItemPriceMax, placeholder: "Örn: 1.500₺'den ya da Teklif al", singleLine: true });
      row.append(name.element, detail.element, price.element);
      return () => ({ name: name.input.value, detail: detail.input.value, price: price.input.value });
    });
    return mountForm({
      host,
      group: 'prices',
      tab: 'prices',
      label: 'Fiyat listesi',
      notes: [PRICES_NOTE],
      value: priceValues(prices),
      build: (body, value, edited) => {
        const groups = repeater({
          items: value,
          max: limits.maxPriceGroups,
          addLabel: 'Grup ekle',
          blank: () => ({ title: '', items: [] }),
          edited,
          createRow: fieldsetRow('Grup', (row, group) => {
            row.classList.add('price-group');
            const title = textField({ label: 'Grup adı', value: group.title, max: limits.priceGroupTitleMax, placeholder: 'Örn: Dövme', singleLine: true });
            const items = repeater({
              items: group.items,
              max: limits.maxPriceItems,
              addLabel: 'Kalem ekle',
              blank: () => ({ name: '', detail: '', price: '' }),
              edited,
              createRow: itemRow,
            });
            row.append(title.element, items.element);
            return () => ({ title: title.input.value, items: items.read() });
          }),
        });
        body.replaceChildren(groups.element);
        return groups.read;
      },
      normalize: (draft) =>
        listDraft(draft, (group) => ({
          title: text(group.title),
          items: (listDraft(group.items, (item) => ({ name: text(item.name), detail: text(item.detail), price: text(item.price) })) ?? []),
        })),
      save: async (value) => priceValues((await api('prices', { method: 'PUT', json: { groups: value } })).prices),
    });
  }

  function reviewsForm(host, reviews, limits, sources) {
    const sourceValues = sources.map((source) => source.value);
    return mountForm({
      host,
      group: 'reviews',
      tab: 'reviews',
      label: 'Yorumlar',
      notes: [REVIEWS_NOTE],
      value: reviewValues(reviews),
      build: (body, value, edited) => {
        const rows = repeater({
          items: value,
          max: limits.maxReviews,
          addLabel: 'Yorum ekle',
          blank: () => ({ name: '', rating: 5, text: '', source: sourceValues[0], date_text: '' }),
          edited,
          createRow: (item, isNew) => reviewRow(item, isNew, limits, sources),
        });
        body.replaceChildren(rows.element);
        return rows.read;
      },
      normalize: (draft) =>
        listDraft(draft, (review) => ({
          name: text(review.name),
          rating: [1, 2, 3, 4, 5].includes(review.rating) ? review.rating : 5,
          text: text(review.text),
          source: sourceValues.includes(review.source) ? review.source : sourceValues[0],
          date_text: text(review.date_text),
        })),
      save: async (value) => reviewValues((await api('reviews', { method: 'PUT', json: { reviews: value } })).reviews),
    });
  }

  return {
    render,
    isDirty: (tab) => forms.some((form) => form.tab === tab && form.isDirty()),
    anyDirty: () => forms.some((form) => form.isDirty()),
  };
}

// -----------------------------------------------------------------------------------------------
// The values, as the forms hold them and the server sends them back
// -----------------------------------------------------------------------------------------------

const text = (value) => (typeof value === 'string' ? value : '');
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const serviceValues = (services) => services.map((service) => ({ name: text(service.name), description: text(service.description) }));

const priceValues = (groups) =>
  groups.map((group) => ({
    title: text(group.title),
    items: group.items.map((item) => ({ name: text(item.name), detail: text(item.detail), price: text(item.price) })),
  }));

const reviewValues = (reviews) =>
  reviews.map((review) => ({
    name: text(review.name),
    rating: review.rating,
    text: text(review.text),
    source: review.source,
    date_text: text(review.date_text),
  }));

// A stored draft of a settings group, key by key: a value of the wrong type (a draft from another
// version of the panel, say) gives way to the server's.
function settingsDraft(draft, fields, server) {
  if (!isObject(draft)) return null;
  return Object.fromEntries(
    fields.map(({ key, kind }) => {
      const value = draft[key];
      const fits = kind === 'list' ? Array.isArray(value) && value.every((item) => typeof item === 'string') : typeof value === 'string';
      return [key, fits ? value : server[key]];
    }),
  );
}

// A stored draft of a list: its objects, each in the shape `item` gives; null when it is not a list.
function listDraft(draft, item) {
  return Array.isArray(draft) ? draft.filter(isObject).map(item) : null;
}

// -----------------------------------------------------------------------------------------------
// Fields
// -----------------------------------------------------------------------------------------------

// Builds the fields of a settings group. A field whose label only repeats the group's title keeps
// that label for screen readers alone.
function settingsBuilder(fields, title) {
  return (body, value, edited) => {
    body.replaceChildren();
    const readers = [];
    for (const field of fields) {
      const hideLabel = fields.length === 1 && field.label === title;
      if (field.kind === 'list') {
        const list = listField(field, value[field.key], edited, hideLabel);
        body.append(list.element);
        readers.push([field.key, list.read]);
      } else if (field.kind === 'flag') {
        const input = el('input', { type: 'checkbox', name: field.key, checked: value[field.key] === '1' });
        body.append(el('label', { class: 'check' }, [input, el('span', { text: FLAG_LABEL })]));
        readers.push([field.key, () => (input.checked ? '1' : '0')]);
      } else {
        const { element, input } = textField({
          label: field.label,
          name: field.key,
          value: value[field.key],
          max: field.max,
          rows: rowsOf(field),
          singleLine: field.kind !== 'multiline',
          type: INPUT_TYPES[field.kind],
          placeholder: field.kind === 'url' ? 'https://' : undefined,
          hint: HINTS[field.key],
          hideLabel,
          inputAttrs: field.kind in INPUT_TYPES ? NO_SPELLCHECK : {},
        });
        body.append(element);
        readers.push([field.key, () => input.value]);
      }
    }
    return () => Object.fromEntries(readers.map(([key, read]) => [key, read()]));
  };
}

// A multiline field, or a one-line text too long for the width of a phone, is easier to read and edit
// in a box of several lines (a one-line text still gets no line break: see textField).
function rowsOf({ kind, max }) {
  if (kind === 'multiline') return max > 300 ? 7 : 3;
  if (kind === 'text' && max >= 120) return 3;
  if (kind === 'text' && max > 60) return 2;
  return undefined;
}

// A list setting (highlights, hero points): one input per item, "Madde ekle" and "Kaldır".
function listField(field, values, edited, hideLabel) {
  const count = el('span', { class: 'counter' });
  const rows = el('div', { class: 'list-rows' });
  const items = new WeakMap(); // row -> { input, label }
  let lastRemoval = 0;
  const add = button('Madde ekle', () => {
    const row = itemRow('');
    rows.append(row);
    refresh();
    edited();
    row.querySelector('input').focus();
  }, 'button button-small');

  function itemRow(value) {
    const { element, input, label } = textField({ label: field.label, name: field.key, value, max: field.max, hideLabel: true, singleLine: true });
    const remove = button('Kaldır', () => {
      if (Date.now() - lastRemoval < REMOVE_PAUSE_MS) return;
      lastRemoval = Date.now();
      const next = row.nextElementSibling ?? row.previousElementSibling;
      row.remove();
      refresh();
      edited();
      (next?.querySelector('input') ?? add).focus();
    }, 'button button-small');
    const row = el('div', { class: 'list-row' }, [element, remove]);
    items.set(row, { input, label });
    return row;
  }

  function refresh() {
    const all = [...rows.children];
    all.forEach((row, index) => {
      items.get(row).label.textContent = `${field.label}, ${index + 1}. madde`;
    });
    count.textContent = `${all.length}/${field.maxItems} madde`;
    count.classList.toggle('is-full', all.length >= field.maxItems);
    add.disabled = all.length >= field.maxItems;
  }

  for (const value of values) rows.append(itemRow(value));
  refresh();
  const element = el('fieldset', { class: 'field list-field' }, [
    el('legend', { class: 'field-head legend-row' }, [el('span', { class: hideLabel ? 'label visually-hidden' : 'label', text: field.label }), count]),
    rows,
    add,
  ]);
  return { element, read: () => [...rows.children].map((row) => items.get(row).input.value) };
}

/**
 * Rows the owner adds, moves and removes. `createRow(item, isNew)` gives
 * { row, slot, read, setIndex }: the row element, where the row's buttons go, how to read its value,
 * and what to do when its place in the list changes. Returns { element, read }.
 */
function repeater({ items, max, min = 0, addLabel, blank, createRow, edited }) {
  const list = el('div', { class: 'rows' });
  const parts = new WeakMap();
  let lastRemoval = 0;
  const add = button(addLabel, () => {
    const row = makeRow(blank(), true);
    list.append(row);
    refresh();
    edited();
    row.querySelector('input, textarea, select')?.focus();
  }, 'button button-add');

  function makeRow(item, isNew = false) {
    const { row, slot, read, setIndex } = createRow(item, isNew);
    const up = button('Yukarı', () => move(row, -1), 'button button-small');
    const down = button('Aşağı', () => move(row, 1), 'button button-small');
    const remove = button('Kaldır', () => drop(row), 'button button-small');
    slot.append(el('div', { class: 'row-actions' }, [up, down, remove]));
    parts.set(row, { read, setIndex, up, down, remove });
    return row;
  }

  // The neighbour moves, not the row: the pressed button stays in the page and keeps the focus.
  function move(row, step) {
    const neighbour = step < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (neighbour === null) return;
    if (step < 0) row.after(neighbour);
    else row.before(neighbour);
    refresh();
    edited();
    const { up, down } = parts.get(row);
    if ((step < 0 ? up : down).disabled) (step < 0 ? down : up).focus();
  }

  function drop(row) {
    if (Date.now() - lastRemoval < REMOVE_PAUSE_MS) return;
    lastRemoval = Date.now();
    const next = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    refresh();
    edited();
    (next ?? add).focus();
  }

  function refresh() {
    const rows = [...list.children];
    rows.forEach((row, index) => {
      const { setIndex, up, down, remove } = parts.get(row);
      setIndex(index);
      up.disabled = index === 0;
      down.disabled = index === rows.length - 1;
      remove.disabled = rows.length <= min;
    });
    add.disabled = rows.length >= max;
  }

  for (const item of items) list.append(makeRow(item));
  refresh();
  return {
    element: el('div', { class: 'repeater' }, [list, add]),
    read: () => [...list.children].map((row) => parts.get(row).read()),
  };
}

// A row that is a <fieldset> whose legend numbers it ("Hizmet 2"). `fill(row, item)` adds the fields
// and gives the read function.
function fieldsetRow(noun, fill) {
  return (item) => {
    const legend = el('legend', { class: 'row-legend' });
    const row = el('fieldset', { class: 'row', tabindex: '-1' }, [legend]);
    const read = fill(row, item);
    return { row, slot: row, read, setIndex: (index) => { legend.textContent = `${noun} ${index + 1}`; } };
  };
}

// A review folds to its number, name and stars; a new one opens for typing.
function reviewRow(item, isNew, limits, sources) {
  const nameLine = el('span', { class: 'review-name' });
  const starsLine = el('span', { class: 'review-stars', 'aria-hidden': 'true' });
  const starsSpoken = el('span', { class: 'visually-hidden' });
  const slot = el('div', { class: 'review-body' });
  const row = el('details', { class: 'review', open: isNew, tabindex: '-1' }, [el('summary', { class: 'review-summary' }, [nameLine, starsLine, starsSpoken]), slot]);

  const name = textField({ label: 'Ad', value: item.name, max: limits.reviewNameMax, singleLine: true, inputAttrs: { autocapitalize: 'words' } });
  const rating = starPicker(item.rating);
  const words = textField({ label: 'Yorum', value: item.text, max: limits.reviewTextMax, rows: 5 });
  const source = selectField('Kaynak', sources, item.source);
  const date = textField({ label: 'Tarih (isteğe bağlı)', value: item.date_text, max: limits.reviewDateMax, placeholder: 'Örn: Ekim 2026', singleLine: true });
  slot.append(name.element, rating.element, words.element, source.element, date.element);

  let index = 0;
  const update = () => {
    const stars = rating.value();
    nameLine.textContent = `${index + 1}. ${name.input.value.trim() || 'Yeni yorum'}`;
    starsLine.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    starsSpoken.textContent = `, ${stars} yıldız`;
  };
  slot.addEventListener('input', update);
  slot.addEventListener('change', update);

  return {
    row,
    slot,
    setIndex: (position) => {
      index = position;
      update();
    },
    read: () => ({ name: name.input.value, rating: rating.value(), text: words.input.value, source: source.select.value, date_text: date.input.value }),
  };
}

const SVG = 'http://www.w3.org/2000/svg';

// Five radios drawn as stars, each a 44 px target. Arrow keys move between them as in any radio group.
function starPicker(value) {
  const name = uid('puan');
  const row = el('div', { class: 'star-row' });
  for (let stars = 1; stars <= 5; stars += 1) {
    const input = el('input', { type: 'radio', name, value: String(stars), checked: stars === value });
    row.append(el('label', { class: 'star' }, [input, starIcon(), el('span', { class: 'visually-hidden', text: `${stars} yıldız` })]));
  }
  const element = el('fieldset', { class: 'field stars', 'data-value': value }, [el('legend', { class: 'label', text: 'Puan' }), row]);
  const current = () => Number(element.querySelector('input:checked')?.value ?? value);
  element.addEventListener('change', () => element.setAttribute('data-value', String(current())));
  return { element, value: current };
}

function starIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'm12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z');
  svg.append(path);
  return svg;
}

function selectField(label, options, value) {
  const id = uid();
  const select = el('select', { id, class: 'input', value }, options.map((option) => el('option', { value: option.value, text: option.label })));
  return { element: el('div', { class: 'field' }, [el('label', { class: 'label', for: id, text: label }), select]), select };
}
