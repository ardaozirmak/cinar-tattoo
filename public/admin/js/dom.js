// Small DOM helpers the panel's modules share: building elements, form fields with their character
// counters, the toast, and the confirmation sheet.
//
// The panel's CSP allows no inline style and no markup from strings, so text always goes in as text
// (textContent, value) and nothing here sets a style attribute: looks change through classes and the
// hidden attribute only.

/**
 * A new element. In `attrs`, `text` is its text, an `on<event>` value is a listener, `value` and
 * `checked` are set as properties (after the children, so a <select> finds its option), true is an
 * empty attribute, and false, null or undefined leave the attribute out. Every other entry is set as
 * an attribute.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  const properties = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (name === 'text') node.textContent = value;
    else if (name === 'value' || name === 'checked') properties[name] = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  node.append(...[children].flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  Object.assign(node, properties);
  return node;
}

let lastId = 0;

/** An id no other element of the page has. */
export function uid(prefix = 'f') {
  lastId += 1;
  return `${prefix}-${lastId}`;
}

/**
 * A labelled text field with its `n/max` counter, which counts like the server (`.length`):
 * { element, input, label }. `rows` makes it a <textarea>. `hideLabel` keeps the label for screen readers
 * only, for a field whose form title already says what it is. `singleLine` keeps a <textarea> to one
 * paragraph: Enter adds no line break (the server would turn it into a space anyway). On an <input> it
 * stops Enter (a phone's Go key) from submitting the form, so only the Kaydet button saves.
 */
export function textField({ label, value = '', max, rows, name, type = 'text', placeholder, hint, hideLabel = false, singleLine = false, inputAttrs = {} }) {
  const id = uid();
  const counterId = `${id}-count`;
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const counter = el('span', { class: 'counter', id: counterId });
  const attrs = {
    id,
    name,
    class: 'input',
    maxlength: max,
    placeholder,
    autocomplete: 'off',
    'aria-describedby': [counterId, hintId].filter(Boolean).join(' '),
    ...inputAttrs,
  };
  const input = rows === undefined ? el('input', { ...attrs, type, value }) : el('textarea', { ...attrs, rows, value });
  const update = () => {
    counter.textContent = `${input.value.length}/${max}`;
    counter.classList.toggle('is-full', input.value.length >= max);
  };
  input.addEventListener('input', update);
  if (singleLine) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault();
    });
  }
  update();
  const labelElement = el('label', { for: id, class: hideLabel ? 'label visually-hidden' : 'label', text: label });
  const element = el('div', { class: 'field' }, [
    el('div', { class: 'field-head' }, [labelElement, counter]),
    input,
    hint === undefined ? null : el('p', { class: 'hint', id: hintId, text: hint }),
  ]);
  return { element, input, label: labelElement };
}

/** A button that is not a submit button. */
export function button(text, onclick, className = 'button') {
  return el('button', { type: 'button', class: className, text, onclick });
}

let toastTimer = 0;

/** Shows `message` in #toast for a moment; an error stays longer. The text goes when the toast does. */
export function toast(message, { error = false } = {}) {
  const box = document.getElementById('toast');
  clearTimeout(toastTimer);
  box.textContent = message;
  box.classList.toggle('is-error', error);
  box.classList.add('is-visible');
  toastTimer = setTimeout(() => {
    box.classList.remove('is-visible');
    box.textContent = '';
  }, error ? 6000 : 2600);
}

/** Hides the toast at once, as when the login view replaces the panel. */
export function hideToast() {
  clearTimeout(toastTimer);
  const box = document.getElementById('toast');
  box.classList.remove('is-visible');
  box.textContent = '';
}

/**
 * Asks with the confirmation sheet and resolves to true when the owner chose `confirm`. The safe
 * answer (`cancel`) has the focus first, and Escape gives it too.
 */
export function confirmDialog({ message, confirm, cancel = 'Vazgeç', danger = false }) {
  const dialog = document.getElementById('confirm-dialog');
  dialog.querySelector('[data-confirm-message]').textContent = message;
  const ok = dialog.querySelector('[data-confirm-ok]');
  ok.textContent = confirm;
  ok.classList.toggle('button-danger-fill', danger);
  ok.classList.toggle('button-primary', !danger);
  dialog.querySelector('[data-confirm-cancel]').textContent = cancel;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
  });
}

/** Closes every open dialog, as when the session ends under them. A waiting confirmation gets "no". */
export function closeDialogs() {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}

/**
 * The message the owner reads for `error`: the panel's own errors (ApiError, and the plain Error of
 * resize.js) carry Turkish text; anything else, a bug say, gets the general sentence.
 */
export function messageOf(error) {
  const ours = error?.name === 'ApiError' || error?.constructor === Error;
  return ours && typeof error.message === 'string' && error.message !== '' ? error.message : 'Beklenmeyen bir hata oldu. Tekrar dene.';
}
