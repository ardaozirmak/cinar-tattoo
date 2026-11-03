import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, jsonForScript, paragraphs, smartApostrophes } from '../functions/_lib/html.js';

test('escapeHtml escapes quotes for attribute contexts', () => {
  assert.equal(escapeHtml(`" onerror='x'`), '&quot; onerror=&#39;x&#39;');
});

test('escapeHtml escapes & < > " and the apostrophe, each exactly once', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>R&D</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;R&amp;D&lt;/a&gt;');
  // Not idempotent on purpose: text that happens to hold an entity is shown as the owner typed it.
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
});

test('escapeHtml gives an empty string for null and undefined and stringifies other values', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
  assert.equal(escapeHtml(12.5), '12.5');
});

test('escapeHtml leaves Turkish letters, curly quotes and emoji alone', () => {
  const text = 'İstanbul’da şğıöüç 🙏 10.00–23.00';
  assert.equal(escapeHtml(text), text);
});

test('smartApostrophes', () => {
  assert.equal(smartApostrophes("Esenler'de 2005'ten"), 'Esenler’de 2005’ten');
});

test('smartApostrophes works with Turkish letters and leaves every other apostrophe alone', () => {
  assert.equal(smartApostrophes("Onur Aydoğan'ın stüdyosu, İstanbul'da, 5'e"), 'Onur Aydoğan’ın stüdyosu, İstanbul’da, 5’e');
  assert.equal(smartApostrophes("rock'n'roll O'Brien"), 'rock’n’roll O’Brien');
  // A quote mark, a measurement and text without an apostrophe stay as they are.
  assert.equal(smartApostrophes("'merhaba' 5'10\" ''"), "'merhaba' 5'10\" ''");
  assert.equal(smartApostrophes("dedi ki 'merhaba' ve 'selam'"), "dedi ki 'merhaba' ve 'selam'"); // a quote after a space opens a quotation
  assert.equal(smartApostrophes('zaten’ ’de'), 'zaten’ ’de');
});

test('smartApostrophes copes with null and undefined', () => {
  assert.equal(smartApostrophes(null), '');
  assert.equal(smartApostrophes(undefined), '');
});

test('smartApostrophes goes before escapeHtml: the typographic one needs no escaping', () => {
  assert.equal(escapeHtml(smartApostrophes("Esenler'de <b>")), 'Esenler’de &lt;b&gt;');
  assert.equal(smartApostrophes(escapeHtml("Esenler'de")), 'Esenler&#39;de'); // the wrong way round does nothing
});

test('paragraphs splits blank lines and escapes', () => {
  assert.equal(paragraphs('a\nb\n\n<c>'), '<p>a<br>b</p><p>&lt;c&gt;</p>');
});

test('paragraphs makes a single line one paragraph and escapes every one', () => {
  assert.equal(paragraphs('tek satır'), '<p>tek satır</p>');
  assert.equal(paragraphs('<b>x</b>\n\n"y" & \'z\''), '<p>&lt;b&gt;x&lt;/b&gt;</p><p>&quot;y&quot; &amp; &#39;z&#39;</p>');
});

test('paragraphs treats CRLF, whitespace-only lines and longer gaps as blank lines', () => {
  assert.equal(paragraphs('a\r\nb\r\n\r\nc'), '<p>a<br>b</p><p>c</p>');
  assert.equal(paragraphs('a\n  \t\nb'), '<p>a</p><p>b</p>');
  assert.equal(paragraphs('a\n\n\n\nb'), '<p>a</p><p>b</p>');
});

test('paragraphs makes no empty paragraphs and gives nothing for blank input', () => {
  assert.equal(paragraphs('\n\n  a  \n\n'), '<p>a</p>');
  for (const blank of ['', '   ', '\n\n', null, undefined]) assert.equal(paragraphs(blank), '');
});

test('paragraphs copes with a very long run of white space in no time', () => {
  const started = performance.now();
  const spaces = ' '.repeat(60000);
  assert.equal(paragraphs(`a\n${spaces}\nb\n${spaces}c`).replaceAll(' ', ''), '<p>a</p><p>b<br>c</p>');
  assert.equal(paragraphs(`\n${spaces}x\n${spaces}`), '<p>x</p>');
  assert.ok(performance.now() - started < 250, 'paragraphs took too long');
});

test('jsonForScript cannot close a script tag', () => {
  const output = jsonForScript({ x: '</script><script>alert(1)</script>' });
  assert.ok(!output.includes('</script'));
  assert.ok(!output.includes('<'));
  assert.deepEqual(JSON.parse(output), { x: '</script><script>alert(1)</script>' });
});

test('jsonForScript escapes "<" everywhere, so <!-- cannot start a comment either', () => {
  const value = { '<!--': ['<!--', { '</': 1 }] };
  const output = jsonForScript(value);
  assert.ok(!output.includes('<'));
  assert.deepEqual(JSON.parse(output), value);
});

test('jsonForScript escapes U+2028 and U+2029 and still reads back as the same text', () => {
  const value = { x: 'a\u2028b\u2029c' };
  const output = jsonForScript(value);
  assert.ok(!output.includes('\u2028') && !output.includes('\u2029'));
  assert.equal(output, '{"x":"a\\u2028b\\u2029c"}');
  assert.deepEqual(JSON.parse(output), value);
});

test('jsonForScript is plain JSON otherwise', () => {
  const value = { '@type': 'TattooParlor', name: 'Çınar Tattoo', sameAs: ['https://www.instagram.com/cinartattooesenler'], n: 5, ok: true, none: null };
  assert.equal(jsonForScript(value), JSON.stringify(value));
  assert.equal(jsonForScript(undefined), 'null');
});
