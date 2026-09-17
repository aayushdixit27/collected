// GET /api/schedule -> { stops: [...] } the ~40-stop LA route schedule (not in the brief's
// API list, added so the capture chips / suggestions / office coverage math share one
// source of truth without shipping a build step or a static data fetch outside public/).
import { generateSchedule } from '../lib/seedgen.js';

let cached = null;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  if (!cached) cached = generateSchedule();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ stops: cached }));
}
