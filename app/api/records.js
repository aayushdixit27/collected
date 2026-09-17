// GET /api/records -> { records: [...] } newest first, no photo bytes beyond photoUrl.
// POST /api/records -> { id, url } 201, or 400 on validation failure.
// 503 { error } when storage cannot be read or written; nothing is reseeded on the way.
import { listRecords, putRecord, ensureSeeded } from '../lib/store.js';
import { datePrefix, randomSuffix } from '../lib/ids.js';

const STATUSES = ['collected', 'delivered', 'removed', 'not_collected'];
const REASONS = ['blocked_access', 'overfilled', 'contaminated', 'not_out'];
// Every stop bills the same schedule for round 1 (see lib/seedgen.js); used whenever a
// capture doesn't pass its own pricing along.
const DEFAULT_PRICING = { includedLb: 2000, ratePerTon: 95 };

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await handle(req, res);
  } catch (err) {
    console.error('storage error:', err);
    sendJson(res, 503, { error: 'storage unavailable' });
  }
}

async function handle(req, res) {
  await ensureSeeded();

  if (req.method === 'GET') {
    const records = await listRecords();
    const sorted = records.slice().sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
    sendJson(res, 200, { records: sorted });
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }

    const { address, container, status, reason, note, capturedAt, gps, captureMs, photo, pricing } = body || {};

    if (!address || typeof address !== 'string' || !address.trim()) {
      sendJson(res, 400, { error: 'address is required' });
      return;
    }
    if (!STATUSES.includes(status)) {
      sendJson(res, 400, { error: 'status must be one of ' + STATUSES.join(', ') });
      return;
    }
    if (reason && !REASONS.includes(reason)) {
      sendJson(res, 400, { error: 'reason must be one of ' + REASONS.join(', ') });
      return;
    }
    if (!photo || typeof photo !== 'string') {
      sendJson(res, 400, { error: 'photo is required' });
      return;
    }

    let buf;
    try {
      buf = Buffer.from(photo, 'base64');
    } catch {
      sendJson(res, 400, { error: 'photo must be base64-encoded' });
      return;
    }
    if (buf.length === 0 || buf.length > 3 * 1024 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      sendJson(res, 400, { error: 'photo must be a non-empty JPEG under 3MB decoded' });
      return;
    }

    const capturedAtIso =
      capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : new Date().toISOString();

    // No collision scan of the whole store per POST any more: the store's putRecord
    // refuses to overwrite an existing id at the origin and regenerates on collision.
    const id = `${datePrefix(capturedAtIso)}-${randomSuffix()}`;

    const record = {
      id,
      address: address.trim(),
      container: container && String(container).trim() ? String(container).trim() : null,
      status,
      reason: status === 'not_collected' ? reason || null : null,
      note: note && String(note).trim() ? String(note).trim().slice(0, 280) : null,
      capturedAt: capturedAtIso,
      receivedAt: new Date().toISOString(),
      gps:
        gps && typeof gps.lat === 'number' && typeof gps.lon === 'number'
          ? { lat: gps.lat, lon: gps.lon, accuracyM: typeof gps.accuracyM === 'number' ? gps.accuracyM : null }
          : null,
      photoUrl: null,
      captureMs: typeof captureMs === 'number' ? Math.round(captureMs) : null,
      seed: false,
      // Set at capture from the stop (lane-2 sends it from /api/schedule); every stop
      // currently shares one billing tier, so a missing/invalid value falls back to it
      // rather than leaving real captures without a price to show against the ticket.
      pricing:
        pricing && typeof pricing.includedLb === 'number' && typeof pricing.ratePerTon === 'number'
          ? { includedLb: pricing.includedLb, ratePerTon: pricing.ratePerTon }
          : DEFAULT_PRICING,
      ticket: null,
    };

    await putRecord(record, buf);
    sendJson(res, 201, { id: record.id, url: `/p/${record.id}` });
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}
