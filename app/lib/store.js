// Storage: local filesystem by default, Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateSchedule, generateSeedRecords } from './seedgen.js';

const DATA_DIR = process.env.COLLECTED_DATA_DIR || path.join(process.cwd(), '.data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const TICKETS_DIR = path.join(DATA_DIR, 'tickets');

// The seed shape bumped when tickets were added (records gained `pricing`/`ticket`). An
// index written before that stamp is missing seedVersion entirely, which is how a stale
// index is told apart from a current one.
const SEED_VERSION = 2;

function useBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// Older on-disk/blob indexes were a bare array with no seedVersion at all. Normalize both
// shapes to { seedVersion, records } so every caller below has one thing to read.
function normalizeIndex(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { seedVersion: undefined, records: raw };
  return { seedVersion: raw.seedVersion, records: Array.isArray(raw.records) ? raw.records : [] };
}

// ---- local backend ----
async function readLocalIndex() {
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeLocalIndex(records) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify({ seedVersion: SEED_VERSION, records }));
}

// ---- blob backend ----
function extractTs(pathname) {
  const m = pathname.match(/index-(\d+)\.json$/);
  return m ? Number(m[1]) : 0;
}

async function readBlobIndex() {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: 'collected/index-' });
  if (!blobs || blobs.length === 0) return null;
  const sorted = blobs.slice().sort((a, b) => extractTs(b.pathname) - extractTs(a.pathname));
  const latest = sorted[0];
  const res = await fetch(latest.url);
  if (!res.ok) return null;
  return await res.json();
}

async function writeBlobIndex(records) {
  const { put, list, del } = await import('@vercel/blob');
  const key = `collected/index-${Date.now()}.json`;
  await put(key, JSON.stringify({ seedVersion: SEED_VERSION, records }), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
  // Lazy cleanup: keep the newest 3 index versions, best-effort.
  try {
    const { blobs } = await list({ prefix: 'collected/index-' });
    const sorted = blobs.slice().sort((a, b) => extractTs(b.pathname) - extractTs(a.pathname));
    const stale = sorted.slice(3);
    await Promise.all(stale.map((b) => del(b.url)));
  } catch {
    // best-effort; a stray old index blob is harmless
  }
}

async function readIndex() {
  return normalizeIndex(useBlob() ? await readBlobIndex() : await readLocalIndex());
}

// ---- public interface ----
export async function listRecords() {
  const index = await readIndex();
  return index ? index.records : [];
}

export async function getRecord(id) {
  const records = await listRecords();
  return records.find((r) => r.id === id) || null;
}

// photoJpegBuffer is null for records that already carry a photoUrl (seed records never
// call this with a buffer; real captures always do — validated in the API handler).
export async function putRecord(record, photoJpegBuffer) {
  const records = await listRecords();

  if (photoJpegBuffer) {
    if (useBlob()) {
      const { put } = await import('@vercel/blob');
      const { url } = await put(`collected/photos/${record.id}.jpg`, photoJpegBuffer, {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'image/jpeg',
      });
      record.photoUrl = url;
    } else {
      await fs.mkdir(PHOTOS_DIR, { recursive: true });
      await fs.writeFile(path.join(PHOTOS_DIR, `${record.id}.jpg`), photoJpegBuffer);
      record.photoUrl = `/api/photo/${record.id}.jpg`;
    }
  }

  records.push(record);
  records.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

  if (useBlob()) await writeBlobIndex(records);
  else await writeLocalIndex(records);

  return record;
}

// NOTE: a single-writer race is possible if two requests call ensureSeeded() concurrently
// before either has written an index (both would generate and write). Acceptable for a
// take-home; see report.
//
// An index at the current seedVersion is left alone. Anything else (missing entirely, or
// stamped with an older/no seedVersion) is regenerated — but any non-seed record already in
// it (a real capture, `seed: false`) survives the regeneration; only the seed rows are
// replaced.
export async function ensureSeeded() {
  const existing = await readIndex();
  if (existing && existing.seedVersion === SEED_VERSION && existing.records.length > 0) {
    return existing.records;
  }

  const schedule = generateSchedule();
  const seeded = generateSeedRecords(schedule, Date.now());
  const kept = existing ? existing.records.filter((r) => r.seed === false) : [];
  const merged = seeded.concat(kept).sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

  if (useBlob()) await writeBlobIndex(merged);
  else await writeLocalIndex(merged);

  return merged;
}

// Attaches a scale ticket to an existing record: stores the ticket photo (Blob when
// configured, local `.data/tickets/<id>.jpg` otherwise) and writes `record.ticket`. Callers
// (the API handler) are expected to have already checked the record exists and has no
// ticket yet; this returns null if the id vanished between that check and this call.
export async function putTicket(id, fields, jpegBuffer) {
  const index = await readIndex();
  const records = index ? index.records : [];
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return null;

  let photoUrl;
  if (useBlob()) {
    const { put } = await import('@vercel/blob');
    const { url } = await put(`collected/tickets/${id}.jpg`, jpegBuffer, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'image/jpeg',
    });
    photoUrl = url;
  } else {
    await fs.mkdir(TICKETS_DIR, { recursive: true });
    await fs.writeFile(path.join(TICKETS_DIR, `${id}.jpg`), jpegBuffer);
    photoUrl = `/api/ticket/${id}.jpg`;
  }

  const record = { ...records[idx], ticket: { photoUrl, ...fields } };
  records[idx] = record;

  if (useBlob()) await writeBlobIndex(records);
  else await writeLocalIndex(records);

  return record;
}
