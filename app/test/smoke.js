// Smoke test: starts dev.js on a free port against a throwaway data dir, then exercises
// the API surface end to end. Exits non-zero on first failure.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, '..');

// Tiny valid 1x1 JPEG.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok - ${msg}`);
  } else {
    failures += 1;
    console.log(`  FAIL - ${msg}`);
  }
}

async function getFreePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(base, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${base}/api/records`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start in time');
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collected-smoke-'));
  const port = await getFreePort();
  const base = `http://localhost:${port}`;

  console.log(`Starting dev server on ${port}, data dir ${dataDir}`);
  const child = spawn(process.execPath, ['dev.js'], {
    cwd: APP_DIR,
    env: { ...process.env, PORT: String(port), COLLECTED_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  child.stdout.on('data', (d) => (serverOutput += d.toString()));
  child.stderr.on('data', (d) => (serverOutput += d.toString()));

  try {
    await waitForServer(base);

    // 1. GET /api/records: seeded, >=100 records, includes pinned 1428 Mission Rd record
    const listRes = await fetch(`${base}/api/records`);
    ok(listRes.status === 200, 'GET /api/records returns 200');
    const listData = await listRes.json();
    ok(Array.isArray(listData.records), 'GET /api/records returns a records array');
    ok(listData.records.length >= 100, `GET /api/records has >=100 seeded records (got ${listData.records.length})`);

    const pinned = listData.records.find(
      (r) => r.address.startsWith('1428 Mission') && r.capturedAt.startsWith('2026-08-12') && r.status === 'collected'
    );
    ok(!!pinned, 'seeded data includes a collected record at 1428 Mission on 2026-08-12');

    // 2. POST a record with a tiny valid JPEG
    const postBody = {
      address: '999 Test St, Los Angeles, CA 90001',
      container: 'CT-96-2210',
      status: 'collected',
      reason: null,
      note: 'smoke test record',
      capturedAt: new Date().toISOString(),
      gps: { lat: 34.05, lon: -118.25, accuracyM: 10 },
      captureMs: 5400,
      photo: TINY_JPEG_B64,
    };
    const postRes = await fetch(`${base}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody),
    });
    ok(postRes.status === 201, `POST /api/records returns 201 (got ${postRes.status})`);
    const postData = await postRes.json();
    ok(!!postData.id, 'POST /api/records returns an id');
    ok(postData.url === `/p/${postData.id}`, 'POST /api/records returns matching proof url');

    // 3. GET that id -> matches
    const getRes = await fetch(`${base}/api/records/${postData.id}`);
    ok(getRes.status === 200, 'GET /api/records/:id returns 200 for the new record');
    const getData = await getRes.json();
    ok(getData.id === postData.id, 'GET /api/records/:id returns the same id');
    ok(getData.address === postBody.address, 'GET /api/records/:id has the posted address');
    ok(!!getData.photoUrl, 'GET /api/records/:id has a photoUrl');

    // 4. GET /api/records lists it first (newest first)
    const listRes2 = await fetch(`${base}/api/records`);
    const listData2 = await listRes2.json();
    ok(listData2.records[0].id === postData.id, 'new record is first in /api/records (newest first)');

    // 5. GET /api/records/nope -> 404
    const notFoundRes = await fetch(`${base}/api/records/nope`);
    ok(notFoundRes.status === 404, 'GET /api/records/nope returns 404');

    // 6. GET /api/photo/<seed id>.svg -> 200 image/svg+xml
    const seedRecord = listData.records.find((r) => r.seed);
    ok(!!seedRecord, 'found a seed record to test photo rendering');
    if (seedRecord) {
      const photoRes = await fetch(`${base}/api/photo/${seedRecord.id}.svg`);
      ok(photoRes.status === 200, `GET /api/photo/${seedRecord.id}.svg returns 200`);
      ok(
        (photoRes.headers.get('content-type') || '').includes('image/svg+xml'),
        'seed photo response has image/svg+xml content-type'
      );
    }

    // 7. POST with no photo -> 400
    const badPostRes = await fetch(`${base}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...postBody, photo: undefined }),
    });
    ok(badPostRes.status === 400, `POST without photo returns 400 (got ${badPostRes.status})`);
  } finally {
    child.kill();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    console.log('--- server output ---');
    console.log(serverOutput);
    process.exit(1);
  } else {
    console.log('All checks passed.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
