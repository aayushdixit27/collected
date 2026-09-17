// Storage: local filesystem by default, Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
//
// Blob layout (round 3). No request ever reads, modifies and rewrites a shared file, and no
// read failure can trigger a reseed:
//   collected/seed-v2.json         one immutable blob { seedVersion, records }: the demo seed
//   collected/records/<id>.json    one blob per real record; a seed record that gets a
//                                  ticket also gets one here (full record, seed: true kept)
//   collected/photos/<id>.jpg      capture photo, never overwritten
//   collected/tickets/<id>.jpg     ticket photo, never overwritten
// listRecords = seed overlaid by records/ (id wins). getRecord = direct fetch of the
// deterministic records/ URL, then the seed. Any storage error is thrown; the API answers
// 503. The old collected/index-<ts>.json files are read exactly once, by the migration, and
// are otherwise dead.
//
// Ticket attach is guarded at the origin: the record is written with `ifMatch: <ETag read>`
// (or `allowOverwrite: false` for a seed record's first override), so two attaches racing
// past the handler's 409 check cannot both land; the loser gets a 409, not a lost update.
//
// Testing: the Blob client is injectable. `_setBlobClientForTests({ put, list, head, fetch,
// BlobPreconditionFailedError })` switches this module onto the Blob code path with that
// client (and clears every module-scope cache below, so each call behaves like a fresh
// serverless instance).
// test/fake-blob.js is the in-memory implementation; passing null restores the real
// `@vercel/blob` + global fetch and the local backend. Nothing in lib/ imports from test/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateSchedule, generateSeedRecords } from './seedgen.js';
import { datePrefix, randomSuffix } from './ids.js';

const DATA_DIR = process.env.COLLECTED_DATA_DIR || path.join(process.cwd(), '.data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const TICKETS_DIR = path.join(DATA_DIR, 'tickets');

// The seed shape bumped when tickets were added (records gained `pricing`/`ticket`). On
// Blob the version is in the blob name (collected/seed-v2.json); a future shape change is a
// new name, never an overwrite. Locally, an index written before that stamp is missing
// seedVersion entirely, which is how a stale index is told apart from a current one.
const SEED_VERSION = 2;
const SEED_KEY = `collected/seed-v${SEED_VERSION}.json`;
const RECORDS_PREFIX = 'collected/records/';
const PHOTOS_PREFIX = 'collected/photos/';
const INDEX_PREFIX = 'collected/index-';

// Every stop bills the same schedule (see lib/seedgen.js); real records that predate the
// ticket feature have neither key and get this on migration.
const DEFAULT_PRICING = { includedLb: 2000, ratePerTon: 95 };

// Record and seed JSON is overwritten at a fixed URL, so the Blob CDN cache is in play. The
// SDK's documented floor for cacheControlMaxAge is one minute (node_modules/@vercel/blob
// create-folder-*.d.ts: "The minimum is 1 minute"); anything lower is rejected. Reads also
// send cache: 'no-store' and a cache-busting query so a warm edge cannot hand back the
// pre-ticket version, but the residual window is still up to 60 s across instances.
const JSON_CACHE_MAX_AGE_S = 60;

// How many record blobs are fetched at once when listing.
const FETCH_CONCURRENCY = 20;

// ---- module-scope state (per process / per serverless instance) ----
let injectedClient = null;
let blobBase = process.env.BLOB_BASE_URL ? process.env.BLOB_BASE_URL.replace(/\/+$/, '') : null;
let seedCache = null; // records array of the immutable seed once fetched
let seedPromise = null; // single-flight: seed exists (or has been written) + migration ran
let seedFailedAt = 0; // last time the seed check threw; retried only after SEED_RETRY_MS
let seedLastError = null;
const SEED_RETRY_MS = 1000;
// Records written by this process, newest write per id, with the ETag the put returned.
// Beats list() lag and the CDN window for reads that land on the same instance as the
// write; see mergeRecent().
const recent = new Map(); // id -> { record, etag }
const RECENT_MAX = 500;
function remember(record, etag) {
  recent.delete(record.id);
  recent.set(record.id, { record, etag: etag || null });
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value);
}

