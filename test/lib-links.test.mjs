import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instagramHandle, mapsDirectionsHref, mapsEmbedSrc, telHref, waHref } from '../functions/_lib/links.js';

const ADDRESS = 'Nine Hatun Mah. İnönü Cd. No:11, Akman Ticaret Merkezi, 34220 Esenler / İstanbul';

test('links handles every common Turkish phone format', () => {
  for (const p of ['0537 263 15 46', '0 (537) 263 15 46', '+90 537 263 15 46', '5372631546', '905372631546'])
    assert.equal(telHref(p), 'tel:+905372631546');
  assert.equal(waHref('0537 263 15 46', ''), 'https://wa.me/905372631546');
  for (const bad of ['', 'abc', '12345']) { assert.equal(telHref(bad), null); assert.equal(waHref(bad), null); }
});

test('telHref reads the digits however they are separated', () => {
  for (const phone of [
    '+905372631546',
    '0537-263-15-46',
    '(0537) 263 15 46',
    '0537.263.15.46',
    '+90 (537) 263-15-46',
    '  0537 263 15 46  ',
    '0537\u00a0263\u00a015\u00a046', // non-breaking spaces, as pasted from a web page
    '537 263 15 46',
    '0537 263 15 46 (Onur)',
  ]) {
    assert.equal(telHref(phone), 'tel:+905372631546', phone);
  }
});

test('telHref accepts a landline with its 0 and a number abroad with its +', () => {
  assert.equal(telHref('0212 123 45 67'), 'tel:+902121234567');
  assert.equal(telHref('+49 30 1234567'), 'tel:+49301234567');
  assert.equal(telHref('+1 (415) 555-0132'), 'tel:+14155550132');
  assert.equal(telHref('  +49 30 1234567  '), 'tel:+49301234567'); // the + counts after leading spaces too
});

test('telHref gives no link for garbage, never a broken one', () => {
  for (const garbage of [
    '',
    '   ',
    'abc',
    '12345',
    '0537 263 15', // too short
    '0537 263 15 466', // 12 digits starting with 0
    '53726315466', // 11 digits not starting with 0
    '537263154', // 9 digits starting with 5
    '9053726315', // 10 digits starting with 9, not 5
    '1234567890', // 10 digits not starting with 5
    '90537263154', // 11 digits starting with 90
    '9053726315466', // 13 digits starting with 90
    '00905372631546', // 0090 prefix is not one of the supported formats
    '0537 263 15 46 ext 5',
    '+90 537 263 15 46 99 99 99 99', // far too long after the +
    '+12',
    '+1234567890123456', // 16 digits
    '+0537 263 15 46', // a country code never starts with 0
    '+',
    '+ abc',
  ]) {
    assert.equal(telHref(garbage), null, JSON.stringify(garbage));
    assert.equal(waHref(garbage), null, JSON.stringify(garbage));
  }
  for (const notText of [null, undefined, {}, []]) assert.equal(telHref(notText), null);
});

test('a number with a + needs 10 to 15 digits after it', () => {
  assert.equal(telHref('+1234567890'), 'tel:+1234567890'); // 10 digits
  assert.equal(telHref('+123456789012345'), 'tel:+123456789012345'); // 15 digits
  assert.equal(telHref('+123456789'), null); // 9
  assert.equal(telHref('+1234567890123456'), null); // 16
});

test('a plus sign that does not start the number is just a separator', () => {
  assert.equal(telHref('0537 +263 15 46'), 'tel:+905372631546');
});

test('waHref drops the + and carries the default greeting', () => {
  assert.equal(
    waHref('0537 263 15 46'),
    'https://wa.me/905372631546?text=Merhaba%2C%20web%20sitenizden%20yaz%C4%B1yorum.',
  );
  assert.equal(waHref('+90 537 263 15 46'), waHref('0537 263 15 46'));
  assert.equal(waHref('0537 263 15 46', undefined), waHref('0537 263 15 46'));
  assert.equal(waHref('0537 263 15 46', null), waHref('0537 263 15 46'));
});

