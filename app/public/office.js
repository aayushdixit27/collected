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
    if (status && r.status !== status) return false;
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
    // index records (ignoring the free-text query, respecting the status filter) by
    // address|container|date for a fast membership check
    const key = (address, container, date) => `${address}||${container}||${date}`;
    const recordDays = new Set();
    for (const r of allRecords) {
      if (statusFilter && r.status !== statusFilter) continue;
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
      // Coverage counts completed days only; today's records show in the list, not here.
      if (dateStr >= todayStr) continue;
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

    const from = fromInput.value;
    const to = toInput.value;

    const cov = computeCoverage(from, to, statusSelect.value);
    el('statCoverage').textContent = cov.pct === null ? '—' : `${cov.pct}% of scheduled stops recorded`;

    const secs = filtered.filter((r) => typeof r.captureMs === 'number').map((r) => r.captureMs / 1000);
    const med = median(secs);
    el('statMedian').textContent = med === null ? '' : `${med.toFixed(1)}s median capture`;
    el('statRecords').textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;

    const tbody = el('resultsTbody');
    const list = el('resultsList');

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      list.innerHTML = `<div class="empty-state">No records for that address in this range. Widen the dates.<span class="tagline">Collected · proof that the truck came</span></div>`;
      return;
    }

    tbody.innerHTML = '';
    list.innerHTML = '';
    const linkT0 = t0 || Date.now();

    for (const r of filtered) {
      const href = `/p/${r.id}?t0=${linkT0}`;
      const d = new Date(r.capturedAt);
      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const captureStr = typeof r.captureMs === 'number' ? (r.captureMs / 1000).toFixed(1) + 's' : '—';
      const statusLabel = STATUS_LABEL[r.status] || r.status;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><img class="thumb" src="${esc(r.photoUrl)}" loading="lazy" alt=""></td>
        <td><a href="${href}">${esc(r.address)}</a></td>
        <td class="mono">${esc(r.container || '—')}</td>
        <td>${dateStr}, ${timeStr}</td>
        <td><span class="badge ${r.status}">${statusLabel}</span></td>
        <td class="mono">${captureStr}</td>`;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        window.location.href = href;
      });
      tbody.appendChild(tr);

      const a = document.createElement('a');
      a.className = 'result-row';
      a.href = href;
      a.innerHTML = `
        <div class="result-address">${esc(r.address)}</div>
        <div class="result-meta"><span class="mono">${esc(r.container || '—')}</span> · ${dateStr} ${timeStr} · <span class="badge ${r.status}">${statusLabel}</span> · <span class="mono">${captureStr}</span></div>`;
      list.appendChild(a);
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