// Thrown by putTicket when the record already carries a ticket at the origin (ETag
// mismatch or a seed override that already exists). The handler maps it to 409.
export const TICKET_CONFLICT = 'ticket_conflict';
function conflict() {
  const err = new Error('ticket already recorded for this record');
  err.code = TICKET_CONFLICT;
  return err;
}

export function _setBlobClientForTests(client) {
  injectedClient = client || null;
  blobBase = process.env.BLOB_BASE_URL ? process.env.BLOB_BASE_URL.replace(/\/+$/, '') : null;
  seedCache = null;
  seedPromise = null;
  seedFailedAt = 0;
  seedLastError = null;
  recent.clear();
}

function useBlob() {
  return !!injectedClient || !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function blobClient() {
  if (injectedClient) return injectedClient;
  const { put, list, head, BlobPreconditionFailedError } = await import('@vercel/blob');
  return { put, list, head, fetch: globalThis.fetch, BlobPreconditionFailedError };
}

// Up to three ids are tried on create; a collision at the origin (blob already exists)
// means another instance took the id in the same second.
const ID_TRIES = 3;
function freshId(record) {
  return `${datePrefix(record.capturedAt)}-${randomSuffix()}`;
}

function byNewest(a, b) {
  return new Date(b.capturedAt) - new Date(a.capturedAt);
}

// ---- local backend ----
// Single process, single file. Read-modify-write is fine here as long as concurrent
// requests in this one process take turns, which the lock below makes them do.
let localLock = Promise.resolve();
function withLocalLock(fn) {
  const run = localLock.then(fn, fn);
  localLock = run.catch(() => {});
  return run;
}

// Older on-disk indexes were a bare array with no seedVersion at all. Normalize both shapes
// to { seedVersion, records } so every local caller below has one thing to read.
function normalizeIndex(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { seedVersion: undefined, records: raw };
  return { seedVersion: raw.seedVersion, records: Array.isArray(raw.records) ? raw.records : [] };
}

async function readLocalIndex() {
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf8');
    return normalizeIndex(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeLocalIndex(records) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify({ seedVersion: SEED_VERSION, records }));
}

async function localListRecords() {
  const index = await readLocalIndex();
  return index ? index.records : [];
}

async function localPutRecord(record, photoJpegBuffer) {
  return withLocalLock(async () => {
    const records = await localListRecords();
    const taken = new Set(records.map((r) => r.id));
    for (let i = 1; taken.has(record.id); i++) {
      if (i >= ID_TRIES) throw new Error(`could not find a free id after ${ID_TRIES} tries`);
      record.id = freshId(record);
    }
    if (photoJpegBuffer) {
      await fs.mkdir(PHOTOS_DIR, { recursive: true });
      await fs.writeFile(path.join(PHOTOS_DIR, `${record.id}.jpg`), photoJpegBuffer);
      record.photoUrl = `/api/photo/${record.id}.jpg`;
    }
    records.push(record);
    records.sort(byNewest);
    await writeLocalIndex(records);
    return record;
  });
}

// An index at the current seedVersion is left alone. Anything else (missing entirely, or
// stamped with an older/no seedVersion) is regenerated, but any non-seed record already in
// it (a real capture) survives the regeneration; only the seed rows are replaced.
//
// Two things this migration must get right, both fixed after round-1 checker findings:
// - The keep predicate is `r.seed !== true`, not `r.seed === false`. A real record from
//   before `seed` existed at all has no flag; treating "flag missing" as "drop it" would
//   silently delete real phone captures on the one-time migration. Only an explicit
//   `seed: true` is safe to discard.
// - A kept real record is backfilled with `pricing`/`ticket` if it predates this round.
async function localEnsureSeeded() {
  return withLocalLock(async () => {
    const existing = await readLocalIndex();
    if (existing && existing.seedVersion === SEED_VERSION && existing.records.length > 0) {
      return existing.records;
    }
    const seeded = generateSeedRecords(generateSchedule(), Date.now());
    const kept = existing ? existing.records.filter((r) => r.seed !== true).map(backfill) : [];
    const merged = seeded.concat(kept).sort(byNewest);
    await writeLocalIndex(merged);
    return merged;
  });
}

async function localPutTicket(id, fields, jpegBuffer) {
  await fs.mkdir(TICKETS_DIR, { recursive: true });
  await fs.writeFile(path.join(TICKETS_DIR, `${id}.jpg`), jpegBuffer);
  const photoUrl = `/api/ticket/${id}.jpg`;
  return withLocalLock(async () => {
    const records = await localListRecords();
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    if (records[idx].ticket) throw conflict();
    const record = { ...records[idx], ticket: { photoUrl, ...fields } };
    records[idx] = record;
    await writeLocalIndex(records);
    return record;
  });
}

function hasRealTicket(r) {
  return !!(r.ticket && typeof r.ticket.photoUrl === 'string' && r.ticket.photoUrl.includes('/collected/tickets/'));
}

function backfill(r) {
  return { ...r, pricing: r.pricing ?? DEFAULT_PRICING, ticket: r.ticket ?? null };
}

// ---- blob backend ----
function rememberBase(url) {
  if (!blobBase && url) blobBase = new URL(url).origin;
}

function recordKey(id) {
  return `${RECORDS_PREFIX}${id}.json`;
}

function extractTs(pathname) {
  const m = pathname.match(/index-(\d+)\.json$/);
  return m ? Number(m[1]) : 0;
}

// The SDK refuses to overwrite unless asked (allowOverwrite defaults to false) and reports
// it as a plain BlobError; the message is the only handle on it.
function isAlreadyExists(err) {
  return /already exists/i.test(String(err && err.message));
}

// `ifMatch` mismatch: the SDK throws BlobPreconditionFailedError (extends BlobError, no
// custom name), so the class is checked when the client exposes it, the message otherwise.
function isPreconditionFailed(err, client) {
  if (client && client.BlobPreconditionFailedError && err instanceof client.BlobPreconditionFailedError) return true;
  return /precondition failed|etag mismatch/i.test(String(err && err.message));
}

// Walks every page of a prefix listing. list() is eventually consistent; callers that need
// a just-written blob use its deterministic URL instead.
async function listAll(prefix) {
  const { list } = await blobClient();
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs || []) out.push(b);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (out.length) rememberBase(out[0].url);
  return out;
}

