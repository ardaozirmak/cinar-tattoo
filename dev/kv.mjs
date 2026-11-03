// A Workers KV namespace over a folder, for local development and tests. It implements the
// part of the KV API the site uses: get, getWithMetadata, put, delete and list.
//
// Storage: `<dir>/<encodeURIComponent(key)>.bin` holds the value and, when the key has
// metadata, `<dir>/<encodeURIComponent(key)>.meta.json` holds it.
//
// Known limits of this shim:
// - On Windows (NTFS) file names are case-insensitive, so keys that differ only in case, such
//   as "A" and "a", share one file there; the real KV tells them apart. Keep keys lower-case,
//   as the site's `img/<hex>/full` ones are.
// - A key whose encoded form is longer than roughly 240 characters does not fit in a file
//   name (the real KV allows 512 bytes).
// - `expiration`, `expirationTtl` and `cacheTtl` are accepted and ignored. list() has no
//   pagination, and says so loudly: it throws on `limit` and `cursor` rather than ignoring them.
import { mkdirSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_METADATA_BYTES = 1024;
const GET_TYPES = ['text', 'json', 'arrayBuffer', 'stream'];
const VALUE_EXT = '.bin';
const META_EXT = '.meta.json';

export function createKV(dir) {
  mkdirSync(dir, { recursive: true });

  const pathsOf = (key) => {
    if (typeof key !== 'string' || key === '') throw new TypeError('KV key must be a non-empty string.');
    // encodeURIComponent leaves "*" alone, but Windows does not allow it in a file name.
    const name = encodeURIComponent(key).replaceAll('*', '%2A');
    // The extension goes on before join(): join() resolves a bare "." or ".." segment, which
    // would send the keys "." and ".." out of the folder.
    return { value: join(dir, name + VALUE_EXT), meta: join(dir, name + META_EXT) };
  };

  async function getWithMetadata(key, typeOrOptions) {
    const type = getType(typeOrOptions);
    const paths = pathsOf(key);
    const bytes = await readOrNull(paths.value);
    if (bytes === null) return { value: null, metadata: null };
    const metaBytes = await readOrNull(paths.meta);
    return {
      value: decode(bytes, type),
      metadata: metaBytes === null ? null : JSON.parse(metaBytes.toString('utf8')),
    };
  }

  return {
    async get(key, typeOrOptions) {
      return (await getWithMetadata(key, typeOrOptions)).value;
    },

    getWithMetadata,

    async put(key, value, options) {
      const paths = pathsOf(key);
      // Check everything before touching the disk, so a rejected put changes nothing.
      const metaJson = serializeMetadata(options?.metadata);
      const bytes = await toBytes(value);
      await writeFile(paths.value, bytes);
      if (metaJson === null) await rm(paths.meta, { force: true });
      else await writeFile(paths.meta, metaJson);
    },

    async delete(key) {
      const paths = pathsOf(key);
      await rm(paths.value, { force: true });
      await rm(paths.meta, { force: true });
    },

    async list(options) {
      if (options?.limit !== undefined || options?.cursor !== undefined) {
        throw new TypeError('The dev KV shim does not paginate: list() supports `prefix` only, not `limit` or `cursor`.');
      }
      const prefix = options?.prefix ?? '';
      const names = (await readdir(dir))
        .filter((file) => file.endsWith(VALUE_EXT))
        .map((file) => decodeURIComponent(file.slice(0, -VALUE_EXT.length)))
        .filter((name) => name.startsWith(prefix))
        .sort();

      const keys = [];
      for (const name of names) {
        const metaBytes = await readOrNull(pathsOf(name).meta);
        // As in the real KV, a key without metadata has no `metadata` property.
        keys.push(metaBytes === null ? { name } : { name, metadata: JSON.parse(metaBytes.toString('utf8')) });
      }
      return { keys, list_complete: true };
    },
  };
}

async function readOrNull(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function getType(typeOrOptions) {
  const type = (typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions?.type) ?? 'text';
  if (!GET_TYPES.includes(type)) {
    throw new TypeError(`KV get() type must be one of ${GET_TYPES.join(', ')}; got '${type}'.`);
  }
  return type;
}

function decode(bytes, type) {
  switch (type) {
    case 'text':
      return bytes.toString('utf8');
    case 'json':
      return JSON.parse(bytes.toString('utf8'));
    case 'arrayBuffer':
      // A copy of exactly these bytes, not Node's possibly larger pooled ArrayBuffer.
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    case 'stream':
      return new Response(bytes).body;
  }
}

// null for "no metadata". The limit is on the serialised JSON, counted in bytes, as in the real KV.
function serializeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return null;
  const json = JSON.stringify(metadata);
  const size = Buffer.byteLength(json);
  if (size > MAX_METADATA_BYTES) {
    throw new Error(`KV PUT failed: 413 Metadata length ${size} exceeds the limit of ${MAX_METADATA_BYTES} bytes.`);
  }
  return json;
}

async function toBytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  // Only the view's own bytes, which may be a slice of a bigger buffer.
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ReadableStream) return Buffer.from(await new Response(value).arrayBuffer());
  throw new TypeError('KV put() accepts only strings, ArrayBuffers, ArrayBufferViews, and ReadableStreams as values.');
}
