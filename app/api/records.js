// GET /api/records -> { records: [...] } newest first, no photo bytes beyond photoUrl.
// POST /api/records -> { id, url } 201, or 400 on validation failure.
import { listRecords, putRecord, ensureSeeded } from '../lib/store.js';
import { makeId } from '../lib/ids.js';

const STATUSES = ['collected', 'delivered', 'removed', 'not_collected'];
const REASONS = ['blocked_access', 'overfilled', 'contaminated', 'not_out'];

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

    const { address, container, status, reason, note, capturedAt, gps, captureMs, photo } = body || {};

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
    if (buf.length === 0 || buf.length > 3 * 1024 * 1024) {
      sendJson(res, 400, { error: 'photo must be a non-empty JPEG under 3MB decoded' });
      return;
    }

    const capturedAtIso =
      capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : new Date().toISOString();

    const id = await makeId(capturedAtIso, listRecords);

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
    };

    await putRecord(record, buf);
    sendJson(res, 201, { id: record.id, url: `/p/${record.id}` });
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}