// GET a JSON blob: { json, etag } (etag null if the response carried none), null on 404,
// throws on anything else. `bust` appends a unique query so an edge cache keyed on the
// full URL cannot serve an older version.
async function fetchJson(url, bust) {
  const { fetch: doFetch } = await blobClient();
  const target = bust ? `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}${Math.random().toString(36).slice(2, 8)}` : url;
  const res = await doFetch(target, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`blob fetch ${res.status} for ${url}`);
  return { json: await res.json(), etag: res.headers.get('etag') || null };
}

// `guard` is one of { allowOverwrite: true }, { allowOverwrite: false } or
// { ifMatch: <etag> } (which the SDK treats as an overwrite).
async function putJson(key, obj, guard) {
  const { put } = await blobClient();
  const result = await put(key, JSON.stringify(obj), {
    access: 'public',
    addRandomSuffix: false,
    ...guard,
    contentType: 'application/json',
    cacheControlMaxAge: JSON_CACHE_MAX_AGE_S,
  });
  rememberBase(result.url);
  return result;
}

// Fetch many record blobs with bounded parallelism. A listed blob that 404s on fetch (list
// ran ahead of a delete, or behind a rename) is skipped; any other failure throws.
async function fetchRecords(urls) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      const got = await fetchJson(url, true);
      if (got && got.json && got.json.id) out.push(got.json);
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, urls.length) }, worker));
  return out;
}

