// Deterministic seed data: ~40 schedule stops across six US markets + 45 days of history.
import { mulberry32, hashStr } from './prng.js';
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

// Every stop bills the same schedule for round 1: 2,000 lb included, $95/ton after that.
const INCLUDED_LB = 2000;
const RATE_PER_TON = 95;

// Plausible third-party transfer stations. Not tied to a market on purpose — a roll-off
// hauler doesn't always dump at the facility nearest the stop, and the pinned demo ticket
// (Zanker Road) is itself a Bay Area facility used for a Santa Clara stop.
const FACILITIES = [
  'Zanker Road Transfer Station',
  'Newby Island Resource Recovery Park',
  'Recology Transfer Station',
  'Republic Services Transfer Station',
  'WM Recycle America MRF',
  'Sunset Scavenger Transfer Station',
];

// Zone abbreviation a paper ticket in each market would actually print. Offsets come
// straight off MARKETS.utcOffsetMin above (kept in one place, not restated here) so the
// two can never drift apart; only the abbreviation is market-specific (AZ doesn't observe
// DST, so it's MST rather than MDT even though the UTC offset matches PDT's).
const STATE_OFFSET_MIN = Object.fromEntries(MARKETS.map((m) => [m.state, m.utcOffsetMin]));
const STATE_ZONE_ABBR = { CA: 'PDT', AZ: 'MST', TX: 'CDT', GA: 'EDT', OH: 'EDT', NC: 'EDT' };

function stateFromAddress(address) {
  const m = typeof address === 'string' && address.match(/,\s*([A-Z]{2})\s+\d{5}\s*$/);
  return m ? m[1] : null;
}

// Renders an ISO instant as the wall-clock time a paper ticket would actually print: the
// market's local time and zone abbreviation (e.g. "07:41 PDT"), not UTC. Records don't
// carry their own timezone, so this derives one from the address's state; an address
// outside the six seeded markets (or missing/malformed) falls back to plain UTC.
export function localTimeLabel(iso, address) {
  const state = stateFromAddress(address);
  const offsetMin = state ? STATE_OFFSET_MIN[state] : undefined;
  const abbr = state ? STATE_ZONE_ABBR[state] : undefined;
  if (offsetMin === undefined || !abbr) {
    const d = new Date(iso);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  }
  const local = new Date(Date.parse(iso) - offsetMin * 60000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} ${abbr}`;
}

// Ticket fields are drawn from a PRNG keyed by the record's OWN id, never the shared `rand`
// stream the loop below uses for ids/status/gps. That is what lets this feature be added
// without shifting a single existing id: nothing here consumes from the main stream.
function ticketFor(record, isPinned) {
  if (isPinned) {
    // Pinned demo record, exact values per MISSION: net 5,340 / gross 19,860 / tare 14,520
    // at Zanker Road, weighed 07:41 PDT the same day (14:41 UTC in August).
    return {
      photoUrl: `/api/ticket/${record.id}.svg`,
      netLb: 5340,
      grossLb: 19860,
      tareLb: 14520,
      facility: 'Zanker Road Transfer Station',
      weighedAt: '2026-08-12T14:41:00.000Z',
      gps: null,
      ticketMs: 4100,
    };
  }

  const kind = (record.container || '').split('-')[0];
  if (kind !== 'RO' || record.status !== 'collected') return null;

  const trand = mulberry32(hashStr(record.id + ':ticket'));
  if (trand() >= 0.75) return null; // ~75% of RO collected records get a ticket

  const netLb = Math.round(1200 + trand() * 6600); // 1,200-7,800 lb per MISSION
  const trueTare = Math.round(9000 + trand() * 7000); // realistic empty roll-off + truck tare
  const grossLb = trueTare + netLb;
  const hasTare = trand() >= 0.3; // ~30% of tickets omit the tare line
  const facility = FACILITIES[Math.floor(trand() * FACILITIES.length)];
  const delayMin = 40 + trand() * 80; // weighed 40-120 min after pickup
  const weighedAt = new Date(Date.parse(record.capturedAt) + delayMin * 60000).toISOString();
  const ticketMs = Math.round(2200 + trand() * 3600);

  return {
    photoUrl: `/api/ticket/${record.id}.svg`,
    netLb,
    grossLb,
    tareLb: hasTare ? trueTare : null,
    facility,
    weighedAt,
    gps: null,
    ticketMs,
  };
}

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
    includedLb: INCLUDED_LB,
    ratePerTon: RATE_PER_TON,
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
      includedLb: INCLUDED_LB,
      ratePerTon: RATE_PER_TON,
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
  // Every record's randomness is keyed by its stop and date, never by the position of the
  // record in the run: the 45-day window slides every UTC midnight, and a stream PRNG would
  // renumber every id (the pinned demo link included) each time it did.
  let rand = mulberry32(seed);
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

      rand = mulberry32(hashStr(`${seed}|${stop.address}|${stop.container}|${day.toISOString().slice(0, 10)}`));
      const skip = !isPinned && rand() < 0.08;
      if (skip) return;


      const minuteOffset = Math.round(idx * gap + rand() * gap * 0.6);
      const minutes = Math.min(endMin, startMin + minuteOffset);
      // Route times are the stop's local wall-clock; cursor is UTC midnight of that date.
      const capturedAt = new Date(cursor + (minutes + stop.utcOffsetMin) * 60000 + Math.floor(rand() * 59) * 1000).toISOString();

      // Never seed a stop that has not happened yet: a record from the future would sort
      // ahead of a real capture made right now.
      if (!isPinned && Date.parse(capturedAt) > seedTimeMs) return;

      const { status, reason } = isPinned ? { status: 'collected', reason: null } : pickStatus(rand);
      const captureMs = Math.round(4200 + rand() * 7600);
      const jitter = () => (rand() - 0.5) * 0.001;
      const gps = {
        lat: Number((stop.lat + jitter()).toFixed(6)),
        lon: Number((stop.lon + jitter()).toFixed(6)),
        accuracyM: Math.round(5 + rand() * 20),
      };
      const note = isPinned ? null : noteFor(reason, rand);
      const id = isPinned ? '260812-nycx' : makeSeedId(capturedAt);
      if (isPinned) usedIds.add(id);

      const record = {
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
        pricing: { includedLb: stop.includedLb, ratePerTon: stop.ratePerTon },
      };
      record.ticket = ticketFor(record, isPinned);

      records.push(record);

      if (isPinned) pinnedFound = true;
    });
  }

  if (!pinnedFound) {
    const stop = schedule.find((s) => s.address.startsWith('1428 Mission College Blvd'));
    const capturedAt = '2026-08-12T13:22:00.000Z';
    const id = makeSeedId(capturedAt);
    const record = {
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
      pricing: { includedLb: stop ? stop.includedLb : INCLUDED_LB, ratePerTon: stop ? stop.ratePerTon : RATE_PER_TON },
    };
    record.ticket = ticketFor(record, true);
    records.push(record);
  }

  records.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  return records;
}
