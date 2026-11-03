// A small driver for headless Microsoft Edge over the DevTools protocol (CDP), for the E2E test.
//
//   const browser = await openBrowser({ userDataDir });
//   const page = await browser.page('http://127.0.0.1:8788/admin/');
//   await page.waitFor('document.querySelector("#app")');
//   await browser.close();
//
// - Edge starts with --headless=new --remote-debugging-port=0 --user-data-dir=<userDataDir>. Port 0
//   lets Edge pick a free port, which it writes to <userDataDir>/DevToolsActivePort (the port on the
//   first line, the browser's WebSocket path on the second).
// - One WebSocket (Node's global WebSocket) talks to the browser. Each page is a target attached in
//   "flatten" mode, so its commands go over the same socket with the page's sessionId.
// - Edge is found at EDGE_PATH, else at its default Windows path.
// - Console errors, uncaught exceptions and failed requests of every page are collected in
//   page.problems (strings), so a test can show what went wrong in the page.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const DEFAULT_EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const START_TIMEOUT_MS = 20000;
const COMMAND_TIMEOUT_MS = 30000;
const BAND_PX = 2000; // the height of one band of a full-page screenshot

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts headless Edge with its profile in `userDataDir` (an empty folder the caller owns and
 * removes after close()).
 * @returns {Promise<{ page(url?: string): Promise<Page>, close(): Promise<void> }>}
 */
export async function openBrowser({ userDataDir, edgePath = process.env.EDGE_PATH || DEFAULT_EDGE } = {}) {
  if (!userDataDir) throw new Error('openBrowser needs a userDataDir.');
  if (!existsSync(edgePath)) throw new Error(`Edge was not found at ${edgePath}. Set EDGE_PATH to msedge.exe.`);

  const edge = spawn(
    edgePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let exited = false;
  const exit = new Promise((resolve) => edge.once('exit', () => {
    exited = true;
    resolve();
  }));

  let connection;
  try {
    const endpoint = await readEndpoint(userDataDir, () => exited);
    connection = await connect(endpoint);
  } catch (error) {
    edge.kill();
    await exit;
    throw error;
  }

  const pages = [];
  return {
    async page(url = 'about:blank') {
      const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
      const page = createPage(connection, sessionId);
      pages.push(page);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Network.enable');
      if (url !== 'about:blank') await page.goto(url);
      return page;
    },
    async close() {
      try {
        await connection.send('Browser.close', {}, undefined, 5000);
      } catch {
        /* Edge may already be gone */
      }
      connection.socket.close();
      const timer = setTimeout(() => edge.kill(), 5000);
      await exit;
      clearTimeout(timer);
      // Edge's helper processes can hold the profile for a moment after the main one exits.
      await sleep(300);
    },
  };
}

// The port and path Edge writes once its DevTools server listens.
async function readEndpoint(userDataDir, hasExited) {
  const file = `${userDataDir}/DevToolsActivePort`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (hasExited()) throw new Error('Edge exited before its DevTools port was open.');
    try {
      const [port, path] = readFileSync(file, 'utf8').split(/\r?\n/);
      if (/^\d+$/.test(port) && path) return `ws://127.0.0.1:${port}${path}`;
    } catch {
      /* not written yet */
    }
    await sleep(100);
  }
  throw new Error(`Edge did not write ${file} within ${START_TIMEOUT_MS / 1000} s.`);
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`Could not connect to ${endpoint}.`));
  });

  let nextId = 0;
  const pending = new Map(); // id -> { resolve, reject, method, timer }
  const listeners = new Map(); // sessionId -> (method, params) => void

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const call = pending.get(message.id);
      if (call === undefined) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
      else call.resolve(message.result);
    } else if (message.sessionId !== undefined) {
      listeners.get(message.sessionId)?.(message.method, message.params);
    }
  };
  socket.onclose = () => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(`${call.method}: the connection to Edge closed.`));
    }
    pending.clear();
  };

  return {
    socket,
    listen: (sessionId, listener) => listeners.set(sessionId, listener),
    send(method, params = {}, sessionId, timeoutMs = COMMAND_TIMEOUT_MS) {
      return new Promise((resolve, reject) => {
        nextId += 1;
        const id = nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}: no answer within ${timeoutMs / 1000} s.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, method, timer });
        const message = { id, method, params };
        if (sessionId !== undefined) message.sessionId = sessionId;
        socket.send(JSON.stringify(message));
      });
    },
  };
}