// The only mutation a record ever sees is a ticket being attached, so between two copies
// of the same id the one with a ticket is the newer one; otherwise trust this process's own
// last write.
function mergeRecent(id, fetched) {
  const mine = recent.get(id);
  if (!mine) return fetched;
  if (fetched && fetched.record.ticket && !mine.record.ticket) return fetched;
  return mine;
}

// The seed is immutable, so one fetch per process is enough. Only called once the seed is
// known to exist (blobEnsureSeeded ran, or is running and calling this from the migration).
async function loadSeed() {
  if (seedCache) return seedCache;
  const got = await fetchJson(`${blobBase}/${SEED_KEY}`, false);
  if (!got || !Array.isArray(got.json.records)) throw new Error('seed blob missing or malformed');
  seedCache = got.json.records;
  return seedCache;
}

async function blobSeedRecords() {
  await blobEnsureSeeded();
  return loadSeed();
}

async function blobListRecords() {
  const seed = await blobSeedRecords();
  const blobs = await listAll(RECORDS_PREFIX);
  const overrides = await fetchRecords(blobs.map((b) => b.url));
  const byId = new Map(seed.map((r) => [r.id, r]));
  for (const r of overrides) byId.set(r.id, r);
  for (const id of recent.keys()) {
    const stored = byId.get(id);
    byId.set(id, mergeRecent(id, stored ? { record: stored, etag: null } : null).record);
  }
  return Array.from(byId.values()).sort(byNewest);
}

// Reads one record with its provenance: { record, etag, source } where source is 'blob'
// (records/<id>.json, etag from the response), 'recent' (this instance's own last write,
// etag from the put result) or 'seed' (no override exists yet). null if unknown.
async function readRecord(id) {
  await blobEnsureSeeded();
  let fetched = null;
  if (blobBase) {
    fetched = await fetchJson(`${blobBase}/${recordKey(id)}`, true);
  } else {
    // Base not learned yet (fresh instance, no BLOB_BASE_URL, list gave nothing): one
    // listing for this id teaches it, then the direct URL is used from here on.
    const blobs = await listAll(recordKey(id));
    const hit = blobs.find((b) => b.pathname === recordKey(id));
    if (hit) fetched = await fetchJson(hit.url, true);
  }
  const stored = fetched ? { record: fetched.json, etag: fetched.etag } : null;
  const merged = mergeRecent(id, stored);
  if (merged) return { ...merged, source: merged === stored ? 'blob' : 'recent' };
  const seed = await blobSeedRecords();
  const row = seed.find((r) => r.id === id);
  return row ? { record: row, etag: null, source: 'seed' } : null;
}

async function blobGetRecord(id) {
  const got = await readRecord(id);
  return got ? got.record : null;
}

// Create never overwrites: photo and record are both put with the SDK's default
// (allowOverwrite false). "Already exists" on either means another instance took this id
// in the same second; the id is regenerated and both puts retried, up to ID_TRIES.
async function blobPutRecord(record, photoJpegBuffer) {
  const { put } = await blobClient();
  for (let attempt = 1; ; attempt++) {
    try {
      if (photoJpegBuffer) {
        const { url } = await put(`${PHOTOS_PREFIX}${record.id}.jpg`, photoJpegBuffer, {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'image/jpeg',
        });
        rememberBase(url);
        record.photoUrl = url;
      }
      const result = await putJson(recordKey(record.id), record, { allowOverwrite: false });
      remember(record, result.etag);
      return record;
    } catch (err) {
      if (!isAlreadyExists(err) || attempt >= ID_TRIES) throw err;
      record.id = freshId(record);
      record.photoUrl = null;
    }
  }
}

