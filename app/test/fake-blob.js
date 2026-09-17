// In-memory stand-in for the `@vercel/blob` calls lib/store.js makes (put, list, head) plus
// the `fetch` it uses to read a blob body. Handed to `_setBlobClientForTests()` so the Blob
// code path runs without a token. Faithful where it matters for the tests: deterministic
// URLs (`${base}/${pathname}` when addRandomSuffix is false, `-<suffix>` before the
// extension when true), put refusing to overwrite unless `allowOverwrite: true` (same
// message the SDK surfaces), an ETag per version returned by put/head and as the `ETag`
// header on fetch, `ifMatch` rejected on mismatch with a `BlobPreconditionFailedError` of
// the SDK's message (and the SDK's "contradictory" error when paired with
// `allowOverwrite: false`), list() with prefix + cursor pagination, fetch answering 404 for
// a missing pathname and ignoring the query.
//
// What it does NOT simulate, and so what these tests cannot prove:
// - list() eventual consistency (here a put is visible to list() immediately);
// - the CDN in front of blob URLs (here a fetch always sees the latest body, so the
//   cacheControlMaxAge / cache-bust handling is exercised but its effect is not);
// - multiple serverless instances (one process; `_setBlobClientForTests` re-injecting the
//   same fake is the closest thing to a cold start);
// - network partitions mid-request, rate limits, token/permission errors.
// Same shape as the SDK's: extends Error, no custom name, message prefixed "Vercel Blob: ".
export class BlobPreconditionFailedError extends Error {
  constructor() {
    super('Vercel Blob: Precondition failed: ETag mismatch.');
  }
}

let etagCounter = 0;
function newEtag() {
  etagCounter += 1;
  return `"fake-etag-${etagCounter}"`;
}

export function createFakeBlob({ base = 'https://fake.public.blob.vercel-storage.com', pageSize = 1000 } = {}) {
  const blobs = new Map(); // pathname -> { body: Buffer, contentType, uploadedAt, options, etag }
  const puts = []; // every put attempt, in order: { pathname, options, ok }
  const fail = { list: false, fetch: false, put: false };
  // Pathnames that list() (hiddenFromList) or fetch() (hiddenFromFetch) pretend not to
  // have while put() still knows them: the closest this fake gets to list() lag and a
  // stale edge behind a write.
  const hiddenFromList = new Set();
  const hiddenFromFetch = new Set();
  // Pathnames whose fetch() keeps serving a snapshot taken at freezeFetch() time while
  // put()/head() see the live version: a stale edge cache in front of an overwritten blob.
  const frozen = new Map();

  function urlFor(pathname) {
    return `${base}/${pathname}`;
  }

  function entry(pathname) {
    const b = blobs.get(pathname);
    return {
      url: urlFor(pathname),
      downloadUrl: `${urlFor(pathname)}?download=1`,
      pathname,
      size: b.body.length,
      uploadedAt: b.uploadedAt,
    };
  }

  async function put(pathname, body, options = {}) {
    if (fail.put) {
      puts.push({ pathname, options, ok: false });
      throw new Error('Vercel Blob: service unavailable (fake)');
    }
    if (options.addRandomSuffix === undefined) throw new Error('fake-blob: store must set addRandomSuffix explicitly');
    if (options.addRandomSuffix === true) {
      const dot = pathname.lastIndexOf('.');
      const suffix = Math.random().toString(36).slice(2, 12);
      pathname = dot === -1 ? `${pathname}-${suffix}` : `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}`;
    }
    if (options.ifMatch && options.allowOverwrite === false) {
      throw new Error('Vercel Blob: ifMatch and allowOverwrite: false are contradictory. ifMatch is used for conditional overwrites, which requires allowOverwrite to be true.');
    }
    const existing = blobs.get(pathname);
    if (options.ifMatch) {
      if (!existing || existing.etag !== options.ifMatch) {
        puts.push({ pathname, options, ok: false });
        throw new BlobPreconditionFailedError();
      }
    } else if (existing && options.allowOverwrite !== true) {
      puts.push({ pathname, options, ok: false });
      throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it');
    }
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const etag = newEtag();
    blobs.set(pathname, {
      body: buf,
      contentType: options.contentType || 'application/octet-stream',
      uploadedAt: new Date(),
      options,
      etag,
    });
    puts.push({ pathname, options, ok: true });
    return { url: urlFor(pathname), downloadUrl: `${urlFor(pathname)}?download=1`, pathname, contentType: options.contentType, contentDisposition: 'inline', etag };
  }

  async function head(urlOrPathname) {
    if (fail.list) throw new Error('Vercel Blob: head failed (fake 503)');
    const pathname = urlOrPathname.startsWith('http') ? new URL(urlOrPathname).pathname.replace(/^\//, '') : urlOrPathname;
    const b = blobs.get(pathname);
    if (!b) throw new Error('Vercel Blob: The requested blob does not exist');
    return { ...entry(pathname), contentType: b.contentType, contentDisposition: 'inline', cacheControl: '', etag: b.etag };
  }

  async function list({ prefix = '', cursor, limit } = {}) {
    if (fail.list) throw new Error('Vercel Blob: list failed (fake 503)');
    const all = Array.from(blobs.keys())
      .filter((p) => p.startsWith(prefix) && !hiddenFromList.has(p))
      .sort()
      .map(entry);
    const start = cursor ? Number(cursor) : 0;
    const size = Math.min(limit || pageSize, pageSize);
    const page = all.slice(start, start + size);
    const hasMore = start + size < all.length;
    return { blobs: page, cursor: hasMore ? String(start + size) : undefined, hasMore };
  }

  async function fetch(url) {
    if (fail.fetch) return new Response('upstream error (fake)', { status: 502 });
    const u = new URL(url);
    if (u.origin !== base) return new Response('wrong host', { status: 404 });
    const pathname = u.pathname.replace(/^\//, '');
    const b = hiddenFromFetch.has(pathname) ? null : frozen.get(pathname) || blobs.get(pathname);
    if (!b) return new Response('The requested blob does not exist (fake)', { status: 404 });
    return new Response(b.body, { status: 200, headers: { 'content-type': b.contentType, etag: b.etag } });
  }

  // Test helpers (not part of the SDK surface).
  function seed(pathname, body, { contentType = 'application/json', uploadedAt = new Date() } = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    blobs.set(pathname, { body: buf, contentType, uploadedAt, options: {}, etag: newEtag() });
  }
  function freezeFetch(pathname) {
    const b = blobs.get(pathname);
    if (b) frozen.set(pathname, { ...b });
  }
  function unfreezeFetch(pathname) {
    frozen.delete(pathname);
  }
  function etagOf(pathname) {
    const b = blobs.get(pathname);
    return b ? b.etag : null;
  }
  function readJson(pathname) {
    const b = blobs.get(pathname);
    return b ? JSON.parse(b.body.toString('utf8')) : null;
  }
  function keys(prefix = '') {
    return Array.from(blobs.keys()).filter((p) => p.startsWith(prefix)).sort();
  }

  return { put, list, head, fetch, BlobPreconditionFailedError, base, blobs, puts, fail, hiddenFromList, hiddenFromFetch, freezeFetch, unfreezeFetch, seed, readJson, keys, etagOf };
}
