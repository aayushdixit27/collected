// Renders a small deterministic SVG "paper ticket" stand-in for seed records that have a
// scale ticket. Deliberately never draws the container id or the address: the whole point
// of the customer complaint this feature answers is a ticket that cannot be tied to either.
import { mulberry32, hashStr } from './prng.js';
import { localTimeLabel } from './seedgen.js';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderTicketSvg(record) {
  const ticket = record.ticket || {};
  // Ticket number only: a per-record PRNG seeded off the id plus a distinct salt so it
  // never lines up with (or consumes) the photo renderer's own stream for the same id.
  const rand = mulberry32(hashStr(record.id + ':ticket-svg'));
  const W = 400;
  const H = 300;
  const ticketNo = String(100000 + Math.floor(rand() * 899999));

  const dt = ticket.weighedAt ? new Date(ticket.weighedAt) : null;
  const dateStr = dt ? dt.toISOString().slice(0, 10) : '—';
  // A paper ticket shows the facility's local wall-clock, not UTC.
  const timeStr = ticket.weighedAt ? localTimeLabel(ticket.weighedAt, record.address) : '—';

  const lines = [
    `Facility: ${ticket.facility || 'Unnamed transfer station'}`,
    `Ticket #: ${ticketNo}`,
    `Date: ${dateStr}`,
    `Time: ${timeStr}`,
  ];
  if (typeof ticket.grossLb === 'number') lines.push(`Gross: ${ticket.grossLb.toLocaleString('en-US')} lb`);
  if (typeof ticket.tareLb === 'number') lines.push(`Tare: ${ticket.tareLb.toLocaleString('en-US')} lb`);
  lines.push(`Net: ${typeof ticket.netLb === 'number' ? ticket.netLb.toLocaleString('en-US') : '—'} lb`);

  const textEls = lines
    .map((l, i) => `<text x="28" y="${72 + i * 26}" font-family="monospace" font-size="15" fill="#2a2a26">${escapeXml(l)}</text>`)
    .join('\n');

  // Flat paper color, dashed border like a torn/printed slip. No gradients (DESIGN.md bans
  // them everywhere, including inside synthetic demo images).
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#f2ede0"/>
<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="#8a8460" stroke-width="2" stroke-dasharray="5 4"/>
<text x="${W / 2}" y="38" font-family="sans-serif" font-size="15" fill="#4a4a3f" text-anchor="middle">WEIGHT TICKET</text>
<line x1="28" y1="48" x2="${W - 28}" y2="48" stroke="#8a8460" stroke-width="1"/>
${textEls}
<text x="${W - 12}" y="${H - 10}" font-family="sans-serif" font-size="9" fill="#4a4a3faa" text-anchor="end">synthetic demo image</text>
</svg>`;
}
