// GET /api/records/:id -> the record, or 404 { error }. 503 when storage cannot be read.
import { getRecord, ensureSeeded } from '../../lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await handle(req, res);
  } catch (err) {
    console.error('storage error:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'storage unavailable', detail: String(err && err.message) }));
  }
}

async function handle(req, res) {
  await ensureSeeded();

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }

  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','records', id]
  // Vercel may hand a dynamic route its param as ?id= rather than in the path; accept either.
  const id = decodeURIComponent(parts[2] || url.searchParams.get('id') || req.query?.id || '');

  const record = await getRecord(id);
  if (!record) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(record));
}
