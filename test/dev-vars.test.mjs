import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVars, loadVars } from '../dev/vars.mjs';

const BOM = String.fromCharCode(0xfeff);

test('parseVars handles comments, blank lines, quotes and "=" inside values', () => {
  const text = [
    '# secrets for local development',
    '# OLD_SECRET=a commented-out assignment is not a variable',
    '',
    'ADMIN_PASSWORD=degistir-beni-123',
    '   # INDENTED=an indented comment is still a comment',
    'APP_SECRET="a=b=c"',
    "SINGLE='tek tırnak'",
    'URL=https://example.test/?a=b&c=d',
    'PADDED =  spaced value  ',
    'EMPTY=',
    'INNER_SPACES=" x  y "',
    'HASH=pass#word',
    'NOT_AN_ASSIGNMENT',
    '=no key',
  ].join('\n');

  assert.deepEqual(parseVars(text), {
    ADMIN_PASSWORD: 'degistir-beni-123',
    APP_SECRET: 'a=b=c',
    SINGLE: 'tek tırnak',
    URL: 'https://example.test/?a=b&c=d',
    PADDED: 'spaced value',
    EMPTY: '',
    INNER_SPACES: ' x  y ',
    HASH: 'pass#word',
  });
});

test('parseVars leaves mismatched or lone quotes alone and lets a later duplicate win', () => {
  assert.deepEqual(parseVars('A="open\nB=\'x"\nC="\nD=1\nD=2'), { A: '"open', B: '\'x"', C: '"', D: '2' });
});

test('parseVars copes with CRLF line endings and a UTF-8 BOM (Windows editors)', () => {
  assert.deepEqual(parseVars(BOM + 'ADMIN_PASSWORD=abc\r\n# note\r\nAPP_SECRET="def"\r\n'), {
    ADMIN_PASSWORD: 'abc',
    APP_SECRET: 'def',
  });
});

test('loadVars returns {} for a missing file and reads an existing one', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cinar-vars-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  assert.deepEqual(loadVars(join(dir, 'does-not-exist')), {});

  await writeFile(join(dir, '.dev.vars'), 'ADMIN_PASSWORD=abc\nAPP_SECRET=def\n');
  assert.deepEqual(loadVars(join(dir, '.dev.vars')), { ADMIN_PASSWORD: 'abc', APP_SECRET: 'def' });
});

test('loadVars does not hide other read errors (a directory is not a missing file)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cinar-vars-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  assert.throws(() => loadVars(dir), { code: 'EISDIR' });
});

test('the committed .dev.vars.example parses into the two variables the site needs', () => {
  const vars = loadVars(fileURLToPath(new URL('../.dev.vars.example', import.meta.url)));
  assert.deepEqual(Object.keys(vars), ['ADMIN_PASSWORD', 'APP_SECRET']);
  assert.equal(vars.ADMIN_PASSWORD, 'degistir-beni-123');
  assert.match(vars.APP_SECRET, /^x{40}$/);
});
