// POST /api/records/:id/ticket -> attach a scale ticket to an existing record.
// 200 { id, url: "/p/<id>" } · 404 unknown id · 400 missing/invalid photo or netLb ·
// 409 ticket already present.
import { getRecord, putTicket, ensureSeeded } from '../../../lib/store.js';

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

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','records', id, 'ticket']
  // Vercel may hand a dynamic nested route its param as ?id= rather than in the path;
  // accept either, same fallback as api/records/[id].js.
  const id = decodeURIComponent(parts[2] || url.searchParams.get('id') || req.query?.id || '');

  const record = await getRecord(id);
  if (!record) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  if (record.ticket) {
    sendJson(res, 409, { error: 'ticket already recorded for this record' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' });
    return;
  }

  const { photo, netLb, grossLb, tareLb, facility, weighedAt, gps, ticketMs } = body || {};

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

  if (typeof netLb !== 'number' || !Number.isInteger(netLb) || netLb < 1 || netLb > 80000) {
    sendJson(res, 400, { error: 'netLb is required and must be an integer between 1 and 80000' });
    return;
  }
  if (grossLb !== undefined && grossLb !== null && typeof grossLb !== 'number') {
    sendJson(res, 400, { error: 'grossLb must be a number' });
    return;
  }
  if (tareLb !== undefined && tareLb !== null && typeof tareLb !== 'number') {
    sendJson(res, 400, { error: 'tareLb must be a number' });
    return;
  }
  if (weighedAt !== undefined && weighedAt !== null && Number.isNaN(Date.parse(weighedAt))) {
    sendJson(res, 400, { error: 'weighedAt must be a valid date' });
    return;
  }

  const weighedAtIso =
    weighedAt && !Number.isNaN(Date.parse(weighedAt)) ? new Date(weighedAt).toISOString() : new Date().toISOString();

  const fields = {
    netLb,
    grossLb: typeof grossLb === 'number' ? grossLb : null,
    tareLb: typeof tareLb === 'number' ? tareLb : null,
    facility: facility && String(facility).trim() ? String(facility).trim() : null,
    weighedAt: weighedAtIso,
    gps:
      gps && typeof gps.lat === 'number' && typeof gps.lon === 'number'
        ? { lat: gps.lat, lon: gps.lon, accuracyM: typeof gps.accuracyM === 'number' ? gps.accuracyM : null }
        : null,
    ticketMs: typeof ticketMs === 'number' ? Math.round(ticketMs) : null,
  };

  const updated = await putTicket(id, fields, buf);
  if (!updated) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  sendJson(res, 200, { id, url: `/p/${id}` });
}
