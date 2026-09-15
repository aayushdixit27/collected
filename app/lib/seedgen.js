// Deterministic seed data: ~40 schedule stops across six US markets + 45 days of history.
import { mulberry32 } from './prng.js';
import { ALPHABET, datePrefix } from './ids.js';

// Fictional street numbers on real street names. Coordinates are a plausible box per
// metro, not geocoded addresses. utcOffsetMin is the local wall-clock offset for Aug–Oct.
const MARKETS = [
  { city: 'Santa Clara', state: 'CA', zips: [95050, 95051, 95054], lat: [37.34, 37.41], lon: [-121.99, -121.92], utcOffsetMin: 7 * 60,
    streets: ['Mission College Blvd', 'El Camino Real', 'Lafayette St', 'Monroe St', 'Scott Blvd', 'Bowers Ave', 'Coleman Ave', 'Stevens Creek Blvd'] },
  { city: 'Phoenix', state: 'AZ', zips: [85003, 85006, 85008, 85009, 85014], lat: [33.42, 33.52], lon: [-112.12, -111.98], utcOffsetMin: 7 * 60,
    streets: ['Camelback Rd', 'Indian School Rd', 'Thomas Rd', 'McDowell Rd', 'Van Buren St', 'Buckeye Rd', '16th St', '35th Ave'] },
  { city: 'Houston', state: 'TX', zips: [77002, 77006, 77007, 77011, 77023], lat: [29.70, 29.80], lon: [-95.45, -95.32], utcOffsetMin: 5 * 60,
    streets: ['Westheimer Rd', 'Richmond Ave', 'Shepherd Dr', 'Kirby Dr', 'Bellaire Blvd', 'Telephone Rd', 'Navigation Blvd', 'Airline Dr'] },
  { city: 'Atlanta', state: 'GA', zips: [30303, 30308, 30312, 30316, 30318], lat: [33.72, 33.80], lon: [-84.42, -84.34], utcOffsetMin: 4 * 60,
    streets: ['Peachtree St', 'Piedmont Ave', 'Northside Dr', 'DeKalb Ave', 'Memorial Dr', 'Moreland Ave', 'Howell Mill Rd', 'Marietta St'] },
  { city: 'Columbus', state: 'OH', zips: [43201, 43205, 43206, 43211, 43215], lat: [39.94, 40.02], lon: [-83.05, -82.95], utcOffsetMin: 4 * 60,
    streets: ['High St', 'Broad St', 'Parsons Ave', 'Cleveland Ave', 'Livingston Ave', 'Sullivant Ave', 'Neil Ave', 'Refugee Rd'] },
  { city: 'Charlotte', state: 'NC', zips: [28202, 28203, 28205, 28206, 28208], lat: [35.19, 35.26], lon: [-80.88, -80.80], utcOffsetMin: 4 * 60,
    streets: ['Tryon St', 'Independence Blvd', 'Wilkinson Blvd', 'South Blvd', 'Central Ave', 'Monroe Rd', 'Freedom Dr', 'Statesville Ave'] },
];

const SCHEDULE_SEED = 87231;
const RECORD_SEED_BASE = 40915;

function containerFor(kind, rand) {
  if (kind === 'RO') {
    const size = [10, 20, 30, 40][Math.floor(rand() * 4)];
    const num = 100 + Math.floor(rand() * 900);
    return `RO-${size}-${num}`;
  }
  if (kind === 'FL') {
    const size = [2, 3, 4, 6, 8][Math.floor(rand() * 5)];
    const num = 10 + Math.floor(rand() * 90);
    return `FL-${size}-${String(num).padStart(3, '0')}`;
  }
  const size = [32, 64, 96][Math.floor(rand() * 3)];
  const num = 1000 + Math.floor(rand() * 9000);
  return `CT-${size}-${num}`;
}

// ~40 stops spread over six metros, roll-off weighted (half RO, then FL, then carts).
// Pinned demo entry: 1428 Mission College Blvd, Santa Clara — RO-20-114, Wednesday.
export function generateSchedule() {
  const rand = mulberry32(SCHEDULE_SEED);
  const stops = [];

  stops.push({
    address: '1428 Mission College Blvd, Santa Clara, CA 95054',
    container: 'RO-20-114',
    weekday: 3, // Wednesday
    lat: 37.3896,
    lon: -121.9793,
    utcOffsetMin: 7 * 60,
  });

  while (stops.length < 40) {
    const m = MARKETS[(stops.length - 1) % MARKETS.length];
    const street = m.streets[Math.floor(rand() * m.streets.length)];
    const num = 100 + Math.floor(rand() * 9800);
    const zip = m.zips[Math.floor(rand() * m.zips.length)];
    const address = `${num} ${street}, ${m.city}, ${m.state} ${zip}`;
    const k = rand();
    const kind = k < 0.5 ? 'RO' : k < 0.8 ? 'FL' : 'CT';
    const container = containerFor(kind, rand);
    const weekday = 1 + Math.floor(rand() * 5);
    const lat = m.lat[0] + rand() * (m.lat[1] - m.lat[0]);
    const lon = m.lon[0] + rand() * (m.lon[1] - m.lon[0]);
    stops.push({
      address,
      container,
      weekday,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      utcOffsetMin: m.utcOffsetMin,
    });
  }

  const counters = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of stops) {
    counters[s.weekday] += 1;
    s.routeOrder = counters[s.weekday];
  }
  return stops;
}

