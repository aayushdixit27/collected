// Record id: YYMMDD-xxxx, xxxx = 4 lowercase base32-ish chars, no 0/1/o/l.
export const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

export function datePrefix(iso) {
  const d = new Date(iso);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

export function randomSuffix(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

// Used for real (POSTed) captures. Retries against the live index to dodge collisions.
export async function makeId(capturedAtIso, listRecords) {
  const prefix = datePrefix(capturedAtIso);
  const existing = new Set((await listRecords()).map((r) => r.id));
  let id;
  do {
    id = `${prefix}-${randomSuffix()}`;
  } while (existing.has(id));
  return id;
}