/**
 * @typedef {object} Page
 * @property {(method: string, params?: object) => Promise<object>} send  A CDP command for this page.
 * @property {(expression: string) => Promise<any>} evaluate  The value of `expression` (awaited when
 *   it is a promise); an exception in the page rejects.
 * @property {(expression: string, timeoutMs?: number) => Promise<any>} waitFor  Polls `expression`
 *   until it is truthy and gives that value; rejects after timeoutMs (15 s by default).
 * @property {(selector: string, absPaths: string[]) => Promise<void>} setFiles  Chooses files in a
 *   file input, which fires its input and change events.
 * @property {(width: number, height: number, mobile: boolean) => Promise<void>} setViewport
 * @property {(absPath: string, options?: { fullPage?: boolean }) => Promise<void>} screenshot  A PNG.
 * @property {(url: string) => Promise<void>} goto  Navigates and waits for the load event.
 * @property {string[]} problems  Console errors, uncaught exceptions and failed requests so far.
 */
function createPage(connection, sessionId) {
  const problems = [];
  const waiters = new Set(); // { method, resolve }
  connection.listen(sessionId, (method, params) => {
    if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
      problems.push(`console.${params.type}: ${params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')}`);
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails;
      problems.push(`uncaught: ${details.exception?.description ?? details.text}`);
    } else if (method === 'Network.loadingFailed' && !params.canceled) {
      problems.push(`request failed: ${params.errorText} (${params.type})`);
    }
    for (const waiter of waiters) {
      if (waiter.method === method) {
        waiters.delete(waiter);
        waiter.resolve(params);
      }
    }
  });
  const nextEvent = (method) => new Promise((resolve) => waiters.add({ method, resolve }));
  const send = (method, params = {}) => connection.send(method, params, sessionId);

  async function evaluate(expression) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) {
      throw new Error(`evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}\n  in: ${expression}`);
    }
    return result.value;
  }

  return {
    problems,
    send,
    evaluate,
    async waitFor(expression, timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      let lastError = null;
      for (;;) {
        try {
          const value = await evaluate(expression);
          if (value) return value;
          lastError = null;
        } catch (error) {
          lastError = error; // the page may be between documents
        }
        if (Date.now() > deadline) {
          throw new Error(`waited ${timeoutMs / 1000} s for: ${expression}${lastError ? `\n  last error: ${lastError.message}` : ''}`);
        }
        await sleep(100);
      }
    },
    async goto(url) {
      const loaded = nextEvent('Page.loadEventFired');
      const { errorText } = await send('Page.navigate', { url });
      if (errorText) throw new Error(`could not open ${url}: ${errorText}`);
      await loaded;
    },
    async setFiles(selector, absPaths) {
      const { root } = await send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`no element for ${selector}`);
      await send('DOM.setFileInputFiles', { nodeId, files: absPaths });
    },
    async setViewport(width, height, mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    },
    async screenshot(absPath, { fullPage = false } = {}) {
      // A tab in the background does not run its transitions: bring it to the front first.
      await send('Page.bringToFront');
      if (!fullPage) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(absPath, Buffer.from(data, 'base64'));
        return;
      }
      // The whole page, in bands drawn beyond the viewport without scrolling (so fixed elements show
      // once, where they are at the top), stitched together. One capture of the whole page goes
      // wrong in two ways: past Chromium's largest texture (16384 px) the top of the page is drawn
      // again, and on a tall page some layers (the sideways strip) come out at the wrong size.
      const { cssContentSize } = await send('Page.getLayoutMetrics');
      const width = Math.ceil(cssContentSize.width);
      const height = Math.ceil(cssContentSize.height);
      const bands = [];
      for (let y = 0; y < height; y += BAND_PX) {
        const clip = { x: 0, y, width, height: Math.min(BAND_PX, height - y), scale: 1 };
        const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
        bands.push(decodePng(Buffer.from(data, 'base64')));
      }
      writeFileSync(absPath, encodePng(stackImages(bands)));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Just enough PNG to stitch screenshots: 8-bit RGB or RGBA, not interlaced, as Chromium writes them.
// ---------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{ width: number, height: number, pixels: Buffer }} pixels as RGBA rows */
function decodePng(file) {
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const data = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = body.subarray(8);
      channels = { 2: 3, 6: 4 }[colour];
      if (depth !== 8 || channels === undefined || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
    } else if (type === 'IDAT') {
      data.push(body);
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? rows[out + x - channels] : 0;
      const b = y > 0 ? rows[out - stride + x] : 0;
      const c = x >= channels && y > 0 ? rows[out - stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[out + x] = value & 0xff;
    }
  }
  if (channels === 4) return { width, height, pixels: rows };
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    pixels[j] = rows[i];
    pixels[j + 1] = rows[i + 1];
    pixels[j + 2] = rows[i + 2];
    pixels[j + 3] = 255;
  }
  return { width, height, pixels };
}

function stackImages(images) {
  const width = images[0].width;
  if (images.some((image) => image.width !== width)) throw new Error('the bands of a screenshot differ in width');
  return { width, height: images.reduce((sum, image) => sum + image.height, 0), pixels: Buffer.concat(images.map((image) => image.pixels)) };
}

function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1)); // filter byte 0 (none) on every row
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function pngChunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}
