// Helpers for the HTML the server writes. Every dynamic string that reaches markup goes through
// escapeHtml, or through paragraphs, which escapes for you.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes & < > " and ' so the text is safe as element content and inside a quoted attribute
 * value. null and undefined give ''.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

// An apostrophe has a letter or digit before it and a letter after it (Esenler'de, 2005'ten).
const APOSTROPHE = /(?<=[\p{L}\p{N}])'(?=\p{L})/gu;
const TYPOGRAPHIC_APOSTROPHE = '’'; // U+2019

/**
 * Turns the apostrophe of a Turkish suffix (Esenler'de, 2005'ten) into the typographic one. Quote
 * marks and measurements (5'10") stay as they are. Call it before escapeHtml, which would have
 * turned every ' into &#39; already.
 */
export function smartApostrophes(text) {
  return String(text ?? '').replace(APOSTROPHE, TYPOGRAPHIC_APOSTROPHE);
}

/**
 * Escaped text as paragraphs: a blank line starts a new <p>, a single newline becomes <br>.
 * Whitespace-only lines count as blank, and blank input gives ''.
 */
export function paragraphs(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

/**
 * JSON for the inside of a <script type="application/ld+json"> block. Every "<" is written as
 * \u003c, so neither "</script" nor "<!--" can appear, and the line separators U+2028 and
 * U+2029 are written as escapes too. JSON.parse reads all of these back as the same characters.
 */
export function jsonForScript(value) {
  return (JSON.stringify(value) ?? 'null')
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
