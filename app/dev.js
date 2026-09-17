// Tiny local dev server mirroring the Vercel routing: static public/, /p/:id and /office
// rewrites, and /api/* routed to the same handler modules Vercel would invoke. Handlers
// never receive a pre-parsed req.body here (Vercel does parse JSON bodies itself), which is
// what exercises each handler's own raw-stream fallback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import recordsHandler from './api/records.js';
import recordByIdHandler from './api/records/[id].js';
import recordTicketHandler from './api/records/[id]/ticket.js';
import photoHandler from './api/photo/[file].js';
import ticketFileHandler from './api/ticket/[file].js';
import scheduleHandler from './api/schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function shim(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  return res;
}

async function serveStatic(filePath, res) {
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  shim(res);
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    if (pathname === '/api/records' || pathname.startsWith('/api/records?')) {
      await recordsHandler(req, res);
      return;
    }
    if (/^\/api\/records\/[^/]+\/ticket$/.test(pathname)) {
      await recordTicketHandler(req, res);
      return;
    }
    if (/^\/api\/records\/[^/]+$/.test(pathname)) {
      await recordByIdHandler(req, res);
      return;
    }
    if (/^\/api\/photo\/[^/]+$/.test(pathname)) {
      await photoHandler(req, res);
      return;
    }
    if (/^\/api\/ticket\/[^/]+$/.test(pathname)) {
      await ticketFileHandler(req, res);
      return;
    }
    if (pathname === '/api/schedule') {
      await scheduleHandler(req, res);
      return;
    }
    if (pathname.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    // page rewrites (mirrors vercel.json)
    if (pathname === '/office') {
      await serveStatic(path.join(PUBLIC_DIR, 'office.html'), res);
      return;
    }
    if (/^\/p\/[^/]+$/.test(pathname)) {
      await serveStatic(path.join(PUBLIC_DIR, 'p.html'), res);
      return;
    }
    if (pathname === '/') {
      await serveStatic(path.join(PUBLIC_DIR, 'index.html'), res);
      return;
    }

    // static assets
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    await serveStatic(path.join(PUBLIC_DIR, safePath), res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'internal error', detail: String(err && err.message) }));
  }
});

server.listen(PORT, () => {
  console.log(`Collected dev server: http://localhost:${PORT}`);
});
