// Reads `.dev.vars`, the local stand-in for the Cloudflare secrets and variables.
//
// A small dotenv subset: one KEY=VALUE per line; blank lines and lines starting with `#` are
// skipped; the value is everything after the first `=` (so it may contain more of them), trimmed,
// with one pair of matching "double" or 'single' quotes removed. There are no inline comments:
// a `#` inside a value is part of the value. Lines without a key or without `=` are ignored.
import { readFileSync } from 'node:fs';

export function parseVars(text) {
  const vars = {};
  for (const rawLine of text.split('\n')) {
    // trim() also removes the "\r" of CRLF line endings and the BOM that some Windows editors
    // put at the start of a UTF-8 file (JavaScript counts U+FEFF as white space).
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    vars[line.slice(0, eq).trim()] = unquote(line.slice(eq + 1).trim());
  }
  return vars;
}

function unquote(value) {
  const quote = value[0];
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

// A missing file is normal (the server then falls back to .dev.vars.example); any other
// failure, such as a permissions problem, is not and is rethrown.
export function loadVars(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  return parseVars(text);
}