test('waHref takes its own text, encoded, and no text at all for an empty one', () => {
  assert.equal(waHref('0537 263 15 46', 'Fiyat öğrenmek istiyorum & randevu'), 'https://wa.me/905372631546?text=Fiyat%20%C3%B6%C4%9Frenmek%20istiyorum%20%26%20randevu');
  assert.equal(waHref('0537 263 15 46', ''), 'https://wa.me/905372631546');
});

test('instagramHandle', () => assert.equal(instagramHandle('https://www.instagram.com/cinartattooesenler?x=1'), '@cinartattooesenler'));

test('instagramHandle copes with the usual ways of writing a profile address', () => {
  for (const url of [
    'https://www.instagram.com/cinartattooesenler',
    'https://www.instagram.com/cinartattooesenler/',
    'https://instagram.com/cinartattooesenler/?hl=tr#top',
    'https://m.instagram.com/cinartattooesenler',
    'HTTPS://WWW.INSTAGRAM.COM/cinartattooesenler',
    '  https://www.instagram.com/cinartattooesenler  ',
  ]) {
    assert.equal(instagramHandle(url), '@cinartattooesenler', url);
  }
  assert.equal(instagramHandle('https://www.instagram.com/some.one_9'), '@some.one_9');
});

test('instagramHandle gives null when there is no profile name to show', () => {
  for (const url of [
    '',
    'abc',
    'https://www.instagram.com/',
    'https://www.instagram.com',
    'https://example.com/cinartattooesenler',
    'https://evilinstagram.com/cinartattooesenler',
    'https://instagram.com.evil.test/cinartattooesenler',
    'https://www.instagram.com/a%20b',
    `https://www.instagram.com/${'a'.repeat(31)}`,
    'javascript:alert(1)',
    null,
    undefined,
  ]) {
    assert.equal(instagramHandle(url), null, String(url));
  }
});

test('mapsDirectionsHref uses the owner’s link when there is one', () => {
  assert.equal(mapsDirectionsHref('https://maps.app.goo.gl/abc123', ADDRESS), 'https://maps.app.goo.gl/abc123');
  assert.equal(mapsDirectionsHref('  https://maps.app.goo.gl/abc123 ', ADDRESS), 'https://maps.app.goo.gl/abc123');
});

test('mapsDirectionsHref builds a search link from the address when there is none', () => {
  const expected = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Çınar Tattoo, ${ADDRESS}`)}`;
  assert.equal(mapsDirectionsHref('', ADDRESS), expected);
  assert.equal(mapsDirectionsHref('   ', ADDRESS), expected);
  assert.equal(mapsDirectionsHref(undefined, ADDRESS), expected);
  assert.equal(mapsDirectionsHref(null, ADDRESS), expected);
  assert.equal(
    mapsDirectionsHref('', 'Esenler'),
    'https://www.google.com/maps/search/?api=1&query=%C3%87%C4%B1nar%20Tattoo%2C%20Esenler',
  );
});

test('mapsEmbedSrc builds the embed address from the address alone', () => {
  assert.equal(mapsEmbedSrc('Esenler'), 'https://www.google.com/maps?q=%C3%87%C4%B1nar%20Tattoo%2C%20Esenler&output=embed');
  assert.equal(mapsEmbedSrc(ADDRESS), `https://www.google.com/maps?q=${encodeURIComponent(`Çınar Tattoo, ${ADDRESS}`)}&output=embed`);
});

test('the maps links cope with a missing address', () => {
  assert.equal(mapsEmbedSrc(undefined), 'https://www.google.com/maps?q=%C3%87%C4%B1nar%20Tattoo%2C%20&output=embed');
  assert.ok(!mapsDirectionsHref('', null).includes('undefined') && !mapsDirectionsHref('', null).includes('null'));
});
