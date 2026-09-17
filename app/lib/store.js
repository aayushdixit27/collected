// Storage: local filesystem by default, Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
//
// Blob layout (round 4): every blob is written once and never overwritten. The edge cache
// in front of blob URLs ignores query strings, so an overwritten blob could be served stale
// for the cache TTL; immutable files make that impossible. 404s are not cached (measured),
// so a file that appears is visible on the very next read.
//   collected/seed-v2.json                one blob { seedVersion, records }: the demo seed
//   collected/records/<id>.json           one blob per real record, written at create
//   collected/records/<id>.ticket.json    the ticket object, written at attach; a second
//                                         attach hits "already exists" and is a 409
//   collected/photos/<id>.jpg             capture photo
//   collected/tickets/<id>-<suffix>.jpg   ticket photo (random suffix; the ticket carries
//                                         the absolute URL)
// getRecord = two parallel deterministic-URL fetches (record + ticket), 404 -> null, merged;
// seed records are the seed entry + optional ticket file. listRecords = list() of records/
// grouped by id, both files fetched per id (20 at a time), overlaid on the seed. Any storage
// error is thrown; the API answers 503. Migrations (run once per instance inside the seed
// check): round 3's index-*.json -> records/ copy and orphan-photo recovery, then round 4's
// split of any embedded `ticket` in a records/<id>.json into <id>.ticket.json. Readers use
// an embedded ticket only when no ticket file exists.
//
// Testing: the Blob client is injectable. `_setBlobClientForTests({ put, list, fetch })`
// switches this module onto the Blob code path with that client (and clears every
// module-scope cache below, so each call behaves like a fresh serverless instance);
// `_clearRecentForTests()` drops only the in-process recent-writes overlay.
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

// JSON blobs are immutable now, so the edge TTL no longer matters for correctness; it is
// still set to the SDK's documented floor of one minute (node_modules/@vercel/blob
// create-folder-*.d.ts: "The minimum is 1 minute") rather than the one-month default.
const JSON_CACHE_MAX_AGE_S = 60;

// How many ids are fetched at once when listing (two files each).
const FETCH_CONCURRENCY = 20;

// ---- module-scope state (per process / per serverless instance) ----
let injectedClient = null;
let blobBase = process.env.BLOB_BASE_URL ? process.env.BLOB_BASE_URL.replace(/\/+$/, '') : null;
let seedCache = null; // records array of the immutable seed once fetched
let seedPromise = null; // single-flight: seed exists (or has been written) + migration ran
let seedFailedAt = 0; // last time the seed check threw; retried only after SEED_RETRY_MS
let seedLastError = null;
const SEED_RETRY_MS = 1000;
// Records written by this process (merged record incl. ticket), newest write per id. Only
// there so the office list on the same instance shows a brand-new record before list()
// catches up; by-id reads are correct without it. See mergeRecent().
const recent = new Map(); // id -> record
const RECENT_MAX = 500;
function remember(record) {
  recent.delete(record.id);
  recent.set(record.id, record);
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value);
}

export function _clearRecentForTests() {
  recent.clear();
}

// Thrown by putTicket when the record already carries a ticket at the origin (the ticket
// file already exists). The handler maps it to 409.
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
  const { put, list } = await import('@vercel/blob');
  return { put, list, fetch: globalThis.fetch };
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

function ticketKey(id) {
  return `${RECORDS_PREFIX}${id}.ticket.json`;
}

// collected/records/<id>.json -> { id, kind: 'record' }; <id>.ticket.json -> kind 'ticket'.
function parseRecordsKey(pathname) {
  const m = pathname.match(/^collected\/records\/([^/]+?)(\.ticket)?\.json$/);
  return m ? { id: m[1], kind: m[2] ? 'ticket' : 'record' } : null;
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

// GET a JSON blob: parsed body, null on 404, throws on anything else. No cache-busting:
// the edge ignores query strings, and every file read here is immutable anyway.
async function fetchJson(url) {
  const { fetch: doFetch } = await blobClient();
  const res = await doFetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`blob fetch ${res.status} for ${url}`);
  return await res.json();
}

