// Storage: local filesystem by default, Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateSchedule, generateSeedRecords } from './seedgen.js';

const DATA_DIR = process.env.COLLECTED_DATA_DIR || path.join(process.cwd(), '.data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

function useBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
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
  await fs.writeFile(INDEX_FILE, JSON.stringify(records));
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
  await put(key, JSON.stringify(records), {
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

// ---- public interface ----
export async function listRecords() {
  const records = useBlob() ? await readBlobIndex() : await readLocalIndex();
  return records || [];
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
export async function ensureSeeded() {
  const existing = useBlob() ? await readBlobIndex() : await readLocalIndex();
  if (existing && existing.length > 0) return existing;

  const schedule = generateSchedule();
  const records = generateSeedRecords(schedule, Date.now());

  if (useBlob()) await writeBlobIndex(records);
  else await writeLocalIndex(records);

  return records;
}
