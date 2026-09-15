(() => {
  const state = {
    schedule: [],
    address: '',
    container: null,
    photoBlob: null,
    status: 'collected',
    reason: null,
    note: '',
    gps: null, // {lat, lon, accuracyM}
    gpsFixed: false,
    t0: null,
  };

  const el = (id) => document.getElementById(id);
  const gpsDot = el('gpsDot');
  const gpsText = el('gpsText');
  const chipRow = el('chipRow');
  const addressInput = el('addressInput');
  const suggestions = el('suggestions');
  const containerChipWrap = el('containerChipWrap');
  const cameraWrap = el('cameraWrap');
  const cameraInput = el('cameraInput');
  const statusRow = el('statusRow');
  const reasonRow = el('reasonRow');
  const noteToggle = el('noteToggle');
  const noteInput = el('noteInput');
  const saveBtn = el('saveBtn');
  const captureView = el('captureView');
  const confirmView = el('confirmView');

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

  // ---- GPS ----
  function setGpsUnavailable() {
    gpsDot.className = 'gps-dot unavailable';
    gpsText.textContent = 'GPS unavailable';
  }
  function setGpsFixed(pos) {
    state.gps = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracyM: Math.round(pos.coords.accuracy || 0),
    };
    state.gpsFixed = true;
    gpsDot.className = 'gps-dot fixed';
    gpsText.textContent = `GPS fixed ±${state.gps.accuracyM}m`;
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

  function maybeAutoSelectNearest() {
    if (state.address || !state.gps || state.schedule.length === 0) return;
    let best = null;
    let bestDist = Infinity;
    for (const s of state.schedule) {
      const d = haversineM(state.gps.lat, state.gps.lon, s.lat, s.lon);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (best && bestDist <= 300) selectStop(best);
  }

  // ---- schedule / chips ----
  function todayWeekday() {
    const d = new Date().getDay(); // 0 Sun .. 6 Sat
    return d === 0 ? 7 : d;
  }

  function renderChips() {
    const wd = todayWeekday();
    const today = state.schedule.filter((s) => s.weekday === wd).sort((a, b) => a.routeOrder - b.routeOrder);
    chipRow.innerHTML = '';
    if (today.length === 0) {
      chipRow.innerHTML = '<span style="color:var(--text-dim); font-size:13px;">No stops scheduled today — search by address or container.</span>';
      return;
    }
    today.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.innerHTML = `${s.address.split(',')[0]} <small>${s.container}</small>`;
      btn.addEventListener('click', () => {
        markInteraction();
        selectStop(s);
      });
      chipRow.appendChild(btn);
    });
  }

  function selectStop(stop) {
    state.address = stop.address;
    state.container = stop.container;
    addressInput.value = stop.address;
    renderContainerChip();
    suggestions.classList.add('hidden');
    updateSaveEnabled();
  }

  function renderContainerChip() {
    if (!state.container) {
      containerChipWrap.innerHTML = '';
      return;
    }
    containerChipWrap.innerHTML = `<span class="container-chip">${state.container} <button type="button" id="clearContainer" aria-label="Clear container">×</button></span>`;
    el('clearContainer').addEventListener('click', () => {
      state.container = null;
      renderContainerChip();
    });
  }

  // ---- suggestions ----
  addressInput.addEventListener('focus', markInteraction);
  addressInput.addEventListener('input', () => {
    markInteraction();
    state.address = addressInput.value;
    updateSaveEnabled();
    const q = addressInput.value.trim().toLowerCase();
    if (!q) {
      suggestions.classList.add('hidden');
      return;
    }
    const matches = state.schedule
      .filter((s) => s.address.toLowerCase().includes(q) || s.container.toLowerCase().includes(q))
      .slice(0, 6);
    if (matches.length === 0) {
      suggestions.classList.add('hidden');
      return;
    }
    suggestions.innerHTML = '';
    matches.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${s.address} — ${s.container}`;
      btn.addEventListener('click', () => selectStop(s));
      suggestions.appendChild(btn);
    });
    suggestions.classList.remove('hidden');
  });

  // ---- camera / downscale ----
  function resetCamera() {
    state.photoBlob = null;
    cameraWrap.innerHTML = `<label class="camera-btn" id="cameraBtn">📷 Take photo<input id="cameraInput" type="file" accept="image/*" capture="environment"></label>`;
    rewireCameraInput();
    updateSaveEnabled();
  }

  function rewireCameraInput() {
    const input = document.getElementById('cameraInput');
    input.addEventListener('click', markInteraction);
    input.addEventListener('change', cameraChangeHandler);
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
    cameraWrap.innerHTML = `<img class="photo-preview" src="${url}" alt="Captured photo"><button type="button" class="retake" id="retakeBtn">Retake photo</button>`;
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

  // ---- status / reason chips ----
  statusRow.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    markInteraction();
    state.status = btn.dataset.status;
    [...statusRow.children].forEach((c) => c.classList.toggle('selected', c === btn));
    reasonRow.classList.toggle('hidden', state.status !== 'not_collected');
    if (state.status !== 'not_collected') state.reason = null;
  });

  reasonRow.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-reason]');
    if (!btn) return;
    state.reason = btn.dataset.reason;
    [...reasonRow.children].forEach((c) => c.classList.toggle('selected', c === btn));
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
      showConfirm(data.url, captureMs);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      alert('Could not save. Check your connection and try again.');
    }
  });

  function showConfirm(url, ms) {
    captureView.classList.add('hidden');
    confirmView.classList.remove('hidden');
    el('elapsedText').textContent = `Recorded in ${(ms / 1000).toFixed(1)}s`;
    el('proofUrlText').textContent = location.origin + url;
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
    state.photoBlob = null;
    state.status = 'collected';
    state.reason = null;
    state.note = '';
    state.t0 = null;
    addressInput.value = '';
    noteInput.value = '';
    noteInput.classList.add('hidden');
    reasonRow.classList.add('hidden');
    [...statusRow.children].forEach((c) => c.classList.toggle('selected', c.dataset.status === 'collected'));
    renderContainerChip();
    resetCamera();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Save';
    confirmView.classList.add('hidden');
    captureView.classList.remove('hidden');
    maybeAutoSelectNearest();
  }

  // wire the initial camera input (the one in the HTML) once DOM is ready
  rewireCameraInput();

  fetch('/api/schedule')
    .then((r) => r.json())
    .then((data) => {
      state.schedule = data.stops || [];
      renderChips();
      maybeAutoSelectNearest();
    })
    .catch(() => {
      chipRow.innerHTML = '<span style="color:var(--red); font-size:13px;">Could not load schedule.</span>';
    });
})();
