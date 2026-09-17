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
