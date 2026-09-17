// Smoke test: starts dev.js on a free port against a throwaway data dir, then exercises
// the API surface end to end. Exits non-zero on first failure.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overage } from '../lib/overage.js';

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

function postRecord(base, n) {
  return fetch(`${base}/api/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: `${n} Parallel Way, Columbus, OH 43215`,
      container: `RO-30-${n}`,
      status: 'collected',
      capturedAt: new Date(Date.now() - n * 1000).toISOString(),
      captureMs: 4000 + n,
      photo: TINY_JPEG_B64,
    }),
  });
}

function postTicket(base, id, netLb) {
  return fetch(`${base}/api/records/${id}/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo: TINY_JPEG_B64, netLb, facility: 'Parallel Transfer', weighedAt: new Date().toISOString() }),
  });
}

// Round 3: the production index was rewritten from seed under two devices writing seconds
// apart. Six creates at once, then six ticket attaches at once on six different records;
// every one of the twelve writes must be visible afterwards, and each record must be
// readable by id the moment its POST returns. Runs against both backends (`label`).
async function testConcurrency(base, label) {
  const postResults = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => postRecord(base, n)));
  ok(postResults.every((r) => r.status === 201), `${label}: 6 parallel POST /api/records all return 201 (got ${postResults.map((r) => r.status).join(',')})`);
  const created = await Promise.all(postResults.map((r) => r.json()));
  const ids = created.map((c) => c.id);
  ok(new Set(ids).size === 6, `${label}: 6 parallel creates got 6 distinct ids`);

  const byId = await Promise.all(ids.map((id) => fetch(`${base}/api/records/${id}`)));
  ok(byId.every((r) => r.status === 200), `${label}: every record is readable by id immediately after create (got ${byId.map((r) => r.status).join(',')})`);
  const byIdData = await Promise.all(byId.map((r) => r.json()));
  ok(byIdData.every((r, i) => r.id === ids[i] && r.ticket === null), `${label}: read-by-id after create returns the record with ticket null`);

  const ticketResults = await Promise.all(ids.map((id, i) => postTicket(base, id, 3000 + i)));
  ok(ticketResults.every((r) => r.status === 200), `${label}: 6 parallel ticket POSTs on 6 records all return 200 (got ${ticketResults.map((r) => r.status).join(',')})`);

  const listRes = await fetch(`${base}/api/records`);
  const listData = await listRes.json();
  const found = ids.map((id) => listData.records.find((r) => r.id === id));
  ok(found.every(Boolean), `${label}: all 6 created records are present in the list`);
  ok(found.every((r) => r && r.ticket && typeof r.ticket.netLb === 'number'), `${label}: all 6 tickets are present in the list (12 of 12 writes survived)`);
  ok(new Set(listData.records.map((r) => r.id)).size === listData.records.length, `${label}: list has no duplicate ids`);
  return ids;
}

