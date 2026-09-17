// Renders a small deterministic SVG "photo" stand-in for seed records.
import { mulberry32, hashStr } from './prng.js';

export function renderPhotoSvg(record) {
  const rand = mulberry32(hashStr(record.id));
  const W = 400;
  const H = 300;
  const hour = new Date(record.capturedAt).getUTCHours();

  // Three flat sky bands by time of day. No gradient: DESIGN.md bans them everywhere,
  // including inside the synthetic demo photo.
  let sky = '#bcd6e8'; // day
  if (hour < 7) {
    sky = '#e2b98a'; // dawn
  } else if (hour >= 13) {
    sky = '#d9c39a'; // late
  }

  const kind = (record.container || 'CT').split('-')[0];
  const binColors = ['#3a5f6b', '#5a6b3a', '#6b3a45', '#3a456b', '#556b3a'];
  const binColor = binColors[Math.floor(rand() * binColors.length)];
  const fillLevel = 0.2 + rand() * 0.65;

  let binShape;
  if (kind === 'RO') {
    binShape = `<rect x="120" y="140" width="180" height="90" rx="4" fill="${binColor}" stroke="#1c1c1c" stroke-width="2"/>
      <rect x="120" y="${(140 + 90 * (1 - fillLevel)).toFixed(1)}" width="180" height="${(90 * fillLevel).toFixed(1)}" fill="#2c2c2c" opacity="0.55"/>`;
  } else if (kind === 'FL') {
    binShape = `<path d="M140 150 L280 150 L265 230 L155 230 Z" fill="${binColor}" stroke="#1c1c1c" stroke-width="2"/>
      <rect x="150" y="${(150 + 80 * (1 - fillLevel)).toFixed(1)}" width="120" height="${(80 * fillLevel).toFixed(1)}" fill="#2c2c2c" opacity="0.5"/>`;
  } else {
    binShape = `<rect x="160" y="160" width="70" height="90" rx="6" fill="${binColor}" stroke="#1c1c1c" stroke-width="2"/>
      <rect x="160" y="${(160 + 90 * (1 - fillLevel)).toFixed(1)}" width="70" height="${(90 * fillLevel).toFixed(1)}" fill="#2c2c2c" opacity="0.5"/>`;
  }

  let extra = '';
  if (record.reason === 'blocked_access') {
    extra = `<rect x="20" y="190" width="110" height="45" rx="6" fill="#b23b3b" stroke="#1c1c1c" stroke-width="2"/>
      <circle cx="45" cy="238" r="10" fill="#222"/>
      <circle cx="105" cy="238" r="10" fill="#222"/>`;
  } else if (record.reason === 'overfilled') {
    extra = `<ellipse cx="180" cy="135" rx="30" ry="14" fill="#e7e2c9" stroke="#8a8460"/>
      <ellipse cx="220" cy="130" rx="24" ry="12" fill="#e7e2c9" stroke="#8a8460"/>`;
  }

  // No burned-in timestamp or GPS: the record is the single source of truth for both,
  // and a stamp in the pixels can only ever agree with it or contradict it.

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${sky}"/>
<rect y="190" width="${W}" height="${H - 190}" fill="#6b6b6b"/>
<rect y="190" width="${W}" height="6" fill="#8a8a8a"/>
${binShape}
${extra}
<text x="${W - 10}" y="14" font-family="sans-serif" font-size="9" fill="#ffffffaa" text-anchor="end">synthetic demo image</text>
</svg>`;
}