// Every JSON put is write-once. Throws the SDK's already-exists error if the key is taken.
async function putJson(key, obj) {
  const { put } = await blobClient();
  const result = await put(key, JSON.stringify(obj), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json',
    cacheControlMaxAge: JSON_CACHE_MAX_AGE_S,
  });
  rememberBase(result.url);
  return result;
}

// Record + ticket for one id by deterministic URL, both in flight at once. Returns
// { record, ticket } where either may be null. An embedded `ticket` on the record file
// (round-3 layout) is the fallback when no ticket file exists.
async function fetchPair(id, seedRow) {
  const [record, ticket] = await Promise.all([
    fetchJson(`${blobBase}/${recordKey(id)}`),
    fetchJson(`${blobBase}/${ticketKey(id)}`),
  ]);
  const base = record || seedRow || null;
  if (!base) return null;
  return { ...base, ticket: ticket || base.ticket || null };
}

// Run `fn(item)` over items with bounded parallelism, collecting non-null results.
async function mapLimited(items, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const r = await fn(items[i++]);
      if (r) out.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, worker));
  return out;
}

// Between two copies of the same id the one with a ticket is newer (attach is the only
// change a record ever sees); otherwise the stored copy wins.
function mergeRecent(stored, mine) {
  if (!stored) return mine;
  if (mine && mine.ticket && !stored.ticket) return { ...stored, ticket: mine.ticket };
  return stored;
}

// The seed is immutable, so one fetch per process is enough. Only called once the seed is
// known to exist (blobEnsureSeeded ran, or is running and calling this from the migration).
async function loadSeed() {
  if (seedCache) return seedCache;
  const seed = await fetchJson(`${blobBase}/${SEED_KEY}`);
  if (!seed || !Array.isArray(seed.records)) throw new Error('seed blob missing or malformed');
  seedCache = seed.records;
  return seedCache;
}

async function blobSeedRecords() {
  await blobEnsureSeeded();
  return loadSeed();
}

async function blobListRecords() {
  const seed = await blobSeedRecords();
  const seedById = new Map(seed.map((r) => [r.id, r]));
  const ids = new Set();
  for (const b of await listAll(RECORDS_PREFIX)) {
    const k = parseRecordsKey(b.pathname);
    if (k) ids.add(k.id);
  }
  const fetched = await mapLimited(Array.from(ids), (id) => fetchPair(id, seedById.get(id)));
  const byId = new Map(seed.map((r) => [r.id, r]));
  for (const r of fetched) byId.set(r.id, r);
  for (const [id, mine] of recent) byId.set(id, mergeRecent(byId.get(id) || null, mine));
  return Array.from(byId.values()).sort(byNewest);
}

async function blobGetRecord(id) {
  await blobEnsureSeeded();
  if (!blobBase) {
    // Base not learned yet (fresh instance, no BLOB_BASE_URL, list gave nothing): one
    // listing for this id teaches it, then the direct URLs are used from here on.
    await listAll(recordKey(id));
    if (!blobBase) return recent.get(id) || null;
  }
  const seed = await loadSeed();
  const stored = await fetchPair(id, seed.find((r) => r.id === id));
  return mergeRecent(stored, recent.get(id) || null);
}

// Create never overwrites: photo and record are both put write-once. "Already exists" on
// either means another instance took this id in the same second; the id is regenerated and
// both puts retried, up to ID_TRIES.
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
      await putJson(recordKey(record.id), record);
      remember(record);
      return record;
    } catch (err) {
      if (!isAlreadyExists(err) || attempt >= ID_TRIES) throw err;
      record.id = freshId(record);
      record.photoUrl = null;
    }
  }
}

// The ticket photo gets a random suffix (the ticket carries the absolute URL), so an
// orphaned tickets/<id>.jpg from the old design never blocks a real attach. The ticket
// file <id>.ticket.json is the guard: write-once, so the second of two racing attaches gets
// "already exists" -> TICKET_CONFLICT -> 409. The record file is never touched.
async function blobPutTicket(id, fields, jpegBuffer) {
  const { put } = await blobClient();
  const current = await blobGetRecord(id);
  if (!current) return null;
  if (current.ticket) throw conflict();

  const { url } = await put(`collected/tickets/${id}.jpg`, jpegBuffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'image/jpeg',
  });
  rememberBase(url);
  const ticket = { photoUrl: url, ...fields };
  try {
    await putJson(ticketKey(id), ticket);
  } catch (err) {
    if (isAlreadyExists(err)) throw conflict();
    throw err;
  }
  const record = { ...current, ticket };
  remember(record);
  return record;
}

