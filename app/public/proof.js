(() => {
  const el = (id) => document.getElementById(id);
  const haversineKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  const parts = location.pathname.split('/').filter(Boolean); // ['p', id]
  const id = decodeURIComponent(parts[1] || '');

  const params = new URLSearchParams(location.search);
  const t0 = params.get('t0');
  const t0Valid = !!(t0 && /^\d+$/.test(t0) && (() => {
    const ms = Date.now() - Number(t0);
    return ms >= 0 && ms <= 3600000;
  })());

  const STATUS_LABEL = {
    collected: 'Collected',
    delivered: 'Delivered',
    removed: 'Removed',
    not_collected: 'Could not collect',
  };
  const REASON_LABEL = {
    blocked_access: 'Blocked access',
    overfilled: 'Overfilled',
    contaminated: 'Contaminated',
    not_out: 'Not out',
  };

  function fmtCaptured(iso) {
    const d = new Date(iso);
    const opts = {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    };
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }

  // Overage helper — duplicated locally per MISSION.md; do not import from lib/ (server-side).
  function overage(netLb, includedLb, ratePerTon) {
    const overLb = Math.max(0, netLb - includedLb);
    const charge = Math.round((overLb / 2000) * ratePerTon * 100) / 100;
    return { overLb, charge };
  }

  function fmtLb(n) {
    return `${n.toLocaleString('en-US')} lb`;
  }

  function fmtMoney(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderTicketAndCharge(record) {
    const ticketBody = el('ticketBody');
    const chargeSection = el('chargeSection');
    const chargeBody = el('chargeBody');
    const ticket = record.ticket;

    if (!ticket) {
      ticketBody.innerHTML = `
        <table class="record-table"><tbody>
          <tr><th></th><td style="color:var(--warn)">No scale ticket tied to this pull.</td></tr>
        </tbody></table>`;
      chargeSection.classList.add('hidden');
      chargeBody.innerHTML = '';
      return;
    }

    const weighedLocal = fmtCaptured(ticket.weighedAt);
    const deltaMin = Math.round((Date.parse(ticket.weighedAt) - Date.parse(record.capturedAt)) / 60000);
    const deltaLine = deltaMin < 0
      ? `<span class="weighed-delta warn">${deltaMin} min before pickup</span>`
      : `<span class="weighed-delta">+${deltaMin} min after pickup</span>`;

    const tareCell = ticket.tareLb == null
      ? `<td style="color:var(--ink-2)">— not on ticket</td>`
      : `<td class="num">${fmtLb(ticket.tareLb)}</td>`;
    const grossCell = ticket.grossLb == null ? `<td>—</td>` : `<td class="num">${fmtLb(ticket.grossLb)}</td>`;

    let locationRow = '';
    if (ticket.gps) {
      locationRow = `<tr><th>Location</th><td class="mono">${ticket.gps.lat.toFixed(5)}, ${ticket.gps.lon.toFixed(5)} ± ${ticket.gps.accuracyM ?? '?'}m</td></tr>`;
    }

    ticketBody.innerHTML = `
      <img class="photo-ticket" src='${ticket.photoUrl}' alt="Scale ticket">
      <table class="record-table"><tbody>
        <tr><th>Facility</th><td>${ticket.facility || '—'}</td></tr>
        <tr><th>Weighed</th><td>${weighedLocal}${deltaLine}</td></tr>
        <tr><th>Gross</th>${grossCell}</tr>
        <tr><th>Tare</th>${tareCell}</tr>
        <tr><th>Net</th><td class="num">${fmtLb(ticket.netLb)}</td></tr>
        ${locationRow}
      </tbody></table>`;

    let pricing = record.pricing;
    if (!pricing) {
      pricing = { includedLb: 2000, ratePerTon: 95 };
    }
    const { overLb, charge } = overage(ticket.netLb, pricing.includedLb, pricing.ratePerTon);

    const amountLine = overLb === 0
      ? `<div class="charge-amount">${fmtMoney(charge)}<small>— within the included ton</small></div>`
      : `<div class="charge-amount">${fmtMoney(charge)}<small>Overage at ${fmtMoney(pricing.ratePerTon)} per ton over the included ${fmtLb(pricing.includedLb)}</small></div>`;

    chargeBody.innerHTML = `
      <div class="charge">
        <div class="charge-line">Net ${fmtLb(ticket.netLb)}<span class="sep">·</span>Included ${fmtLb(pricing.includedLb)}<span class="sep">·</span>Over ${fmtLb(overLb)}</div>
        <div class="charge-formula">${fmtLb(overLb)} ÷ 2,000 × ${fmtMoney(pricing.ratePerTon)}/ton</div>
        ${amountLine}
      </div>`;
    chargeSection.classList.remove('hidden');
  }

  async function load() {
    let res;
    try {
      res = await fetch(`/api/records/${encodeURIComponent(id)}`);
    } catch {
      showNotFound();
      return;
    }
    if (res.status === 404) {
      showNotFound();
      return;
    }
    if (!res.ok) {
      showNotFound();
      return;
    }
    const record = await res.json();

    // TEMP FIXTURE (lane-3, remove before final)
    const demo = params.get('demo');
    if (demo) {
      const TICKET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560">
<rect width="420" height="560" fill="#EDE9E0"/>
<rect x="34" y="28" width="352" height="504" fill="#FBFAF6" stroke="#CFC9BC"/>
<g font-family="Menlo, Consolas, monospace" fill="#2A2724" font-size="14">
<text x="60" y="70" font-size="15" font-weight="700">ZANKER ROAD TRANSFER STATION</text>
<text x="60" y="92">705 Los Esteros Rd, San Jose CA</text>
<text x="60" y="130">TICKET NO   0417723</text>
<text x="60" y="152">DATE        08/12/2026</text>
<text x="60" y="174">TIME IN     07:41</text>
<text x="60" y="196">MATERIAL    C&amp;D MIXED</text>
<text x="60" y="218">TRUCK       T-18</text>
<line x1="60" y1="244" x2="360" y2="244" stroke="#2A2724" stroke-dasharray="2 3"/>
<text x="60" y="282">GROSS          19860 LB</text>
<text x="60" y="308">TARE           14520 LB</text>
<text x="60" y="334" font-weight="700">NET             5340 LB</text>
<line x1="60" y1="360" x2="360" y2="360" stroke="#2A2724" stroke-dasharray="2 3"/>
<text x="60" y="400">SCALE 2  OPERATOR 14</text>
<text x="60" y="422">TONS 2.67</text>
<text x="60" y="490" font-size="12" fill="#6B655C">CUSTOMER COPY</text>
</g></svg>`;
      // Brief specified `data:image/svg+xml;utf8,` with only `#`->`%23` encoded, but that
      // shorthand does not render in this Chrome build (tested in isolation: blank/broken
      // image). Using a fully percent-encoded data URI instead, which renders correctly.
      const ticketPhotoUrl = 'data:image/svg+xml,' + encodeURIComponent(TICKET_SVG);
      const weighedAt = new Date(Date.parse(record.capturedAt) + 65 * 60000).toISOString();
      const basePricing = { includedLb: 2000, ratePerTon: 95 };

      if (demo === 'noticket') {
        record.ticket = null;
      } else if (demo === 'zero') {
        record.ticket = {
          photoUrl: ticketPhotoUrl,
          netLb: 1800,
          grossLb: 19860,
          tareLb: null,
          facility: 'Zanker Road Transfer Station',
          weighedAt,
          gps: null,
          ticketMs: 6200,
        };
        record.pricing = basePricing;
      } else if (demo === 'ticket') {
        record.ticket = {
          photoUrl: ticketPhotoUrl,
          netLb: 5340,
          grossLb: 19860,
          tareLb: 14520,
          facility: 'Zanker Road Transfer Station',
          weighedAt,
          gps: null,
          ticketMs: 6200,
        };
        record.pricing = basePricing;
      }
    }
    // END TEMP FIXTURE

    render(record);
  }

  function showNotFound() {
    el('loadingState').classList.add('hidden');
    el('notFoundState').classList.remove('hidden');
  }

  function render(record) {
    el('loadingState').classList.add('hidden');
    el('recordState').classList.remove('hidden');

    const photo = el('photo');
    if (t0Valid) {
      photo.addEventListener('load', () => {
        const ms = Date.now() - Number(t0);
        const badge = el('retrievedBadge');
        badge.textContent = `Retrieved in ${(ms / 1000).toFixed(1)}s`;
        badge.classList.remove('hidden');
        history.replaceState(null, '', location.pathname);
      }, { once: true });
    }
    photo.src = record.photoUrl;

    const badge = el('statusBadge');
    badge.className = `badge ${record.status}`;
    badge.textContent = record.status === 'not_collected' && record.reason
      ? `${STATUS_LABEL[record.status]} · ${REASON_LABEL[record.reason] || record.reason}`
      : STATUS_LABEL[record.status] || record.status;

    el('ddAddress').textContent = record.address;
    el('ddContainer').textContent = record.container || '—';

    el('ddCaptured').innerHTML = `${fmtCaptured(record.capturedAt)}<span class="captured-iso mono">${record.capturedAt}</span>`;

    if (record.gps) {
      el('locText').textContent = `${record.gps.lat.toFixed(5)}, ${record.gps.lon.toFixed(5)} ± ${record.gps.accuracyM ?? '?'}m`;
      const gmaps = el('gmapsLink');
      gmaps.href = `https://www.google.com/maps?q=${record.gps.lat},${record.gps.lon}`;
      gmaps.classList.remove('hidden');
      const mapDiv = el('map');
      mapDiv.classList.remove('hidden');
      if (window.L) {
        const map = L.map(mapDiv, { zoomControl: false, attributionControl: true }).setView([record.gps.lat, record.gps.lon], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        L.marker([record.gps.lat, record.gps.lon]).addTo(map);
      }
      // If this stop has a known location, say how far the fix is from it. A pin that
      // quietly lands in the wrong city under the right address is worse than no pin.
      fetch('/api/schedule').then((r) => r.json()).then(({ stops }) => {
        const stop = (stops || []).find((s) => s.address === record.address);
        if (!stop) return;
        const km = haversineKm(record.gps.lat, record.gps.lon, stop.lat, stop.lon);
        if (km > 1) {
          el('locWarn').className = 'loc-warn';
          el('locWarn').textContent = `Fix is ${km < 10 ? km.toFixed(1) : Math.round(km)} km from this stop's scheduled location.`;
        }
      }).catch(() => {});
    } else {
      el('locText').textContent = 'No GPS fix at capture';
    }

    // Every row is present on the document, including an empty note, so a print is complete.
    el('rowNote').classList.remove('hidden');
    el('ddNote').textContent = record.note || '—';

    el('ddId').textContent = record.id;
    el('ddReceived').textContent = record.receivedAt;

    renderTicketAndCharge(record);

    el('copyLinkBtn').addEventListener('click', () => {
      navigator.clipboard?.writeText(location.origin + location.pathname);
      el('copyLinkBtn').textContent = 'Copied';
      setTimeout(() => (el('copyLinkBtn').textContent = 'Copy link'), 1500);
    });
    el('printBtn').addEventListener('click', () => window.print());
  }

  load();
})();
