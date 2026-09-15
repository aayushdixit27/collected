// Deterministic seed data: ~40 LA schedule stops + 45 days of service-event history.
import { mulberry32 } from './prng.js';
import { ALPHABET, datePrefix } from './ids.js';

const STREETS = [
  'Mission Rd', 'Alameda St', 'Soto St', 'Olympic Blvd', 'Pico Blvd', 'Vermont Ave',
  'Sunset Blvd', 'Figueroa St', 'Main St', 'Spring St', 'Broadway', 'San Pedro St',
  'Central Ave', 'Washington Blvd', 'Adams Blvd', 'Slauson Ave', 'Florence Ave',
  'Manchester Ave', 'Imperial Hwy', 'Vernon Ave', 'Jefferson Blvd', 'Venice Blvd',
  'Beverly Blvd', 'Melrose Ave', 'Santa Monica Blvd', '3rd St', '6th St', '7th St',
  'Wilshire Blvd', 'Temple St', 'Cesar Chavez Ave', 'Alvarado St', 'Western Ave',
  'Normandie Ave', 'Hoover St', 'Crenshaw Blvd', 'Exposition Blvd',
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

// ~40 stops, fictional street numbers on real LA street names.
// Pinned entry required by the brief: 1428 Mission Rd, RO-20-114, Wednesday.
export function generateSchedule() {
  const rand = mulberry32(SCHEDULE_SEED);
  const stops = [];

  stops.push({
    address: '1428 Mission Rd, Los Angeles, CA 90033',
    container: 'RO-20-114',
    weekday: 3, // Wednesday
    lat: 34.0453,
    lon: -118.214,
  });

  const kinds = ['RO', 'FL', 'CT'];
  while (stops.length < 40) {
    const street = STREETS[Math.floor(rand() * STREETS.length)];
    const num = 100 + Math.floor(rand() * 9800);
    const zip = 90001 + Math.floor(rand() * 90);
    const address = `${num} ${street}, Los Angeles, CA ${zip}`;
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const container = containerFor(kind, rand);
    const weekday = 1 + Math.floor(rand() * 5);
    const lat = 34.0 + rand() * 0.1;
    const lon = -118.32 + rand() * 0.12;
    stops.push({
      address,
      container,
      weekday,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
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
// skipping ~8% at random (coverage gaps). Forces the 2026-08-12 1428 Mission Rd record.
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
        stop.address.startsWith('1428 Mission Rd') &&
        day.getUTCFullYear() === 2026 &&
        day.getUTCMonth() === 7 &&
        day.getUTCDate() === 12;

      const skip = !isPinned && rand() < 0.08;
      if (skip) return;

      const minuteOffset = Math.round(idx * gap + rand() * gap * 0.6);
      const minutes = Math.min(endMin, startMin + minuteOffset);
      // Route times are Los Angeles wall-clock (PDT, UTC-7 for Aug–Oct); cursor is UTC midnight.
      const LA_OFFSET_MIN = 7 * 60;
      const capturedAt = new Date(cursor + (minutes + LA_OFFSET_MIN) * 60000 + Math.floor(rand() * 59) * 1000).toISOString();

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
    const stop = schedule.find((s) => s.address.startsWith('1428 Mission Rd'));
    const capturedAt = '2026-08-12T13:22:00.000Z';
    const id = makeSeedId(capturedAt);
    records.push({
      id,
      address: stop ? stop.address : '1428 Mission Rd, Los Angeles, CA 90033',
      container: stop ? stop.container : 'RO-20-114',
      status: 'collected',
      reason: null,
      note: null,
      capturedAt,
      receivedAt: capturedAt,
      gps: { lat: stop ? stop.lat : 34.0453, lon: stop ? stop.lon : -118.214, accuracyM: 8 },
      photoUrl: `/api/photo/${id}.svg`,
      captureMs: 6400,
      seed: true,
    });
  }

  records.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  return records;
}