// Seed is written only when list() shows no seed blob AND a direct fetch of its
// deterministic URL 404s. Either check erroring (network, 5xx) throws straight out: the
// API answers 503 and nothing is written. A lost race with another instance (put says the
// blob already exists) counts as "seed exists". Then the migrations run.
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
        const seed = await fetchJson(`${blobBase}/${SEED_KEY}`);
        if (seed && Array.isArray(seed.records)) {
          seedCache = seed.records;
          exists = true;
        }
      }
      if (!exists) {
        const records = generateSeedRecords(generateSchedule(), Date.now());
        try {
          await putJson(SEED_KEY, { seedVersion: SEED_VERSION, records });
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

// One-time migrations, once per instance, both write-once and idempotent:
// Round 3: the newest readable collected/index-<ts>.json is read and every row in it that
// is not a seed row is copied to its own records/ blob; then every capture photo with no
// record anywhere gets a minimal recovered record. Index files are left alone (the
// architect deletes them after checking counts).
// Round 4: every records/<id>.json that still embeds a `ticket` (round-3 layout) gets a
// <id>.ticket.json with that ticket; the record file stays as is.
async function blobMigrate() {
  const indexes = await listAll(INDEX_PREFIX);
  const photos = await listAll(PHOTOS_PREFIX);
  const seed = await loadSeed();
  const seedIds = new Set(seed.map((r) => r.id));
  // ids that already have their own record file / ticket file; nothing below overwrites one.
  const stored = new Set();
  const ticketed = new Set();
  const recordBlobs = [];
  for (const b of await listAll(RECORDS_PREFIX)) {
    const k = parseRecordsKey(b.pathname);
    if (!k) continue;
    if (k.kind === 'ticket') ticketed.add(k.id);
    else {
      stored.add(k.id);
      recordBlobs.push({ id: k.id, url: b.url });
    }
  }

  async function copyIfAbsent(record) {
    if (stored.has(record.id)) return;
    if (blobBase && (await fetchJson(`${blobBase}/${recordKey(record.id)}`))) {
      stored.add(record.id);
      return;
    }
    try {
      await putJson(recordKey(record.id), record);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
    stored.add(record.id);
  }

  if (indexes.length > 0) {
    // Newest index first. A listed index that 404s (list() lagging behind a delete, the very
    // pattern that lost the round-2 records) is not an error: fall through to the next one,
    // and to nothing if none is readable. A 5xx still throws.
    let index = null;
    for (const b of indexes.slice().sort((a, c) => extractTs(c.pathname) - extractTs(a.pathname))) {
      index = normalizeIndex(await fetchJson(b.url));
      if (index) break;
    }
    for (const r of index ? index.records : []) {
      if (!r.id) continue;
      // Same predicate as the local migration: only an explicit seed: true is discarded,
      // with one exception. Under the old design a seed record that got a real ticket kept
      // that ticket in the index only; it is copied as an override (seed: true kept). A
      // seed-generated ticket (photoUrl under /api/ticket/) is not real and is not copied.
      if (r.seed === true && !hasRealTicket(r)) continue;
      const copy = backfill(r);
      const wasStored = stored.has(copy.id);
      await copyIfAbsent(copy);
      // Round 4 for a row copied just now: its ticket lives in the ticket file from now on.
      // (A row that already had a record file is in recordBlobs from the listing.)
      if (!wasStored && copy.ticket) recordBlobs.push({ id: copy.id, embedded: copy.ticket });
    }
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

  // Round 4: split embedded tickets out of record files that have no ticket file yet. Each
  // record file without a sibling ticket file is read once per cold start; that is the
  // price of not keeping a marker blob.
  await mapLimited(recordBlobs.filter((b) => !ticketed.has(b.id)), async (b) => {
    const ticket = b.embedded || ((await fetchJson(b.url)) || {}).ticket;
    if (!ticket) return null;
    try {
      await putJson(ticketKey(b.id), ticket);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
    ticketed.add(b.id);
    return null;
  });
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