// The ticket photo gets a random suffix (the record carries the absolute URL), so an
// orphaned tickets/<id>.jpg from the old design never blocks a real attach. The record put
// is the guard: `ifMatch` with the ETag the record was read under, or `allowOverwrite:
// false` when no override exists yet (seed record). Either failing means someone else
// attached first: TICKET_CONFLICT, which the handler answers with 409.
async function blobPutTicket(id, fields, jpegBuffer) {
  const client = await blobClient();
  const got = await readRecord(id);
  if (!got) return null;
  let { record: current, etag, source } = got;

  let guard;
  if (source === 'seed') {
    guard = { allowOverwrite: false };
  } else {
    if (!etag) {
      // Fallback case: the copy came from this instance's `recent` overlay with no ETag
      // on the put result, or the blob response carried no ETag header. Ask the origin.
      const fresh = await fetchJson(`${blobBase}/${recordKey(id)}`, true);
      if (fresh) {
        current = fresh.json;
        etag = fresh.etag;
        if (!etag && client.head) {
          try {
            etag = (await client.head(`${blobBase}/${recordKey(id)}`)).etag || null;
          } catch {
            etag = null;
          }
        }
      }
    }
    if (current.ticket) throw conflict();
    if (etag) {
      guard = { ifMatch: etag };
    } else {
      // No ETag obtainable anywhere: the origin guard cannot be applied. Fall back to the
      // handler's check alone and say so loudly; see the report's residual window.
      console.error(`ticket attach on ${id}: no ETag available, writing without ifMatch`);
      guard = { allowOverwrite: true };
    }
  }

  const { url } = await client.put(`collected/tickets/${id}.jpg`, jpegBuffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'image/jpeg',
  });
  rememberBase(url);
  const record = { ...current, ticket: { photoUrl: url, ...fields } };
  let result;
  try {
    result = await putJson(recordKey(id), record, guard);
  } catch (err) {
    if (isPreconditionFailed(err, client) || isAlreadyExists(err)) throw conflict();
    throw err;
  }
  remember(record, result.etag);
  return record;
}

// Seed is written only when list() shows no seed blob AND a direct fetch of its
// deterministic URL 404s. Either check erroring (network, 5xx) throws straight out: the
// API answers 503 and nothing is written. A lost race with another instance (put says the
// blob already exists) counts as "seed exists". Then the one-time migration runs.
async function blobEnsureSeeded() {
  if (!seedPromise) {
    // A check that just failed is not retried for SEED_RETRY_MS; requests in that window
    // get the same error straight back instead of hammering a store that is down.
    if (seedLastError && Date.now() - seedFailedAt < SEED_RETRY_MS) throw seedLastError;
    seedPromise = (async () => {
      const listed = await listAll(SEED_KEY);
      let exists = listed.some((b) => b.pathname === SEED_KEY);
      if (!exists && !blobBase) {
        // Nothing listed and no base known: the store is either brand new or list() is
        // lagging. Any one blob teaches the base for the direct check below.
        const { list } = await blobClient();
        const { blobs } = await list({ prefix: 'collected/', limit: 1 });
        if (blobs && blobs.length) rememberBase(blobs[0].url);
      }
      if (!exists && blobBase) {
        const got = await fetchJson(`${blobBase}/${SEED_KEY}`, true);
        if (got && Array.isArray(got.json.records)) {
          seedCache = got.json.records;
          exists = true;
        }
      }
      if (!exists) {
        const records = generateSeedRecords(generateSchedule(), Date.now());
        try {
          await putJson(SEED_KEY, { seedVersion: SEED_VERSION, records }, { allowOverwrite: false });
          seedCache = records;
        } catch (err) {
          if (!isAlreadyExists(err)) throw err;
        }
      }
      await blobMigrate();
      seedLastError = null;
    })().catch((err) => {
      seedPromise = null; // next request (after the backoff) retries from the top
      seedFailedAt = Date.now();
      seedLastError = err;
      throw err;
    });
  }
  await seedPromise;
}

