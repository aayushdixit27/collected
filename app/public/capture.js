(() => {
  const state = {
    schedule: [],
    address: '',
    container: null,
    stopSource: null, // 'route' | 'gps' | 'manual' | null
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
  const app = el('app');
  const stopLineReady = el('stopLineReady');
  const stopLinePhoto = el('stopLinePhoto');
  const stopAddressReady = el('stopAddressReady');
  const stopContainerReady = el('stopContainerReady');
  const stopAddressPhoto = el('stopAddressPhoto');
  const stopContainerPhoto = el('stopContainerPhoto');
  const otherStopBtn = el('otherStopBtn');
  const cameraInput = el('cameraInput');
  const photoFrame = el('photoFrame');
  const retakeBtn = el('retakeBtn');
  const saveBtn = el('saveBtn');
  const reasonRowEl = el('reasonRow');
  const statusRowEl = el('statusRow');
  const noteToggle = el('noteToggle');
  const noteInput = el('noteInput');
  const couldNotDisclosure = el('couldNotDisclosure');
  const stopDialog = el('stopDialog');
  const stopFilterInput = el('stopFilterInput');
  const stopDialogClose = el('stopDialogClose');
  const stopList = el('stopList');

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function markInteraction() {
    if (state.t0 === null) state.t0 = Date.now();
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ---- GPS (silent: no on-screen status until the saved screen) ----
  function setGpsUnavailable() {
    state.gpsFixed = false;
  }
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
    navigator.geolocation.getCurrentPosition(setGpsFixed, setGpsUnavailable, {
      enableHighAccuracy: true,
      timeout: 8000,
    });
    navigator.geolocation.watchPosition(setGpsFixed, () => {}, { enableHighAccuracy: true });
  } else {
    setGpsUnavailable();
  }

  function computeNearest() {
    if (!state.gps || state.schedule.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const s of state.schedule) {
      const d = haversineM(state.gps.lat, state.gps.lon, s.lat, s.lon);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best && bestDist <= 300 ? best : null;
  }

  function maybeAutoSelectNearest() {
    if (state.stopSource === 'manual') return;
    // Once a photo exists the stop is part of the record; GPS drift must not change it.
    if (app.dataset.state !== 'ready') return;
    const nearest = computeNearest();
    if (nearest) selectStop(nearest, 'gps');
  }

  // ---- schedule / stop selection ----
  function todayWeekday() {
    const d = new Date().getDay(); // 0 Sun .. 6 Sat
    return d === 0 ? 7 : d;
  }

  function todaysStops() {
    const wd = todayWeekday();
    return state.schedule.filter((s) => s.weekday === wd).sort((a, b) => a.routeOrder - b.routeOrder);
  }

  function updateStopViews() {
    const addrText = state.address ? state.address.split(',')[0] : 'No stops today — tap to search';
    stopAddressReady.textContent = addrText;
    stopAddressPhoto.textContent = addrText;
    stopContainerReady.textContent = state.container || '';
    stopContainerPhoto.textContent = state.container || '';
  }

  function selectStop(stop, source) {
    state.address = stop.address;
    state.container = stop.container || null;
    state.routeOrder = stop.routeOrder ?? null;
    state.stopSource = source;
    updateStopViews();
    updateSaveEnabled();
  }

  function defaultToRouteStop() {
    if (state.stopSource === 'manual') return;
    const today = todaysStops();
    if (today.length === 0) { updateStopViews(); return; }
    // Next in route order after the last stop saved this session; the first stop otherwise.
    const after = state.lastSavedRouteOrder;
    const next = after == null ? today[0] : (today.find((s) => s.routeOrder > after) || today[0]);
    selectStop(next, 'route');
  }

  // ---- stop overlay ----
  function renderStopList() {
    const q = stopFilterInput.value.trim().toLowerCase();
    stopList.innerHTML = '';
    if (q) {
      const matches = state.schedule
        .filter((s) => s.address.toLowerCase().includes(q) || s.container.toLowerCase().includes(q))
        .slice(0, 20);
      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'stop-list-empty';
        empty.textContent = 'No schedule match.';
        stopList.appendChild(empty);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'stop-list-item';
        btn.innerHTML = `<span class="addr">Use "${esc(stopFilterInput.value.trim())}" as address</span>`;
        btn.addEventListener('click', () => {
          selectStop({ address: stopFilterInput.value.trim(), container: null }, 'manual');
          closeStopDialog();
        });
        stopList.appendChild(btn);
        return;
      }
      matches.forEach((s) => appendStopItem(s, false));
      return;
    }
    const today = todaysStops();
    if (today.length === 0) {
      stopList.innerHTML = '<div class="stop-list-empty">No stops scheduled today. Search above.</div>';
      return;
    }
    const nearest = computeNearest();
    today.forEach((s) => appendStopItem(s, !!nearest && nearest.address === s.address && nearest.container === s.container));
  }

  function appendStopItem(s, isNearest) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stop-list-item';
    btn.innerHTML = `<span class="addr">${esc(s.address.split(',')[0])}${isNearest ? ' <span class="nearest-tag">· Nearest</span>' : ''}</span><span class="meta">${esc(s.container)}</span>`;
    btn.addEventListener('click', () => {
      selectStop(s, 'manual');
      closeStopDialog();
    });
    stopList.appendChild(btn);
  }

  function openStopDialog() {
    markInteraction();
    stopFilterInput.value = '';
    renderStopList();
    stopDialog.showModal();
    setTimeout(() => stopFilterInput.focus(), 0);
  }
  function closeStopDialog() {
    stopDialog.close();
  }

  stopLineReady.addEventListener('click', openStopDialog);
  stopLinePhoto.addEventListener('click', openStopDialog);
  otherStopBtn.addEventListener('click', openStopDialog);
  stopDialogClose.addEventListener('click', closeStopDialog);
  stopFilterInput.addEventListener('input', renderStopList);

  // ---- camera / downscale ----
  cameraInput.addEventListener('click', markInteraction);
  cameraInput.addEventListener('change', cameraChangeHandler);
  retakeBtn.addEventListener('click', () => {
    markInteraction();
    cameraInput.click();
  });

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
    photoFrame.innerHTML = `<img src="${url}" alt="Captured photo">`;
    app.dataset.state = 'photo';
    updateSaveEnabled();
    e.target.value = ''; // allow re-selecting the same file on a retake
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
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
            'image/jpeg',
            quality
          );
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---- could-not-service disclosure: reasons + delivered/removed ----
  reasonRowEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-reason]');
    if (!btn) return;
    markInteraction();
    state.status = 'not_collected';
    state.reason = btn.dataset.reason;
    [...reasonRowEl.children].forEach((c) => c.classList.toggle('selected', c === btn));
    [...statusRowEl.children].forEach((c) => c.classList.remove('selected'));
  });

  statusRowEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    markInteraction();
    state.status = btn.dataset.status;
    state.reason = null;
    [...statusRowEl.children].forEach((c) => c.classList.toggle('selected', c === btn));
    [...reasonRowEl.children].forEach((c) => c.classList.remove('selected'));
  });

  // ---- note ----
  noteToggle.addEventListener('click', () => {
    noteInput.classList.toggle('hidden');
    if (!noteInput.classList.contains('hidden')) noteInput.focus();
  });
  noteInput.addEventListener('input', () => {
    state.note = noteInput.value;
  });

  // ---- save enable ----
  function updateSaveEnabled() {
    saveBtn.disabled = !(state.photoBlob && state.address && state.address.trim());
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = reader.result;
        resolve(s.substring(s.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function waitForGps(maxMs) {
    if (state.gpsFixed) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        if (state.gpsFixed || Date.now() - started >= maxMs) {
          clearInterval(iv);
          resolve();
        }
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
      showSaved(data.url, captureMs, !!payload.gps);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      alert('Could not save. Check your connection and try again.');
    }
  });

  function showSaved(url, ms, hadGps) {
    app.dataset.state = 'saved';
    if (state.routeOrder != null) state.lastSavedRouteOrder = state.routeOrder;
    el('elapsedText').textContent = `Recorded in ${(ms / 1000).toFixed(1)}s`;
    el('proofUrlText').textContent = location.origin + url;
    el('gpsWarning').classList.toggle('hidden', hadGps);
    el('copyLinkBtn').onclick = () => {
      navigator.clipboard?.writeText(location.origin + url);
      el('copyLinkBtn').textContent = 'Copied';
      setTimeout(() => (el('copyLinkBtn').textContent = 'Copy link'), 1500);
    };
    const shareBtn = el('shareBtn');
    if (navigator.share) {
      shareBtn.classList.remove('hidden');
      shareBtn.onclick = () => navigator.share({ title: 'Collected', url: location.origin + url }).catch(() => {});
    }
    el('nextStopBtn').onclick = resetForm;
  }

  function resetForm() {
    state.address = '';
    state.container = null;
    state.stopSource = null;
    state.photoBlob = null;
    state.status = 'collected';
    state.reason = null;
    state.note = '';
    state.t0 = null;
    state.capturedAt = null;
    noteInput.value = '';
    noteInput.classList.add('hidden');
    couldNotDisclosure.open = false;
    [...reasonRowEl.children, ...statusRowEl.children].forEach((c) => c.classList.remove('selected'));
    photoFrame.innerHTML = '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Save';
    app.dataset.state = 'ready';
    defaultToRouteStop();
    maybeAutoSelectNearest();
  }

  fetch('/api/schedule')
    .then((r) => r.json())
    .then((data) => {
      state.schedule = data.stops || [];
      defaultToRouteStop();
      maybeAutoSelectNearest();
    })
    .catch(() => {
      stopAddressReady.textContent = 'Could not load schedule.';
      stopAddressPhoto.textContent = 'Could not load schedule.';
    });
})();
