// GET /api/photo/<id>.svg -> synthetic seed image, rendered from the record.
// GET /api/photo/<id>.jpg -> local-backend real capture; 404 on the Blob backend.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRecord } from '../../lib/store.js';
import { renderPhotoSvg } from '../../lib/svgphoto.js';

const DATA_DIR = process.env.COLLECTED_DATA_DIR || path.join(process.cwd(), '.data');

export default async function handler(req, res) {
  // Round 3: every GET is no-store, images included. A record can be overwritten (ticket
  // attach, migration), so nothing rendered from one is allowed to outlive it in a cache.
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
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','photo', file]
  const file = decodeURIComponent(parts[2] || url.searchParams.get('file') || req.query?.file || '');
  const dot = file.lastIndexOf('.');
  const id = dot === -1 ? file : file.slice(0, dot);
  const ext = dot === -1 ? '' : file.slice(dot + 1).toLowerCase();

  if (ext === 'svg') {
    const record = await getRecord(id);
    if (!record) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const svg = renderPhotoSvg(record);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/svg+xml');
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
      const buf = await fs.readFile(path.join(DATA_DIR, 'photos', `${id}.jpg`));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/jpeg');
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
