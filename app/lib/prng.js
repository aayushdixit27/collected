// Deterministic PRNG (mulberry32). Same seed -> same sequence, every run.
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash, used everywhere a stable per-id PRNG seed is needed (svgphoto.js,
// svgticket.js, seedgen.js's per-record ticket stream). Was duplicated three times; lives
// here now so all three draw from one definition.
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
