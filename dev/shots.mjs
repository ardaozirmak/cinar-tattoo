// Screenshots of a page in headless Microsoft Edge, in real time, over the DevTools protocol.
//
//   node dev/shots.mjs <url> <out.png> <w> <h> [--wait ms] [--scroll <selector>]... [--reduced] [--eval <js>]...
//
// - Loads <url> in a <w> x <h> viewport (a phone-like one below 600 px), waits --wait ms (default
//   1500) and saves <out.png>. Each --scroll then scrolls that element to the top of the view, waits
//   2.2 s and saves <out>-<n>.png (n from 1).
// - --reduced asks for prefers-reduced-motion: reduce.
// - Each --eval runs a JavaScript expression in the page after the first shot, before the scrolls,
//   and prints its value (to check a measure, or to type into a form before the next shots).
// - Prints the page's console warnings and errors, uncaught exceptions and CSP violations, and the
//   page width check (document scrollWidth against innerWidth) after the first wait.
// - Exits 1 when no PNG was written.
//
// Why not `msedge --screenshot --virtual-time-budget`: virtual time does not advance anime.js, so
// such a capture shows the page in the middle of its opening.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USAGE = 'usage: node dev/shots.mjs <url> <out.png> <w> <h> [--wait ms] [--scroll <selector>]... [--reduced] [--eval <js>]...';

function parseArgs(argv) {
  const [url, out, w, h, ...rest] = argv;
  if (!url || !out || !(Number(w) > 0) || !(Number(h) > 0)) return null;
  const options = { url, out, width: Number(w), height: Number(h), wait: 1500, scrolls: [], reduced: false, evals: [] };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--wait') options.wait = Number(rest[++i]);
    else if (rest[i] === '--scroll') options.scrolls.push(rest[++i]);
    else if (rest[i] === '--reduced') options.reduced = true;
    else if (rest[i] === '--eval') options.evals.push(rest[++i]);
    else return null;
  }
  return Number.isFinite(options.wait) && options.scrolls.every(Boolean) && options.evals.every(Boolean) ? options : null;
}

const options = parseArgs(process.argv.slice(2));
if (options === null) {
  console.error(USAGE);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'cinar-shots-'));
const edge = spawn(
  EDGE,
  ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--window-size=${options.width},${options.height}`, 'about:blank'],
  { stdio: 'ignore' },
);

let written = 0;
let socket = null;
try {
  let targets = null;
  for (let attempt = 0; attempt < 75 && targets === null; attempt += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(200);
    }
  }
  const page = targets?.find((target) => target.type === 'page');
  if (!page) throw new Error('Edge did not open a page to drive');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const describe = (arg) => arg.value ?? arg.description ?? arg.type;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === 'Runtime.consoleAPICalled' && ['warning', 'error', 'assert'].includes(message.params.type)) {
      console.log(`console.${message.params.type}:`, message.params.args.map(describe).join(' '));
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      console.log('uncaught exception:', details.exception?.description ?? details.text, `(${details.url ?? ''}:${details.lineNumber})`);
    } else if (message.method === 'Log.entryAdded' && ['warning', 'error'].includes(message.params.entry.level)) {
      const { entry } = message.params;
      console.log(`log.${entry.level} [${entry.source}]:`, entry.text, entry.url ?? '');
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      nextId += 1;
      pending.set(nextId, resolve);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // A CSP violation is also reported as an error here, with the directive that refused it.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "addEventListener('securitypolicyviolation', (e) => console.error('CSP violation:', e.violatedDirective, e.blockedURI || '(inline)', e.sourceFile + ':' + e.lineNumber));",
  });
  await send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: 1, mobile: options.width < 600 });
  if (options.reduced) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: options.url });
  await sleep(options.wait);

  const shot = async (path) => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    if (!result.result?.data) throw new Error(`no screenshot for ${path}`);
    writeFileSync(path, Buffer.from(result.result.data, 'base64'));
    written += 1;
    console.log('shot', path);
  };
  const widths = await evaluate('JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, innerWidth })');
  const { scrollWidth, innerWidth } = JSON.parse(widths ?? '{}');
  console.log(`width: scrollWidth ${scrollWidth}, innerWidth ${innerWidth}${scrollWidth > innerWidth ? '  OVERFLOW' : ''}`);
  await shot(options.out);

  for (const expression of options.evals) console.log('eval', expression, '=>', JSON.stringify(await evaluate(expression)));

  const base = options.out.replace(/\.png$/i, '');
  for (const [index, selector] of options.scrolls.entries()) {
    const found = await evaluate(
      `(() => { document.documentElement.style.scrollBehavior = 'auto'; const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: 'start' }); return true; })()`,
    );
    if (!found) console.log(`no element for ${selector}`);
    await sleep(2200);
    await shot(`${base}-${index + 1}.png`);
  }
} catch (error) {
  console.error('shots:', error.message);
} finally {
  socket?.close();
  edge.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Edge may still hold the profile for a moment; it is a temp folder */
  }
}
process.exit(written > 0 ? 0 : 1);
