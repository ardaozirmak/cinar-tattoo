// Drafts: what the owner typed into a form and has not saved yet, kept in the browser (spec §6.2).
// iOS Safari gives no warning when a page closes, and a session can end while he types, so every
// edit is saved here and the panel puts it back the next time it opens (Review Focus 5).
//
// A draft is the form's value as JSON under `cinar-admin-draft:<group>`. Storage can fail (a full
// quota, a private window, blocked site data); a draft is a safety net, so every failure is
// swallowed: save does nothing, load finds nothing.

const PREFIX = 'cinar-admin-draft:';

/** The drafts over `storage` (a Storage: getItem, setItem, removeItem); without one, nothing is kept. */
export function createDrafts(storage = browserStorage()) {
  return {
    /** Keeps `data` (anything JSON can hold) as the draft of `group`. */
    save(group, data) {
      try {
        storage?.setItem(PREFIX + group, JSON.stringify(data));
      } catch {
        // Not kept: the form still holds the text.
      }
    },

    /** The draft of `group`, or null when there is none or it cannot be read. */
    load(group) {
      try {
        const text = storage?.getItem(PREFIX + group);
        return typeof text === 'string' ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    },

    /** Forgets the draft of `group`: its form was saved. */
    clear(group) {
      try {
        storage?.removeItem(PREFIX + group);
      } catch {
        // Nothing to do.
      }
    },
  };
}

// localStorage, or null where there is none. Even reading the property throws when the browser
// blocks storage for the site.
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