// Round-1 checker findings 1+2: a legacy (pre-ticket-feature) index is a bare shape with no
// `pricing`/`ticket` on real records, and some real records may predate the `seed` flag
// entirely. Spins up its own dev.js against a data dir seeded with a hand-written legacy
// index, then asserts the migration in lib/store.js's ensureSeeded() keeps every real
// record (flagged `seed:false` or missing the flag altogether), backfills each with
// `pricing`/`ticket`, purges the one `seed:true` row, and still produces the pinned demo
// record.
async function testMigration() {
  const migDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collected-migration-'));
  const legacyIndex = {
    seedVersion: 1, // pre-ticket-feature stamp: must trigger regeneration
    records: [
      {
        id: '999901-aaaa',
        address: '1 Legacy Seed Rd, Columbus, OH 43215',
        container: 'CT-96-1',
        status: 'collected',
        reason: null,
        note: null,
        capturedAt: '2026-01-01T12:00:00.000Z',
        receivedAt: '2026-01-01T12:00:00.000Z',
        gps: null,
        photoUrl: '/api/photo/999901-aaaa.svg',
        captureMs: 6000,
        seed: true, // must be purged on migration
      },
      {
        id: '999902-bbbb',
        address: '2 Real Capture Rd, Columbus, OH 43215',
        container: 'CT-96-2',
        status: 'collected',
        reason: null,
        note: null,
        capturedAt: '2026-01-02T12:00:00.000Z',
        receivedAt: '2026-01-02T12:00:00.000Z',
        gps: null,
        photoUrl: '/api/photo/999902-bbbb.jpg',
        captureMs: 5500,
        seed: false, // real record, pre-ticket-feature: no pricing/ticket keys yet
      },
      {
        id: '999903-cccc',
        address: '3 Legacy Real Rd, Columbus, OH 43215',
        container: 'CT-96-3',
        status: 'collected',
        reason: null,
        note: null,
        capturedAt: '2026-01-03T12:00:00.000Z',
        receivedAt: '2026-01-03T12:00:00.000Z',
        gps: null,
        photoUrl: '/api/photo/999903-cccc.jpg',
        captureMs: 5200,
        // no `seed` key at all: an even older real record, predating the flag itself
      },
    ],
  };
  await fs.writeFile(path.join(migDir, 'index.json'), JSON.stringify(legacyIndex));

  const port = await getFreePort();
  const base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['dev.js'], {
    cwd: APP_DIR,
    env: { ...process.env, PORT: String(port), COLLECTED_DATA_DIR: migDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout.on('data', (d) => (serverOutput += d.toString()));
  child.stderr.on('data', (d) => (serverOutput += d.toString()));

  try {
    await waitForServer(base);

    const listRes = await fetch(`${base}/api/records`);
    const listData = await listRes.json();

    const purgedSeed = listData.records.find((r) => r.id === '999901-aaaa');
    ok(!purgedSeed, 'migration: pre-migration seed:true row is purged, not kept');

    const realNoFields = listData.records.find((r) => r.id === '999902-bbbb');
    ok(!!realNoFields, 'migration: real record with seed:false survives migration');
    ok(
      !!realNoFields && realNoFields.pricing && realNoFields.pricing.includedLb === 2000 && realNoFields.pricing.ratePerTon === 95,
      'migration: real record with seed:false is backfilled with pricing {includedLb:2000, ratePerTon:95}'
    );
    ok(!!realNoFields && realNoFields.ticket === null, 'migration: real record with seed:false is backfilled with ticket: null');

    const realNoFlag = listData.records.find((r) => r.id === '999903-cccc');
    ok(!!realNoFlag, 'migration: real record with no seed key at all survives migration (predicate is r.seed !== true)');
    ok(
      !!realNoFlag && realNoFlag.pricing && realNoFlag.pricing.includedLb === 2000 && realNoFlag.pricing.ratePerTon === 95,
      'migration: real record with no seed key is backfilled with pricing {includedLb:2000, ratePerTon:95}'
    );
    ok(!!realNoFlag && realNoFlag.ticket === null, 'migration: real record with no seed key is backfilled with ticket: null');

    const pinnedAfterMigration = listData.records.find((r) => r.id === '260812-nycx');
    ok(!!pinnedAfterMigration, 'migration: pinned record 260812-nycx exists after seed regeneration');
  } catch (err) {
    failures += 1;
    console.log(`  FAIL - migration test crashed: ${err && err.message}`);
    console.log('--- migration server output ---');
    console.log(serverOutput);
  } finally {
    child.kill();
    await fs.rm(migDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Blob code path, against the in-memory fake in test/fake-blob.js ----
// dev.js is imported into this process once (it listens on PORT at import) so the client
// injected into lib/store.js is the one the handlers use. Re-injecting a fake clears the
// store's per-instance caches, which is how a cold start on a second instance is imitated
// below (`coldStart`). What the fake does not model is listed at the top of fake-blob.js.
async function testBlobBackend() {
  const store = await import('../lib/store.js');
  const { createFakeBlob } = await import('./fake-blob.js');
  const port = await getFreePort();
  const base = `http://localhost:${port}`;
  process.env.PORT = String(port);
  await import('../dev.js');

  const SEED_KEY = 'collected/seed-v2.json';
  const seedPuts = (fake) => fake.puts.filter((p) => p.pathname === SEED_KEY);
  const coldStart = (fake) => store._setBlobClientForTests(fake);

  try {
    // A. fresh store: seed written exactly once, then the concurrency test, then a ticket on
    //    a seed record. pageSize 4 makes the records/ listing paginate.
    {
      const fake = createFakeBlob({ pageSize: 4 });
      coldStart(fake);
      await waitForServer(base);
      const first = await fetch(`${base}/api/records`);
      ok(first.status === 200, `blob: first GET /api/records on an empty store returns 200 (got ${first.status})`);
      const firstData = await first.json();
      ok(firstData.records.length >= 100, `blob: empty store is seeded (${firstData.records.length} records)`);
      ok(fake.keys().length === 1 && fake.keys()[0] === SEED_KEY, `blob: the only blob after seeding is ${SEED_KEY} (got ${fake.keys().join(',')})`);
      ok(seedPuts(fake).length === 1 && seedPuts(fake)[0].options.allowOverwrite === false, 'blob: seed is written once, with allowOverwrite: false');
      ok(seedPuts(fake)[0].options.cacheControlMaxAge === 60, `blob: seed put sets cacheControlMaxAge 60 (got ${seedPuts(fake)[0].options.cacheControlMaxAge})`);
      await fetch(`${base}/api/records`);
      ok(seedPuts(fake).length === 1, 'blob: second GET does not rewrite the seed');
      coldStart(fake);
      await fetch(`${base}/api/records`);
      ok(seedPuts(fake).length === 1, 'blob: a cold start on a store with a seed does not rewrite it');

      const ids = await testConcurrency(base, 'blob');
      ok(fake.keys('collected/records/').length === 6, `blob: six records/ blobs after six creates+tickets (got ${fake.keys('collected/records/').length})`);
      ok(fake.keys('collected/photos/').length === 6 && fake.keys('collected/tickets/').length === 6, 'blob: six photo blobs and six ticket blobs');
      ok(fake.keys('collected/index-').length === 0, 'blob: no index-*.json is ever written');
      const recPuts = fake.puts.filter((p) => p.pathname.startsWith('collected/records/'));
      ok(recPuts.every((p) => p.options.addRandomSuffix === false && p.options.cacheControlMaxAge === 60), 'blob: every records/ put uses addRandomSuffix:false and cacheControlMaxAge 60');
      ok(recPuts.length === 12, `blob: 12 records/ puts for 6 creates + 6 tickets (got ${recPuts.length})`);
      const createPuts = recPuts.filter((p) => p.options.ifMatch === undefined);
      const ticketPuts = recPuts.filter((p) => p.options.ifMatch !== undefined);
      ok(createPuts.length === 6 && createPuts.every((p) => p.options.allowOverwrite === false), 'blob: the 6 create puts use allowOverwrite:false (a duplicate id can never overwrite a record)');
      ok(ticketPuts.length === 6 && ticketPuts.every((p) => typeof p.options.ifMatch === 'string' && p.options.ifMatch.length > 0), 'blob: the 6 ticket puts are guarded with ifMatch: <etag read>');
      ok(fake.keys('collected/tickets/').every((k) => /^collected\/tickets\/[^/]+-[a-z0-9]+\.jpg$/.test(k)), 'blob: ticket JPEGs are stored with a random suffix');
      ok(ids.every((id) => /\/collected\/tickets\/.+-[a-z0-9]+\.jpg$/.test(fake.readJson(`collected/records/${id}.json`).ticket.photoUrl)), 'blob: each record carries the absolute suffixed ticket URL');

      // Read-by-id from a cold instance: nothing in memory, so this is the deterministic-URL fetch.
      coldStart(fake);
      const coldRead = await fetch(`${base}/api/records/${ids[0]}`);
      const coldData = await coldRead.json();
      ok(coldRead.status === 200 && coldData.ticket && coldData.ticket.netLb === 3000, `blob: cold instance reads a ticketed record by its deterministic URL (got ${coldRead.status})`);
      ok(fake.puts.length === 25, `blob: the cold read wrote nothing (1 seed + 6 photos + 6 tickets + 12 records = 25 puts, got ${fake.puts.length})`);

      // A ticket on a seed record: the seed blob is untouched; the record gets its own
      // records/ override with seed: true kept, and the list shows it once, with the ticket.
      const seedRec = firstData.records.find((r) => r.seed === true && r.status === 'collected' && !r.ticket);
      const seedTicket = await postTicket(base, seedRec.id, 4100);
      ok(seedTicket.status === 200, `blob: ticket on a seed record returns 200 (got ${seedTicket.status})`);
      const override = fake.readJson(`collected/records/${seedRec.id}.json`);
      ok(!!override && override.seed === true && override.ticket && override.ticket.netLb === 4100, 'blob: seed record with a ticket gets records/<id>.json with seed:true kept and the ticket');
      const overridePut = fake.puts.find((p) => p.pathname === `collected/records/${seedRec.id}.json`);
      ok(overridePut && overridePut.options.allowOverwrite === false && overridePut.options.ifMatch === undefined, "blob: a seed record's first override is put with allowOverwrite:false (no ETag exists yet)");
      ok(seedPuts(fake).length === 1, 'blob: attaching a ticket to a seed record does not rewrite the seed');
      coldStart(fake);
      const afterList = await (await fetch(`${base}/api/records`)).json();
      const seedRows = afterList.records.filter((r) => r.id === seedRec.id);
      ok(seedRows.length === 1 && seedRows[0].ticket && seedRows[0].ticket.netLb === 4100, 'blob: cold list shows the ticketed seed record exactly once, override winning over the seed row');
      const second = await postTicket(base, seedRec.id, 4200);
      ok(second.status === 409, `blob: second ticket on the same record from a cold instance returns 409 (got ${second.status})`);
      const unknown = await fetch(`${base}/api/records/nope`);
      ok(unknown.status === 404, `blob: GET /api/records/nope returns 404 (got ${unknown.status})`);

      // ETag race (finding 2a): freeze what fetch() serves for a record at its pre-ticket
      // version. Attach #1 reads ETag e1, puts with ifMatch e1: ok. A cold instance then
      // reads the same stale copy (no ticket, e1) so the handler's pre-check passes, but its
      // put with ifMatch e1 hits the origin's e2 and is refused: 409, first ticket kept.
      const raceRes = await postRecord(base, 41);
      const race = await raceRes.json();
      const raceKey = `collected/records/${race.id}.json`;
      const e1 = fake.etagOf(raceKey);
      fake.freezeFetch(raceKey);
      const t1 = await postTicket(base, race.id, 7100);
      ok(t1.status === 200, `blob race: first ticket attach returns 200 (got ${t1.status})`);
      const e2 = fake.etagOf(raceKey);
      ok(e1 && e2 && e1 !== e2, 'blob race: the ticket put produced a new ETag at the origin');
      coldStart(fake);
      const stale = await (await fetch(`${base}/api/records/${race.id}`)).json();
      ok(stale.ticket === null, 'blob race: a cold instance reads the stale pre-ticket copy (frozen fetch)');
      const t2 = await postTicket(base, race.id, 7200);
      ok(t2.status === 409, `blob race: second attach with the stale ETag returns 409 (got ${t2.status})`);
      ok((await t2.json()).error === 'ticket already recorded for this record', 'blob race: 409 body is the existing specific text');
      const refusedRace = fake.puts.filter((p) => p.pathname === raceKey && p.ok === false);
      ok(refusedRace.length === 1 && refusedRace[0].options.ifMatch === e1, 'blob race: exactly one put was refused, and it carried the stale ETag');
      fake.unfreezeFetch(raceKey);
      const kept = fake.readJson(raceKey);
      ok(kept.ticket && kept.ticket.netLb === 7100 && fake.etagOf(raceKey) === e2, 'blob race: record keeps the first ticket and its ETag');

      // Same race on a seed record: the override exists at the origin but a stale edge
      // hides it, so the cold instance sees the seed row and puts with allowOverwrite:false.
      const seedRec2 = firstData.records.find((r) => r.seed === true && r.status === 'collected' && !r.ticket && r.id !== seedRec.id);
      const s1 = await postTicket(base, seedRec2.id, 4300);
      ok(s1.status === 200, `blob race (seed): first attach on a seed record returns 200 (got ${s1.status})`);
      fake.hiddenFromFetch.add(`collected/records/${seedRec2.id}.json`);
      coldStart(fake);
      const s2 = await postTicket(base, seedRec2.id, 4400);
      ok(s2.status === 409, `blob race (seed): attach on a seed record whose override is hidden by a stale edge returns 409 (got ${s2.status})`);
      fake.hiddenFromFetch.delete(`collected/records/${seedRec2.id}.json`);
      ok(fake.readJson(`collected/records/${seedRec2.id}.json`).ticket.netLb === 4300, 'blob race (seed): the first ticket is kept');

      // Duplicate id on create (finding 4): pin Math.random so the first generated suffix
      // is '2222' and pre-seed that id. The photo put collides, the id is regenerated, and
      // the pre-existing record is untouched. The fake counts calls so the stub is exact.
      const capturedAt = '2026-09-17T18:00:00.000Z';
      const dupId = '260917-2222';
      const original = { id: dupId, address: 'Already here', status: 'collected', capturedAt, photoUrl: `${fake.base}/collected/photos/${dupId}.jpg`, seed: false };
      fake.seed(`collected/records/${dupId}.json`, original);
      fake.seed(`collected/photos/${dupId}.jpg`, Buffer.from(TINY_JPEG_B64, 'base64'), { contentType: 'image/jpeg' });
      const realRandom = Math.random;
      let zeros = 4;
      Math.random = () => (zeros-- > 0 ? 0 : realRandom());
      let dupRes;
      try {
        dupRes = await fetch(`${base}/api/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: '8 Collision Ct', status: 'collected', capturedAt, captureMs: 5000, photo: TINY_JPEG_B64 }),
        });
      } finally {
        Math.random = realRandom;
      }
      const dup = await dupRes.json();
      ok(dupRes.status === 201, `blob dup-id: create whose first id collides returns 201 (got ${dupRes.status})`);
      ok(dup.id !== dupId && dup.id.startsWith('260917-'), `blob dup-id: the record got a regenerated id (${dup.id})`);
      ok(JSON.stringify(fake.readJson(`collected/records/${dupId}.json`)) === JSON.stringify(original), 'blob dup-id: the pre-existing record is untouched');
      ok(fake.puts.some((p) => p.pathname === `collected/photos/${dupId}.jpg` && p.ok === false), 'blob dup-id: the collision was refused at the photo put');
      ok(!!fake.readJson(`collected/records/${dup.id}.json`), 'blob dup-id: the new record exists under the new id');
      // Three collisions in a row give up with a 503 rather than overwriting.
      let zeros3 = 12;
      Math.random = () => (zeros3-- > 0 ? 0 : realRandom());
      let exhaustRes;
      try {
        exhaustRes = await fetch(`${base}/api/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: '9 Collision Ct', status: 'collected', capturedAt, captureMs: 5000, photo: TINY_JPEG_B64 }),
        });
      } finally {
        Math.random = realRandom;
      }
      ok(exhaustRes.status === 503, `blob dup-id: three collisions in a row return 503, never an overwrite (got ${exhaustRes.status})`);
      ok(JSON.stringify(fake.readJson(`collected/records/${dupId}.json`)) === JSON.stringify(original), 'blob dup-id: still untouched after the exhausted retries');
    }

    // B. reseed on error is impossible. B1: list() throws on an empty store. B2: list works
    //    but the seed body cannot be fetched. B3: no seed listed, base known from another
    //    blob, the direct check 5xxs. All three: 503 and not one put.
    {
      const fake = createFakeBlob();
      fake.fail.list = true;
      coldStart(fake);
      const r1 = await fetch(`${base}/api/records`);
      ok(r1.status === 503, `blob B1: GET /api/records with list() failing returns 503 (got ${r1.status})`);
      const r1b = await fetch(`${base}/api/records/260812-nycx`);
      ok(r1b.status === 503, `blob B1: GET /api/records/:id with list() failing returns 503 (got ${r1b.status})`);
      const r1c = await postRecord(base, 9);
      ok(r1c.status === 503, `blob B1: POST /api/records with list() failing returns 503 (got ${r1c.status})`);
      ok(fake.puts.length === 0 && fake.keys().length === 0, 'blob B1: nothing was written while storage was failing');
      const body503 = await r1.json();
      ok(JSON.stringify(Object.keys(body503)) === '["error"]' && body503.error === 'storage unavailable', `blob B1: 503 body carries only { error } (got ${JSON.stringify(body503)})`);
      fake.fail.list = false;
      const r1x = await fetch(`${base}/api/records`);
      ok(r1x.status === 503 && fake.puts.length === 0, `blob B1: inside the 1 s backoff the same error is returned without touching storage (got ${r1x.status})`);
      await new Promise((r) => setTimeout(r, 1100));
      const r1d = await fetch(`${base}/api/records`);
      ok(r1d.status === 200 && seedPuts(fake).length === 1, `blob B1: once list() recovers the next request seeds normally (got ${r1d.status}, seed puts ${seedPuts(fake).length})`);
    }
    {
      const fake = createFakeBlob();
      fake.seed(SEED_KEY, { seedVersion: 2, records: [{ id: 'seed-x', address: 'x', status: 'collected', capturedAt: '2026-09-01T00:00:00.000Z', seed: true }] });
      fake.fail.fetch = true;
      coldStart(fake);
      const r2 = await fetch(`${base}/api/records`);
      ok(r2.status === 503, `blob B2: seed listed but unreadable (fetch 5xx) returns 503 (got ${r2.status})`);
      ok(fake.puts.length === 0, 'blob B2: an unreadable seed is never rewritten');
      fake.fail.fetch = false;
      await new Promise((r) => setTimeout(r, 1100));
      const r2b = await (await fetch(`${base}/api/records`)).json();
      ok(r2b.records.length === 1 && r2b.records[0].id === 'seed-x' && fake.puts.length === 0, 'blob B2: after the fetch recovers the existing seed is served, still with no writes');
    }
    {
      const fake = createFakeBlob();
      fake.seed('collected/photos/only-a-photo.jpg', Buffer.from(TINY_JPEG_B64, 'base64'), { contentType: 'image/jpeg' });
      fake.fail.fetch = true;
      coldStart(fake);
      const r3 = await fetch(`${base}/api/records`);
      ok(r3.status === 503, `blob B3: no seed listed, direct fetch 5xx: returns 503 (got ${r3.status})`);
      ok(fake.puts.length === 0, 'blob B3: a failed direct check never writes a seed');
    }

    // D. BLOB_BASE_URL: list() lags (seed hidden from it) but the direct fetch of the
    //    deterministic URL finds the seed, so no duplicate seed write happens.
    {
      const fake = createFakeBlob();
      fake.seed(SEED_KEY, { seedVersion: 2, records: [{ id: 'seed-y', address: 'y', status: 'collected', capturedAt: '2026-09-01T00:00:00.000Z', seed: true }] });
      fake.hiddenFromList.add(SEED_KEY);
      process.env.BLOB_BASE_URL = fake.base;
      try {
        coldStart(fake);
        const rd = await (await fetch(`${base}/api/records`)).json();
        ok(rd.records.length === 1 && rd.records[0].id === 'seed-y', 'blob D: seed hidden from list() but found by direct URL via BLOB_BASE_URL is served');
        ok(fake.puts.length === 0, 'blob D: the direct-URL check prevents a duplicate seed write when list() lags');
      } finally {
        delete process.env.BLOB_BASE_URL;
      }
    }

    // C. migration off the index-file design, plus orphan photo recovery.
    {
      const fake = createFakeBlob();
      const idxOld = { seedVersion: 2, records: [
        { id: '260910-old1', address: 'Only in the older index', status: 'collected', capturedAt: '2026-09-10T10:00:00.000Z', photoUrl: `${fake.base}/collected/photos/260910-old1.jpg`, seed: false },
      ] };
      const idxNew = { seedVersion: 2, records: [
        { id: '260911-seed', address: 'Seed row in index', status: 'collected', capturedAt: '2026-09-11T10:00:00.000Z', photoUrl: '/api/photo/260911-seed.svg', seed: true },
        { id: '260916-real', address: '5 Real Capture Rd', container: 'RO-30-5', status: 'collected', capturedAt: '2026-09-16T21:00:00.000Z', receivedAt: '2026-09-16T21:00:01.000Z', gps: null, photoUrl: `${fake.base}/collected/photos/260916-real.jpg`, captureMs: 7000, seed: false },
        { id: '260915-nofl', address: '6 Pre-flag Capture Rd', status: 'collected', capturedAt: '2026-09-15T21:00:00.000Z', photoUrl: `${fake.base}/collected/photos/260915-nofl.jpg` },
        // seed row that got a REAL ticket under the old design: copied as an override
        { id: '260812-nycx', address: '1428 Mission College Blvd', status: 'collected', capturedAt: '2026-08-12T15:00:00.000Z', photoUrl: '/api/photo/260812-nycx.svg', seed: true, ticket: { photoUrl: `${fake.base}/collected/tickets/260812-nycx.jpg`, netLb: 6100 } },
        // seed row with a seed-generated svg ticket: not real, not copied
        { id: '260901-sgen', address: 'Seed with generated ticket', status: 'collected', capturedAt: '2026-09-01T15:00:00.000Z', photoUrl: '/api/photo/260901-sgen.svg', seed: true, ticket: { photoUrl: '/api/ticket/260901-sgen.svg', netLb: 2500 } },
      ] };
      fake.seed('collected/index-1758145200000.json', idxOld);
      fake.seed('collected/index-1758146436000.json', idxNew);
      // A newer index that list() still shows but that was deleted (fetch 404): skipped, not fatal.
      fake.seed('collected/index-1758146500000.json', { seedVersion: 2, records: [{ id: '260916-gone', address: 'in a deleted index', status: 'collected', capturedAt: '2026-09-16T22:00:00.000Z', seed: false }] });
      fake.hiddenFromFetch.add('collected/index-1758146500000.json');
      const jpg = Buffer.from(TINY_JPEG_B64, 'base64');
      fake.seed('collected/photos/260916-real.jpg', jpg, { contentType: 'image/jpeg' });
      fake.seed('collected/photos/260915-nofl.jpg', jpg, { contentType: 'image/jpeg' });
      fake.seed('collected/tickets/260916-real.jpg', jpg, { contentType: 'image/jpeg' });
      const orphanAt = new Date('2026-09-16T22:01:12.000Z');
      fake.seed('collected/photos/260916-orph.jpg', jpg, { contentType: 'image/jpeg', uploadedAt: orphanAt });
      coldStart(fake);

      const mig = await fetch(`${base}/api/records`);
      ok(mig.status === 200, `blob C: first request on a store with index files returns 200 (got ${mig.status})`);
      const migData = await mig.json();

      const real = fake.readJson('collected/records/260916-real.json');
      ok(!!real && real.seed === false && real.address === '5 Real Capture Rd', 'blob C: seed:false record from the newest index is copied to records/<id>.json');
      ok(!!real && real.pricing && real.pricing.includedLb === 2000 && real.ticket === null, 'blob C: migrated record is backfilled with pricing/ticket');
      const nofl = fake.readJson('collected/records/260915-nofl.json');
      ok(!!nofl && nofl.address === '6 Pre-flag Capture Rd', 'blob C: record with no seed key at all is migrated too (predicate is seed !== true)');
      ok(fake.readJson('collected/records/260911-seed.json') === null, 'blob C: seed:true row in the index is not copied');
      const seedOverride = fake.readJson('collected/records/260812-nycx.json');
      ok(!!seedOverride && seedOverride.seed === true && seedOverride.ticket && seedOverride.ticket.netLb === 6100, 'blob C: seed row with a real (blob) ticket is copied as an override with seed:true kept');
      ok(fake.readJson('collected/records/260901-sgen.json') === null, 'blob C: seed row with a seed-generated svg ticket is not copied');
      const nycxRows = migData.records.filter((r) => r.id === '260812-nycx');
      ok(nycxRows.length === 1 && nycxRows[0].ticket && nycxRows[0].ticket.netLb === 6100, 'blob C: list shows the pinned seed record once, with the migrated real ticket winning');
      ok(fake.readJson('collected/records/260910-old1.json') === null, 'blob C: only the newest index is migrated (older index row not copied)');
      ok(fake.keys('collected/index-').length === 3, 'blob C: index files are left in place');
      ok(fake.readJson('collected/records/260916-gone.json') === null, 'blob C: a listed-but-deleted newer index is skipped and the next newest is used');
      const migPuts = fake.puts.filter((p) => p.pathname.startsWith('collected/records/'));
      ok(migPuts.every((p) => p.options.allowOverwrite === false), 'blob C: migration writes refuse to overwrite');

      const orph = fake.readJson('collected/records/260916-orph.json');
      const wantOrph = { id: '260916-orph', address: 'Unknown — recovered from photo', status: 'collected', capturedAt: orphanAt.toISOString(), photoUrl: `${fake.base}/collected/photos/260916-orph.jpg`, seed: false, recovered: true };
      ok(JSON.stringify(orph) === JSON.stringify(wantOrph), `blob C: orphan photo becomes exactly the minimal recovered record (got ${JSON.stringify(orph)})`);
      ok(fake.readJson('collected/records/260916-real.json').recovered === undefined, 'blob C: a photo whose record was migrated is not also recovered');

      const ids = migData.records.map((r) => r.id);
      ok(ids.includes('260916-real') && ids.includes('260915-nofl') && ids.includes('260916-orph') && !ids.includes('260911-seed') && !ids.includes('260910-old1'), 'blob C: list shows migrated + recovered records and the generated seed');
      ok(migData.records[0].id === '260916-orph' || new Date(migData.records[0].capturedAt) >= orphanAt, 'blob C: list is newest first');
      const byId = await fetch(`${base}/api/records/260916-orph`);
      ok(byId.status === 200 && (await byId.json()).recovered === true, `blob C: recovered record is readable by id (got ${byId.status})`);

      const putsBefore = fake.puts.length;
      await fetch(`${base}/api/records`);
      ok(fake.puts.length === putsBefore, 'blob C: migration runs once per instance (second request writes nothing)');
      coldStart(fake);
      await fetch(`${base}/api/records`);
      ok(fake.puts.length === putsBefore, 'blob C: a cold start re-checks and finds nothing left to migrate');

      // An orphaned ticket JPEG (the index lost the ticket fields, the photo survived) is
      // left alone by the migration. Re-attaching a ticket to that record succeeds: the
      // new JPEG gets a random suffix and the record carries that URL; the orphan stays.
      ok(fake.readJson('collected/records/260916-real.json').ticket === null, 'blob C: an orphaned ticket JPEG does not invent ticket fields on the record');
      const reattach = await postTicket(base, '260916-real', 5100);
      ok(reattach.status === 200, `blob C: re-attaching a ticket where an orphan tickets/<id>.jpg exists succeeds (got ${reattach.status})`);
      const reattached = fake.readJson('collected/records/260916-real.json');
      ok(reattached.ticket && reattached.ticket.netLb === 5100 && /\/collected\/tickets\/260916-real-[a-z0-9]+\.jpg$/.test(reattached.ticket.photoUrl), `blob C: record.ticket.photoUrl is a new suffixed URL (got ${reattached.ticket && reattached.ticket.photoUrl})`);
      ok(fake.blobs.has('collected/tickets/260916-real.jpg') && fake.keys('collected/tickets/260916-real').length === 2, 'blob C: the orphan JPEG is untouched beside the new one');

      // No-clobber: attach a ticket to a migrated record, then hide its records/ blob from
      // list() and fetch() (lag) and cold start. The migration must not overwrite it.
      const t = await postTicket(base, '260915-nofl', 5200);
      ok(t.status === 200, `blob C: ticket on a migrated record returns 200 (got ${t.status})`);
      fake.hiddenFromList.add('collected/records/260915-nofl.json');
      fake.hiddenFromFetch.add('collected/records/260915-nofl.json');
      coldStart(fake);
      const lag = await fetch(`${base}/api/records`);
      ok(lag.status === 200, `blob C: request during list()/fetch lag still returns 200 (got ${lag.status})`);
      fake.hiddenFromList.delete('collected/records/260915-nofl.json');
      fake.hiddenFromFetch.delete('collected/records/260915-nofl.json');
      const kept = fake.readJson('collected/records/260915-nofl.json');
      ok(!!kept && kept.ticket && kept.ticket.netLb === 5200, 'blob C: migration under lag did not clobber the ticketed record (allowOverwrite:false backstop)');
      const refused = fake.puts.filter((p) => p.pathname === 'collected/records/260915-nofl.json' && p.ok === false);
      ok(refused.length === 1, `blob C: exactly one refused overwrite attempt was made and swallowed (got ${refused.length})`);
      coldStart(fake);
      const finalRead = await (await fetch(`${base}/api/records/260915-nofl`)).json();
      ok(finalRead.ticket && finalRead.ticket.netLb === 5200, 'blob C: after lag clears the ticketed record reads back intact');
    }
  } catch (err) {
    failures += 1;
    console.log(`  FAIL - blob backend test crashed: ${err && err.stack}`);
  } finally {
    store._setBlobClientForTests(null);
  }
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

    // 1. GET /api/records: seeded, >=100 records, includes pinned 1428 Mission College Blvd record
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
      address: '999 Test St, Columbus, OH 43215',
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

    // 8. overage() pure-function cases
    const caseUnder = overage({ netLb: 1500, includedLb: 2000, ratePerTon: 95 });
    ok(caseUnder.overLb === 0 && caseUnder.charge === 0, `overage: net < included -> overLb 0, charge 0.00 (got ${JSON.stringify(caseUnder)})`);

    const caseEqual = overage({ netLb: 2000, includedLb: 2000, ratePerTon: 95 });
    ok(caseEqual.overLb === 0 && caseEqual.charge === 0, `overage: net == included -> overLb 0, charge 0.00 (got ${JSON.stringify(caseEqual)})`);

    const caseOver = overage({ netLb: 3000, includedLb: 2000, ratePerTon: 95 });
    ok(caseOver.overLb === 1000 && caseOver.charge === 47.5, `overage: net > included -> overLb 1000, charge 47.50 (got ${JSON.stringify(caseOver)})`);

    const casePinned = overage({ netLb: 5340, includedLb: 2000, ratePerTon: 95 });
    ok(casePinned.overLb === 3340 && casePinned.charge === 158.65, `overage: pinned record -> overLb 3340, charge 158.65 (got ${JSON.stringify(casePinned)})`);

    // 9. pinned record 260812-nycx carries the exact ticket from MISSION
    const pinnedRes = await fetch(`${base}/api/records/260812-nycx`);
    ok(pinnedRes.status === 200, `GET /api/records/260812-nycx returns 200 (got ${pinnedRes.status})`);
    const pinnedData = await pinnedRes.json();
    ok(!!pinnedData.ticket, 'pinned record 260812-nycx has a ticket');
    ok(pinnedData.ticket && pinnedData.ticket.netLb === 5340, `pinned record ticket netLb is 5340 (got ${pinnedData.ticket && pinnedData.ticket.netLb})`);
    ok(pinnedData.ticket && pinnedData.ticket.grossLb === 19860, 'pinned record ticket grossLb is 19860');
    ok(pinnedData.ticket && pinnedData.ticket.tareLb === 14520, 'pinned record ticket tareLb is 14520');
    ok(pinnedData.ticket && pinnedData.ticket.facility === 'Zanker Road Transfer Station', 'pinned record ticket facility is Zanker Road Transfer Station');
    ok(!!pinnedData.pricing && pinnedData.pricing.includedLb === 2000 && pinnedData.pricing.ratePerTon === 95, 'pinned record pricing is includedLb 2000 / ratePerTon 95');

    // 10. a seeded FL-* record has no ticket (only RO gets a scale ticket)
    const flRecord = listData.records.find((r) => r.seed && r.container && r.container.startsWith('FL-'));
    ok(!!flRecord, 'found a seeded FL-* record');
    ok(!!flRecord && flRecord.ticket === null, `seeded FL-* record ${flRecord && flRecord.id} has no ticket`);

    // 11. ticket SVG for the pinned record: 200, image/svg+xml, and never the address/container
    const ticketSvgRes = await fetch(`${base}/api/ticket/260812-nycx.svg`);
    ok(ticketSvgRes.status === 200, `GET /api/ticket/260812-nycx.svg returns 200 (got ${ticketSvgRes.status})`);
    ok(
      (ticketSvgRes.headers.get('content-type') || '').includes('image/svg+xml'),
      'ticket svg response has image/svg+xml content-type'
    );
    const ticketSvgBody = await ticketSvgRes.text();
    ok(!ticketSvgBody.includes(pinnedData.address), 'ticket svg body does not contain the record address');
    ok(!ticketSvgBody.includes(pinnedData.container), 'ticket svg body does not contain the container id');
    ok(ticketSvgBody.includes('synthetic demo image'), 'ticket svg is labelled synthetic demo image');

    // 11b. pinned ticket shows the facility's local wall-clock (07:41 PDT), not UTC (14:41)
    ok(ticketSvgBody.includes('07:41'), 'pinned ticket svg shows local time 07:41 (PDT), not UTC');
    ok(!ticketSvgBody.includes('14:41'), 'pinned ticket svg does not show the raw UTC time 14:41');

    // 12. GET /api/schedule stops carry includedLb/ratePerTon
    const scheduleRes = await fetch(`${base}/api/schedule`);
    ok(scheduleRes.status === 200, `GET /api/schedule returns 200 (got ${scheduleRes.status})`);
    const scheduleData = await scheduleRes.json();
    ok(Array.isArray(scheduleData.stops) && scheduleData.stops.length > 0, 'GET /api/schedule returns stops');
    ok(
      scheduleData.stops[0].includedLb === 2000 && scheduleData.stops[0].ratePerTon === 95,
      `GET /api/schedule stops carry includedLb 2000 / ratePerTon 95 (got ${JSON.stringify(scheduleData.stops[0])})`
    );

    // 13. POST /api/records/:id/ticket: full round trip on a fresh non-seed record
    const freshPostRes = await fetch(`${base}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '42 Freshly Posted Ln, Columbus, OH 43215',
        container: 'RO-30-777',
        status: 'collected',
        capturedAt: new Date().toISOString(),
        captureMs: 4800,
        photo: TINY_JPEG_B64,
      }),
    });
    ok(freshPostRes.status === 201, `POST /api/records (for ticket test) returns 201 (got ${freshPostRes.status})`);
    const freshRecord = await freshPostRes.json();

    const ticketPostRes = await fetch(`${base}/api/records/${freshRecord.id}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photo: TINY_JPEG_B64,
        netLb: 4500,
        grossLb: 18000,
        tareLb: 13500,
        facility: 'Test Transfer Station',
        weighedAt: new Date().toISOString(),
        ticketMs: 3100,
      }),
    });
    ok(ticketPostRes.status === 200, `POST /api/records/:id/ticket returns 200 (got ${ticketPostRes.status})`);
    const ticketPostData = await ticketPostRes.json();
    ok(ticketPostData.id === freshRecord.id, 'ticket POST response id matches the record id');
    ok(ticketPostData.url === `/p/${freshRecord.id}`, 'ticket POST response url matches /p/:id');

    const afterTicketRes = await fetch(`${base}/api/records/${freshRecord.id}`);
    const afterTicketData = await afterTicketRes.json();
    ok(!!afterTicketData.ticket && afterTicketData.ticket.netLb === 4500, 'GET record after ticket POST shows netLb 4500');
    ok(afterTicketData.ticket.photoUrl === `/api/ticket/${freshRecord.id}.jpg`, 'ticketed record photoUrl points at local ticket jpg route');

    const ticketJpgRes = await fetch(`${base}/api/ticket/${freshRecord.id}.jpg`);
    ok(ticketJpgRes.status === 200, `GET /api/ticket/${freshRecord.id}.jpg returns 200 (got ${ticketJpgRes.status})`);

    // 14. 409 on a second ticket POST for the same record
    const secondTicketRes = await fetch(`${base}/api/records/${freshRecord.id}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: TINY_JPEG_B64, netLb: 5000 }),
    });
    ok(secondTicketRes.status === 409, `second POST /api/records/:id/ticket returns 409 (got ${secondTicketRes.status})`);

    // 15. 400 without photo, and 400 with netLb 0, against a fresh ticket-less record
    const freshPostRes2 = await fetch(`${base}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '43 Freshly Posted Ln, Columbus, OH 43215',
        container: 'RO-30-778',
        status: 'collected',
        capturedAt: new Date().toISOString(),
        captureMs: 4800,
        photo: TINY_JPEG_B64,
      }),
    });
    const freshRecord2 = await freshPostRes2.json();

    const noPhotoRes = await fetch(`${base}/api/records/${freshRecord2.id}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netLb: 4500 }),
    });
    ok(noPhotoRes.status === 400, `POST /api/records/:id/ticket without photo returns 400 (got ${noPhotoRes.status})`);

    const zeroNetRes = await fetch(`${base}/api/records/${freshRecord2.id}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: TINY_JPEG_B64, netLb: 0 }),
    });
    ok(zeroNetRes.status === 400, `POST /api/records/:id/ticket with netLb 0 returns 400 (got ${zeroNetRes.status})`);

    // 16. 404 on ticket POST for an unknown id
    const unknownTicketRes = await fetch(`${base}/api/records/nope/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: TINY_JPEG_B64, netLb: 4500 }),
    });
    ok(unknownTicketRes.status === 404, `POST /api/records/nope/ticket returns 404 (got ${unknownTicketRes.status})`);

    // 17. caching: JSON routes no-store; image 200s immutable; image 404s no-store (a seed
    //     record can gain a ticket later, so a cached 404 must never stick); schedule 5 min.
    for (const p of ['/api/records', `/api/records/${freshRecord.id}`, '/api/records/nope']) {
      const r = await fetch(`${base}${p}`);
      ok(r.headers.get('cache-control') === 'no-store', `GET ${p} sends Cache-Control: no-store (got ${r.headers.get('cache-control')})`);
    }
    for (const p of [`/api/photo/${seedRecord.id}.svg`, `/api/photo/${freshRecord.id}.jpg`, `/api/ticket/${freshRecord.id}.jpg`, `/api/ticket/${freshRecord.id}.svg`]) {
      const r = await fetch(`${base}${p}`);
      ok(r.status === 200 && r.headers.get('cache-control') === 'public, max-age=31536000, immutable', `GET ${p} 200 is immutable (got ${r.status} ${r.headers.get('cache-control')})`);
    }
    for (const p of [`/api/ticket/${freshRecord2.id}.svg`, '/api/photo/nope.jpg', '/api/photo/nope.svg', '/api/ticket/nope.svg', `/api/ticket/${freshRecord2.id}.jpg`]) {
      const r = await fetch(`${base}${p}`);
      ok(r.status === 404 && r.headers.get('cache-control') === 'no-store', `GET ${p} 404 is no-store (got ${r.status} ${r.headers.get('cache-control')})`);
    }
    const schedR = await fetch(`${base}/api/schedule`);
    ok(schedR.headers.get('cache-control') === 'public, max-age=300', `GET /api/schedule sends public, max-age=300 (got ${schedR.headers.get('cache-control')})`);

    // 18. concurrency on the local backend (single process, single file, lock in store.js)
    await testConcurrency(base, 'local');
  } finally {
    child.kill();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }

  await testMigration();
  await testBlobBackend();

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
