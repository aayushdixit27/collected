(() => {
  const el = (id) => document.getElementById(id);
  const qInput = el('qInput');
  const fromInput = el('fromInput');
  const toInput = el('toInput');
  const statusSelect = el('statusSelect');
  const results = el('results');

  let allRecords = [];
  let schedule = [];
  let t0 = null;

  function markInteraction() {
    if (t0 === null) t0 = Date.now();
  }
  ['input', 'change', 'click', 'focus'].forEach((ev) => {
    document.querySelector('.office-controls').addEventListener(ev, markInteraction, true);
  });

  function toDateInputValue(d) {
    return d.toISOString().slice(0, 10);
  }

  const today = new Date();
  const fromDefault = new Date(today.getTime() - 45 * 86400000);
  fromInput.value = toDateInputValue(fromDefault);
  toInput.value = toDateInputValue(today);

  const STATUS_LABEL = {
    collected: 'Collected',
    delivered: 'Delivered',
    removed: 'Removed',
    not_collected: 'Could not collect',
  };

  function ticketSuffix(r) {
    if (r.ticket && typeof r.ticket.netLb === 'number') {
      return ` <span class="has-ticket">· ticket ${r.ticket.netLb.toLocaleString()} lb</span>`;
    }
    if (r.status === 'collected' && r.container && r.container.startsWith('RO-')) {
      return ' <span class="no-ticket">· no ticket yet</span>';
    }
    return '';
  }
  function missingTicket(r) {
    return r.status === 'collected' && !!r.container && r.container.startsWith('RO-') && !r.ticket;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Address, container and photoUrl are unauthenticated free text from POST; never put them in innerHTML raw.
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function dateOnly(iso) {
    // Local calendar date, so a 6 AM stop never lands on the previous UTC day.
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function matchesFilters(r) {
    const q = qInput.value.trim().toLowerCase();
    if (q) {
      const hay = `${r.address} ${r.container || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const from = fromInput.value;
    const to = toInput.value;
    const d = dateOnly(r.capturedAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    const status = statusSelect.value;
    if (status === 'missing_ticket') {
      if (!missingTicket(r)) return false;
    } else if (status && r.status !== status) return false;
    return true;
  }

  function median(nums) {
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function computeCoverage(from, to, statusFilter) {
    if (!from || !to || schedule.length === 0) return { pct: null, have: 0, total: 0 };
    // missing_ticket is RO + collected + no ticket for filtering rows, but for the coverage
    // record index it means the same thing a plain "collected" filter would.
    const effectiveStatus = statusFilter === 'missing_ticket' ? 'collected' : statusFilter;
    // index records (ignoring the free-text query, respecting the status filter) by
    // address|container|date for a fast membership check
    const key = (address, container, date) => `${address}||${container}||${date}`;
    const recordDays = new Set();
    // A day counts toward the denominator only if it has at least one record at all —
    // any address, any status — so a day nothing was captured on isn't a missed stop.
    const daysWithAnyRecord = new Set();
    for (const r of allRecords) {
      daysWithAnyRecord.add(dateOnly(r.capturedAt));
      if (effectiveStatus && r.status !== effectiveStatus) continue;
      recordDays.add(key(r.address, r.container, dateOnly(r.capturedAt)));
    }
    let total = 0;
    let have = 0;
    const todayStr = dateOnly(new Date().toISOString());
    const start = new Date(from + 'T00:00:00.000Z');
    const end = new Date(to + 'T00:00:00.000Z');
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const day = new Date(t);
      const dow = day.getUTCDay();
      const weekday = dow === 0 ? 7 : dow;
      if (weekday > 5) continue;
      const dateStr = day.toISOString().slice(0, 10);
      // A stop scheduled for today that has not happened yet is not a missed stop.
      if (dateStr >= todayStr) continue;
      if (!daysWithAnyRecord.has(dateStr)) continue;
      for (const s of schedule) {
        if (s.weekday !== weekday) continue;
        total += 1;
        if (recordDays.has(key(s.address, s.container, dateStr))) have += 1;
      }
    }
    return { pct: total > 0 ? Math.round((have / total) * 100) : null, have, total };
  }

  function render() {
    const filtered = allRecords.filter(matchesFilters).sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

    const q = qInput.value.trim();
    const from = fromInput.value;
    const to = toInput.value;
    const fromLabel = from ? new Date(from + 'T00:00:00.000Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
    const toLabel = to ? new Date(to + 'T00:00:00.000Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
    const parts = [`${filtered.length} record${filtered.length === 1 ? '' : 's'}`];
    if (q) parts.push(`"${q}"`);
    if (from && to) parts.push(`${fromLabel} – ${toLabel}`);
    el('summaryLine').textContent = parts.join(' · ');

    const cov = computeCoverage(from, to, statusSelect.value);
    el('statCoverage').textContent = cov.pct === null ? '—' : `${cov.pct}%`;
    el('statCoverageSub').textContent = cov.total ? `${cov.have} of ${cov.total} scheduled stops recorded` : '';

    const secs = filtered.filter((r) => typeof r.captureMs === 'number').map((r) => r.captureMs / 1000);
    const med = median(secs);
    el('statMedian').textContent = med === null ? '—' : `${med.toFixed(1)}s`;
    el('statRecords').textContent = String(filtered.length);

    if (filtered.length === 0) {
      results.innerHTML = '<div class="empty-state">No records for that address in this range — widen the dates.</div>';
      return;
    }

    results.innerHTML = '';
    for (const r of filtered) {
      const linkT0 = t0 || Date.now();
      const a = document.createElement('a');
      a.className = 'result-row';
      a.href = `/p/${r.id}?t0=${linkT0}`;
      const d = new Date(r.capturedAt);
      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      a.innerHTML = `
        <img class="result-thumb" src="${esc(r.photoUrl)}" loading="lazy" alt="">
        <div class="result-main">
          <div class="result-address">${esc(r.address)}</div>
          <div class="result-meta">${esc(r.container || '—')} · ${dateStr} ${timeStr} · <span class="badge ${r.status}" style="padding:2px 8px; font-size:10px;">${STATUS_LABEL[r.status] || r.status}</span>${ticketSuffix(r)}</div>
          <div class="result-secs">${typeof r.captureMs === 'number' ? (r.captureMs / 1000).toFixed(1) + 's capture' : ''}</div>
        </div>`;
      results.appendChild(a);
    }
  }

  // Native <input type="date"> fires 'input' as focus moves between its internal
  // month/day/year segments (e.g. while tabbing through it), not just on a real value
  // change. Listening for 'input' there would rebuild the results list mid-tab and knock
  // keyboard focus off the row being navigated to, so date fields only re-filter on 'change'.
  const debouncedRender = debounce(render, 150);
  qInput.addEventListener('input', debouncedRender);
  [fromInput, toInput, statusSelect].forEach((elm) => elm.addEventListener('change', debouncedRender));

  Promise.all([
    fetch('/api/records').then((r) => r.json()),
    fetch('/api/schedule').then((r) => r.json()),
  ])
    .then(([recData, schedData]) => {
      allRecords = recData.records || [];
      schedule = schedData.stops || [];
      render();
    })
    .catch(() => {
      results.innerHTML = '<div class="empty-state">Could not load records.</div>';
    });
})();