// One-time migration off the index-file design. The newest collected/index-<ts>.json is
// read and every record in it that is not a seed row is copied to its own blob. Then every
// capture photo with no record anywhere gets a minimal recovered record. Index files are
// left alone (the architect deletes them after checking counts). Every write here refuses
// to overwrite: a record that already has its own blob (possibly with a ticket attached
// since) is never clobbered, whatever list() claims.
async function blobMigrate() {
  const indexes = await listAll(INDEX_PREFIX);
  const photos = await listAll(PHOTOS_PREFIX);
  if (indexes.length === 0 && photos.length === 0) return;

  const seed = await loadSeed();
  const seedIds = new Set(seed.map((r) => r.id));
  // ids that already have their own records/ blob; nothing below may overwrite one.
  const stored = new Set();
  for (const b of await listAll(RECORDS_PREFIX)) {
    const m = b.pathname.match(/^collected\/records\/(.+)\.json$/);
    if (m) stored.add(m[1]);
  }

  async function copyIfAbsent(record) {
    if (stored.has(record.id)) return;
    if (blobBase && (await fetchJson(`${blobBase}/${recordKey(record.id)}`, true))) {
      stored.add(record.id);
      return;
    }
    try {
      await putJson(recordKey(record.id), record, { allowOverwrite: false });
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
    stored.add(record.id);
  }

  // Newest index first. A listed index that 404s (list() lagging behind a delete, the very
  // pattern that lost tonight's records) is not an error: fall through to the next one, and
  // to nothing if none is readable. A 5xx still throws.
  let index = null;
  for (const b of indexes.slice().sort((a, c) => extractTs(c.pathname) - extractTs(a.pathname))) {
    const got = await fetchJson(b.url, true);
    index = got ? normalizeIndex(got.json) : null;
    if (index) break;
  }
  for (const r of index ? index.records : []) {
    if (!r.id) continue;
    // Same predicate as the local migration: only an explicit seed: true is discarded,
    // with one exception. Under the old design a seed record that got a real ticket kept
    // that ticket in the index only; it is copied as an override (seed: true kept), which
    // is exactly what a ticket on a seed record produces now. A seed-generated ticket
    // (photoUrl under /api/ticket/) is not real and is not copied.
    if (r.seed === true && !hasRealTicket(r)) continue;
    await copyIfAbsent(backfill(r));
  }

  for (const b of photos) {
    const m = b.pathname.match(/^collected\/photos\/(.+)\.jpg$/);
    if (!m || stored.has(m[1]) || seedIds.has(m[1])) continue;
    const uploadedAt = b.uploadedAt ? new Date(b.uploadedAt).toISOString() : new Date().toISOString();
    await copyIfAbsent({
      id: m[1],
      address: 'Unknown — recovered from photo',
      status: 'collected',
      capturedAt: uploadedAt,
      photoUrl: b.url,
      seed: false,
      recovered: true,
    });
  }
}

// ---- public interface ----
export async function listRecords() {
  return useBlob() ? blobListRecords() : localListRecords();
}

export async function getRecord(id) {
  if (useBlob()) return blobGetRecord(id);
  const records = await localListRecords();
  return records.find((r) => r.id === id) || null;
}

// photoJpegBuffer is null for records that already carry a photoUrl (seed records never
// call this with a buffer; real captures always do — validated in the API handler).
export async function putRecord(record, photoJpegBuffer) {
  return useBlob() ? blobPutRecord(record, photoJpegBuffer) : localPutRecord(record, photoJpegBuffer);
}

// On Blob this makes sure the immutable seed exists and runs the one-time migration; it
// never rewrites a seed that exists and never writes on a failed check. Throws on any
// storage error so the handler can answer 503.
export async function ensureSeeded() {
  if (useBlob()) {
    await blobEnsureSeeded();
    return blobSeedRecords();
  }
  return localEnsureSeeded();
}

// Attaches a scale ticket to an existing record: stores the ticket photo (Blob when
// configured, local `.data/tickets/<id>.jpg` otherwise) and writes `record.ticket`. Callers
// (the API handler) are expected to have already checked the record exists and has no
// ticket yet; this returns null if the id vanished between that check and this call.
export async function putTicket(id, fields, jpegBuffer) {
  return useBlob() ? blobPutTicket(id, fields, jpegBuffer) : localPutTicket(id, fields, jpegBuffer);
}
