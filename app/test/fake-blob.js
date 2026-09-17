// In-memory stand-in for the three `@vercel/blob` calls lib/store.js makes (put, list) plus
// the `fetch` it uses to read a blob body. Handed to `_setBlobClientForTests()` so the Blob
// code path runs without a token. Faithful where it matters for the tests: deterministic
// URLs (`${base}/${pathname}` when addRandomSuffix is false), put refusing to overwrite
// unless `allowOverwrite: true` (same message the SDK surfaces), list() with prefix +
// cursor pagination, fetch answering 404 for a missing pathname and ignoring the query.
//
// What it does NOT simulate, and so what these tests cannot prove:
// - list() eventual consistency (here a put is visible to list() immediately);
// - the CDN in front of blob URLs (here a fetch always sees the latest body, so the
//   cacheControlMaxAge / cache-bust handling is exercised but its effect is not);
// - multiple serverless instances (one process; `_setBlobClientForTests` re-injecting the
//   same fake is the closest thing to a cold start);
// - network partitions mid-request, rate limits, token/permission errors.
export function createFakeBlob({ base = 'https://fake.public.blob.vercel-storage.com', pageSize = 1000 } = {}) {
  const blobs = new Map(); // pathname -> { body: Buffer, contentType, uploadedAt, options }
  const puts = []; // every put attempt, in order: { pathname, options, ok }
  const fail = { list: false, fetch: false, put: false };
  // Pathnames that list() (hiddenFromList) or fetch() (hiddenFromFetch) pretend not to
  // have while put() still knows them: the closest this fake gets to list() lag and a
  // stale edge behind a write.
  const hiddenFromList = new Set();
  const hiddenFromFetch = new Set();

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
    if (options.addRandomSuffix !== false) throw new Error('fake-blob: store must set addRandomSuffix: false');
    if (blobs.has(pathname) && options.allowOverwrite !== true) {
      puts.push({ pathname, options, ok: false });
      throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it');
    }
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    blobs.set(pathname, {
      body: buf,
      contentType: options.contentType || 'application/octet-stream',
      uploadedAt: new Date(),
      options,
    });
    puts.push({ pathname, options, ok: true });
    return { url: urlFor(pathname), downloadUrl: `${urlFor(pathname)}?download=1`, pathname, contentType: options.contentType };
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
    const b = hiddenFromFetch.has(pathname) ? null : blobs.get(pathname);
    if (!b) return new Response('The requested blob does not exist (fake)', { status: 404 });
    return new Response(b.body, { status: 200, headers: { 'content-type': b.contentType } });
  }

  // Test helpers (not part of the SDK surface).
  function seed(pathname, body, { contentType = 'application/json', uploadedAt = new Date() } = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    blobs.set(pathname, { body: buf, contentType, uploadedAt, options: {} });
  }
  function readJson(pathname) {
    const b = blobs.get(pathname);
    return b ? JSON.parse(b.body.toString('utf8')) : null;
  }
  function keys(prefix = '') {
    return Array.from(blobs.keys()).filter((p) => p.startsWith(prefix)).sort();
  }

  return { put, list, fetch, base, blobs, puts, fail, hiddenFromList, hiddenFromFetch, seed, readJson, keys };
}
