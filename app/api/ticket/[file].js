// GET /api/ticket/<id>.svg -> synthetic seed ticket, rendered from record.ticket.
// GET /api/ticket/<id>.jpg -> local-backend real ticket photo; 404 on the Blob backend.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRecord } from '../../lib/store.js';
import { renderTicketSvg } from '../../lib/svgticket.js';

const DATA_DIR = process.env.COLLECTED_DATA_DIR || path.join(process.cwd(), '.data');

export default async function handler(req, res) {
  // Default no-store: a 404 must never stick (a seed record can gain a ticket later). The
  // 200 image paths below override it with immutable, since an image is keyed by an id
  // and rendered from data that does not change once it exists.
  res.setHeader('Cache-Control', 'no-store');
  try {
    await handle(req, res);
  } catch (err) {
    console.error('storage error:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'storage unavailable' }));
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','ticket', file]
  const file = decodeURIComponent(parts[2] || url.searchParams.get('file') || req.query?.file || '');
  const dot = file.lastIndexOf('.');
  const id = dot === -1 ? file : file.slice(0, dot);
  const ext = dot === -1 ? '' : file.slice(dot + 1).toLowerCase();

  if (ext === 'svg') {
    const record = await getRecord(id);
    if (!record || !record.ticket) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const svg = renderTicketSvg(record);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(svg);
    return;
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not found on blob backend' }));
      return;
    }
    try {
      const buf = await fs.readFile(path.join(DATA_DIR, 'tickets', `${id}.jpg`));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not found' }));
    }
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'not found' }));
}