function pickStatus(rand) {
  const r = rand();
  if (r < 0.9) return { status: 'collected', reason: null };
  if (r < 0.96) {
    const reasons = ['blocked_access', 'overfilled', 'contaminated', 'not_out'];
    return { status: 'not_collected', reason: reasons[Math.floor(rand() * reasons.length)] };
  }
  if (r < 0.98) return { status: 'delivered', reason: null };
  return { status: 'removed', reason: null };
}

function noteFor(reason, rand) {
  if (rand() > 0.12) return null;
  if (reason === 'blocked_access') return 'car blocking, waited 6 min';
  if (reason === 'overfilled') return 'lid open, overfull — photo';
  const generic = ['gate code 4471', 'dog in yard, careful', 'bin moved to curb late', 'access via alley'];
  return generic[Math.floor(rand() * generic.length)];
}

// Generates records for every scheduled occurrence in the 45 days ending at seedTimeMs,
// skipping ~8% at random (coverage gaps). Forces the 2026-08-12 1428 Mission College Blvd record.
export function generateSeedRecords(schedule, seedTimeMs = Date.now(), seed = RECORD_SEED_BASE) {
  const rand = mulberry32(seed);
  const records = [];
  const usedIds = new Set();

  function makeSeedId(iso) {
    const prefix = datePrefix(iso);
    let id;
    do {
      let s = '';
      for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
      id = `${prefix}-${s}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  }

  const dayMs = 86400000;
  const endDay = new Date(seedTimeMs);
  endDay.setUTCHours(0, 0, 0, 0);
  const startMs = endDay.getTime() - 45 * dayMs;

  let pinnedFound = false;

  for (let cursor = startMs; cursor <= endDay.getTime(); cursor += dayMs) {
    const day = new Date(cursor);
    const dow = day.getUTCDay(); // 0 Sun .. 6 Sat
    const weekday = dow === 0 ? 7 : dow; // 1 Mon .. 7 Sun
    if (weekday > 5) continue;

    const stopsToday = schedule.filter((s) => s.weekday === weekday).sort((a, b) => a.routeOrder - b.routeOrder);
    if (stopsToday.length === 0) continue;

    const startMin = 6 * 60 + 5;
    const endMin = 14 * 60 + 50;
    const span = endMin - startMin;
    const gap = span / stopsToday.length;

    stopsToday.forEach((stop, idx) => {
      const isPinned =
        stop.address.startsWith('1428 Mission College Blvd') &&
        day.getUTCFullYear() === 2026 &&
        day.getUTCMonth() === 7 &&
        day.getUTCDate() === 12;

      const skip = !isPinned && rand() < 0.08;
      if (skip) return;

      const minuteOffset = Math.round(idx * gap + rand() * gap * 0.6);
      const minutes = Math.min(endMin, startMin + minuteOffset);
      // Route times are the stop's local wall-clock; cursor is UTC midnight of that date.
      const capturedAt = new Date(cursor + (minutes + stop.utcOffsetMin) * 60000 + Math.floor(rand() * 59) * 1000).toISOString();

      const { status, reason } = isPinned ? { status: 'collected', reason: null } : pickStatus(rand);
      const captureMs = Math.round(4200 + rand() * 7600);
      const jitter = () => (rand() - 0.5) * 0.001;
      const gps = {
        lat: Number((stop.lat + jitter()).toFixed(6)),
        lon: Number((stop.lon + jitter()).toFixed(6)),
        accuracyM: Math.round(5 + rand() * 20),
      };
      const note = isPinned ? null : noteFor(reason, rand);
      const id = makeSeedId(capturedAt);

      records.push({
        id,
        address: stop.address,
        container: stop.container,
        status,
        reason,
        note,
        capturedAt,
        receivedAt: capturedAt,
        gps,
        photoUrl: `/api/photo/${id}.svg`,
        captureMs,
        seed: true,
      });

      if (isPinned) pinnedFound = true;
    });
  }

  if (!pinnedFound) {
    const stop = schedule.find((s) => s.address.startsWith('1428 Mission College Blvd'));
    const capturedAt = '2026-08-12T13:22:00.000Z';
    const id = makeSeedId(capturedAt);
    records.push({
      id,
      address: stop ? stop.address : '1428 Mission College Blvd, Santa Clara, CA 95054',
      container: stop ? stop.container : 'RO-20-114',
      status: 'collected',
      reason: null,
      note: null,
      capturedAt,
      receivedAt: capturedAt,
      gps: { lat: stop ? stop.lat : 37.3896, lon: stop ? stop.lon : -121.9793, accuracyM: 8 },
      photoUrl: `/api/photo/${id}.svg`,
      captureMs: 6400,
      seed: true,
    });
  }

  records.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  return records;
}
