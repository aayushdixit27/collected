(() => {
  const state = {
    schedule: [],
    todayRecords: [], // records captured today, for the route progress line
    address: '',
    container: null,
    routeOrder: null,
    stopSource: null, // 'gps' | 'route' | 'manual'
    photoBlob: null,
    status: 'collected',
    reason: null,
    note: '',
    gps: null, // {lat, lon, accuracyM}
    gpsFixed: false,
    t0: null,
    capturedAt: null,
  };

  const el = (id) => document.getElementById(id);
  const captureView = el('captureView');
  const confirmView = el('confirmView');
  const heroWrap = el('heroWrap');
  const statusRow = el('statusRow');
  const reasonRow = el('reasonRow');
  const noteToggle = el('noteToggle');
  const noteInput = el('noteInput');
  const saveBtn = el('saveBtn');
  const stopDialog = el('stopDialog');
  const addressInput = el('addressInput');
  const stopList = el('stopList');

  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function markInteraction() {
    if (state.t0 === null) state.t0 = Date.now();
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ---- GPS: best effort, never blocks, never mentioned until the saved screen ----
  function setGpsFixed(pos) {
    state.gps = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracyM: Math.round(pos.coords.accuracy || 0),
    };
    state.gpsFixed = true;
    maybeAutoSelectNearest();
  }
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(setGpsFixed, () => {}, { enableHighAccuracy: true, timeout: 8000 });
    navigator.geolocation.watchPosition(setGpsFixed, () => {}, { enableHighAccuracy: true });
  }

  function maybeAutoSelectNearest() {
    // Never re-select under a taken photo, and never over a stop the driver chose by hand.
    if (state.photoBlob || state.stopSource === 'manual' || !state.gps || state.schedule.length === 0) return;
    let best = null;
    let bestDist = Infinity;
    for (const s of state.schedule) {
      const d = haversineM(state.gps.lat, state.gps.lon, s.lat, s.lon);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (best && bestDist <= 300) selectStop(best, 'gps');
  }

  // ---- route ----
  function todayWeekday() {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  }
  function todaysStops() {
    const wd = todayWeekday();
    return state.schedule.filter((s) => s.weekday === wd).sort((a, b) => a.routeOrder - b.routeOrder);
  }
  function localDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function recordedToday(stop) {
    const today = localDate(new Date().toISOString());
    return state.todayRecords.some((r) => r.address === stop.address && localDate(r.capturedAt) === today);
  }

  function renderRoute() {
    const now = new Date();
    el('dayLine').textContent = `${DAY_SHORT[now.getDay()]} ${now.getDate()} ${MONTH_SHORT[now.getMonth()]}`;
    const today = todaysStops();
    const segs = el('routeSegs');
    segs.innerHTML = '';
    if (today.length === 0) {
      el('routePos').textContent = 'No scheduled stops today';
      el('routeDone').textContent = '';
      return;
    }
    const done = today.filter(recordedToday).length;
    const current = today.find((s) => s.address === state.address);
    el('routePos').innerHTML = current
      ? `<b>Stop ${current.routeOrder}</b> of ${today.length}`
      : `<b>${today.length} stops</b> today`;
    el('routeDone').textContent = `${done} recorded · ${today.length - done} to go`;
    today.forEach((s) => {
      const i = document.createElement('i');
      if (recordedToday(s)) i.className = 'done';
      else if (current && s.address === current.address) i.className = 'now';
      segs.appendChild(i);
    });
  }

  function selectStop(stop, source) {
    state.address = stop.address;
    state.container = stop.container || null;
    state.routeOrder = stop.routeOrder ?? null;
    state.stopSource = source;
    renderStopCard();
    renderRoute();
    updateSaveEnabled();
  }

  function selectFreeText(text) {
    state.address = text;
    state.container = null;
    state.routeOrder = null;
    state.stopSource = 'manual';
    renderStopCard();
    renderRoute();
    updateSaveEnabled();
  }

  function renderStopCard() {
    const addr = el('stopAddr');
    const meta = el('stopMeta');
    if (!state.address) {
      addr.textContent = 'Choose a stop';
      meta.textContent = "Tap to pick from today's route or search";
      return;
    }
    const parts = state.address.split(',');
    addr.textContent = parts[0].trim();
    const rest = parts.slice(1).join(',').trim();
    meta.innerHTML = '';
    if (rest) meta.append(rest);
    if (state.container) {
      if (rest) meta.append(' · ');
      const code = document.createElement('code');
      code.textContent = state.container;
      meta.appendChild(code);
    }
  }

  function defaultToRouteStop() {
    if (state.stopSource === 'manual' || state.stopSource === 'gps') return;
    const today = todaysStops();
    if (today.length === 0) { renderStopCard(); renderRoute(); return; }
    // First stop of the day without a record yet; else the first stop.
    const next = today.find((s) => !recordedToday(s)) || today[0];
    selectStop(next, 'route');
  }

  // ---- stop picker ----
  function renderStopList() {
    const q = addressInput.value.trim().toLowerCase();
    stopList.innerHTML = '';
    const pool = q
      ? state.schedule.filter((s) => `${s.address} ${s.container}`.toLowerCase().includes(q))
      : todaysStops();
    el('pickerLabel').textContent = q ? 'Matching stops' : "Today's route";
    pool.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'picker-item' + (s.address === state.address ? ' current' : '');
      const done = recordedToday(s);
      b.innerHTML = `<span class="pi-addr"></span><span class="pi-meta"></span>${done ? '<span class="pi-done">recorded</span>' : ''}`;
      b.querySelector('.pi-addr').textContent = s.address.split(',')[0];
      b.querySelector('.pi-meta').textContent = `${s.address.split(',').slice(1).join(',').trim()} · ${s.container}`;
      b.addEventListener('click', () => {
        markInteraction();
        selectStop(s, 'manual');
        stopDialog.close();
      });
      stopList.appendChild(b);
    });
    if (q && !pool.some((s) => s.address.toLowerCase() === q)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'picker-item free';
      b.textContent = `Use "${addressInput.value.trim()}" as the address`;
      b.addEventListener('click', () => {
        markInteraction();
        selectFreeText(addressInput.value.trim());
        stopDialog.close();
      });
      stopList.appendChild(b);
    }
    if (pool.length === 0 && !q) {
      stopList.innerHTML = '<div class="picker-empty">No stops scheduled today. Search by address or container.</div>';
    }
  }
  el('stopCard').addEventListener('click', () => {
    markInteraction();
    addressInput.value = '';
    renderStopList();
    stopDialog.showModal();
    addressInput.focus();
  });
  el('pickerClose').addEventListener('click', () => stopDialog.close());
  addressInput.addEventListener('input', renderStopList);
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && addressInput.value.trim()) {
      e.preventDefault();
      const first = stopList.querySelector('.picker-item');
      if (first) first.click();
    }
  });

  // ---- camera / downscale ----
  function wireCameraInput() {
    const input = el('cameraInput');
    if (!input) return;
    input.addEventListener('click', markInteraction);
    input.addEventListener('change', cameraChangeHandler);
  }
  const heroEmptyHtml = heroWrap.innerHTML;

  function resetCamera() {
    state.photoBlob = null;
    heroWrap.innerHTML = heroEmptyHtml;
    heroWrap.classList.remove('has-photo');
    wireCameraInput();
    updateSaveEnabled();
  }

  async function cameraChangeHandler(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    state.capturedAt = new Date().toISOString();
    let blob;
    try {
      blob = await downscaleImage(file, 1400, 0.72);
    } catch {
      blob = file;
    }
    state.photoBlob = blob;
    const url = URL.createObjectURL(blob);
    heroWrap.classList.add('has-photo');
    heroWrap.innerHTML = `<img class="hero-photo" src="${url}" alt="Captured photo"><button type="button" class="retake" id="retakeBtn">Retake</button>`;
    el('retakeBtn').addEventListener('click', resetCamera);
    updateSaveEnabled();
  }

  function downscaleImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxEdge) {
            height = Math.round((height * maxEdge) / width);
            width = maxEdge;
          } else if (height >= width && height > maxEdge) {
            width = Math.round((width * maxEdge) / height);
            height = maxEdge;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  wireCameraInput();

  // ---- status / reasons ----
  statusRow.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    markInteraction();
    state.status = btn.dataset.status;
    [...statusRow.children].forEach((c) => {
      const on = c === btn;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    reasonRow.classList.toggle('hidden', state.status !== 'not_collected');
    if (state.status !== 'not_collected') state.reason = null;
  });
  reasonRow.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-reason]');
    if (!btn) return;
    state.reason = btn.dataset.reason;
    [...reasonRow.children].forEach((c) => c.classList.toggle('on', c === btn));
  });

  // ---- note ----
  noteToggle.addEventListener('click', () => {
    noteInput.classList.toggle('hidden');
    if (!noteInput.classList.contains('hidden')) noteInput.focus();
  });
  noteInput.addEventListener('input', () => { state.note = noteInput.value; });

  // ---- save ----
  function updateSaveEnabled() {
    saveBtn.disabled = !(state.photoBlob && state.address && state.address.trim());
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const s = reader.result; resolve(s.substring(s.indexOf(',') + 1)); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function waitForGps(maxMs) {
    if (state.gpsFixed) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        if (state.gpsFixed || Date.now() - started >= maxMs) { clearInterval(iv); resolve(); }
      }, 100);
    });
  }

  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    markInteraction();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    await waitForGps(2500);
    const captureMs = Date.now() - (state.t0 || Date.now());
    try {
      const photoBase64 = await blobToBase64(state.photoBlob);
      const payload = {
        address: state.address,
        container: state.container,
        status: state.status,
        reason: state.status === 'not_collected' ? state.reason : null,
        note: state.note,
        capturedAt: state.capturedAt || new Date().toISOString(),
        gps: state.gpsFixed ? state.gps : null,
        captureMs,
        photo: photoBase64,
      };
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');
      const data = await res.json();
      state.todayRecords.push({ address: payload.address, capturedAt: payload.capturedAt });
      showConfirm(data.url, captureMs);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save record';
      alert('Could not save. Check your connection and try again.');
    }
  });

  function showConfirm(url, ms) {
    captureView.classList.add('hidden');
    confirmView.classList.remove('hidden');
    el('elapsedText').textContent = `Recorded in ${(ms / 1000).toFixed(1)}s`;
    el('savedStop').textContent = state.address.split(',')[0] + (state.container ? ` · ${state.container}` : '');
    el('proofUrlText').textContent = location.origin + url;
    el('gpsWarning').classList.toggle('hidden', !!state.gps);
    el('copyLinkBtn').onclick = () => {
      navigator.clipboard?.writeText(location.origin + url);
      el('copyLinkBtn').textContent = 'Copied';
      setTimeout(() => (el('copyLinkBtn').textContent = 'Copy link'), 1500);
    };
    const shareBtn = el('shareBtn');
    if (navigator.share) {
      shareBtn.classList.remove('hidden');
      shareBtn.onclick = () => navigator.share({ title: 'Collected — service record', url: location.origin + url }).catch(() => {});
    }
    el('nextStopBtn').onclick = resetForNext;
  }

  function resetForNext() {
    state.address = '';
    state.container = null;
    state.routeOrder = null;
    state.stopSource = null;
    state.photoBlob = null;
    state.status = 'collected';
    state.reason = null;
    state.note = '';
    state.t0 = null;
    state.capturedAt = null;
    noteInput.value = '';
    noteInput.classList.add('hidden');
    [...statusRow.children].forEach((c, i) => {
      c.classList.toggle('on', i === 0);
      c.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
    });
    reasonRow.classList.add('hidden');
    [...reasonRow.children].forEach((c) => c.classList.remove('on'));
    resetCamera();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Save record';
    confirmView.classList.add('hidden');
    captureView.classList.remove('hidden');
    defaultToRouteStop();
    maybeAutoSelectNearest();
  }

  // ---- boot ----
  renderRoute();
  fetch('/api/schedule')
    .then((r) => r.json())
    .then((data) => {
      state.schedule = data.stops || [];
      return fetch('/api/records').then((r) => r.json()).catch(() => ({ records: [] }));
    })
    .then((data) => {
      const today = localDate(new Date().toISOString());
      state.todayRecords = (data.records || [])
        .filter((r) => localDate(r.capturedAt) === today)
        .map((r) => ({ address: r.address, capturedAt: r.capturedAt }));
      defaultToRouteStop();
      maybeAutoSelectNearest();
      renderRoute();
    })
    .catch(() => {
      el('stopAddr').textContent = 'Could not load the route';
      el('stopMeta').textContent = 'Search by address or container.';
    });
})();
