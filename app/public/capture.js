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

  // ---- ticket screen ----
  const ticketView = el('ticketView');
  const ticketFormWrap = el('ticketFormWrap');
  const ticketSavedWrap = el('ticketSavedWrap');
  const ticketHeroWrap = el('ticketHeroWrap');
  const netLbInput = el('netLbInput');
  const grossInput = el('grossInput');
  const tareInput = el('tareInput');
  const facilityInput = el('facilityInput');
  const moreToggle = el('moreToggle');
  const moreBlock = el('moreBlock');
  const ticketSaveBtn = el('ticketSaveBtn');
  const ticketError = el('ticketError');
  const awaitingRow = el('awaitingRow');
  const awaitingDialog = el('awaitingDialog');
  const awaitingList = el('awaitingList');
  const ticketState = {
    recordId: null,
    address: '',
    container: null,
    pricing: null,
    photoBlob: null,
    t0: null,
  };

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
  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // ---- awaiting a scale ticket ----
  function awaitingTickets() {
    return state.todayRecords.filter(
      (r) => r.status === 'collected' && r.container && r.container.startsWith('RO-') && !r.ticket
    );
  }
  function renderAwaiting() {
    const list = awaitingTickets();
    if (list.length === 0) {
      awaitingRow.classList.add('hidden');
      return;
    }
    awaitingRow.classList.remove('hidden');
    el('awaitingText').textContent = `${list.length} ${list.length === 1 ? 'pull' : 'pulls'} awaiting a scale ticket`;
  }
  function renderAwaitingList() {
    const list = awaitingTickets();
    awaitingList.innerHTML = '';
    list.forEach((r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'picker-item';
      b.innerHTML = '<span class="pi-addr"></span><span class="pi-meta"></span>';
      const parts = r.address.split(',');
      const rest = parts.slice(1).join(',').trim();
      b.querySelector('.pi-addr').textContent = parts[0].trim();
      b.querySelector('.pi-meta').textContent = `${rest}${rest ? ' · ' : ''}${r.container} · picked up ${formatTime(r.capturedAt)}`;
      b.addEventListener('click', () => {
        awaitingDialog.close();
        openTicketView(r);
      });
      awaitingList.appendChild(b);
    });
  }
  awaitingRow.addEventListener('click', () => {
    renderAwaitingList();
    awaitingDialog.showModal();
  });
  el('awaitingClose').addEventListener('click', () => awaitingDialog.close());

  function renderRoute() {
    const now = new Date();
    el('dayLine').textContent = `${DAY_SHORT[now.getDay()]} ${now.getDate()} ${MONTH_SHORT[now.getMonth()]}`;
    const today = todaysStops();
    const segs = el('routeSegs');
    segs.innerHTML = '';
    renderAwaiting();
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

  // ---- ticket photo / downscale (mirrors the pickup camera above) ----
  function wireTicketCameraInput() {
    const input = el('ticketCameraInput');
    if (!input) return;
    input.addEventListener('click', markTicketInteraction);
    input.addEventListener('change', ticketCameraChangeHandler);
  }
  const ticketHeroEmptyHtml = ticketHeroWrap.innerHTML;

  function resetTicketCamera() {
    ticketState.photoBlob = null;
    ticketHeroWrap.innerHTML = ticketHeroEmptyHtml;
    ticketHeroWrap.classList.remove('has-photo');
    wireTicketCameraInput();
    updateTicketSaveEnabled();
  }

  async function ticketCameraChangeHandler(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    let blob;
    try {
      blob = await downscaleImage(file, 1400, 0.72);
    } catch {
      blob = file;
    }
    ticketState.photoBlob = blob;
    const url = URL.createObjectURL(blob);
    ticketHeroWrap.classList.add('has-photo');
    ticketHeroWrap.innerHTML = `<img class="hero-photo" src="${url}" alt="Ticket photo"><button type="button" class="retake" id="ticketRetakeBtn">Retake</button>`;
    el('ticketRetakeBtn').addEventListener('click', resetTicketCamera);
    updateTicketSaveEnabled();
  }

  // ---- ticket screen wiring ----
  function markTicketInteraction() {
    if (ticketState.t0 === null) ticketState.t0 = Date.now();
  }
  ['input', 'click', 'focus'].forEach((ev) => {
    ticketFormWrap.addEventListener(ev, markTicketInteraction, true);
  });

  function validNet(v) {
    if (!/^[0-9]+$/.test(v)) return false;
    const n = parseInt(v, 10);
    return n >= 1 && n <= 80000;
  }
  function updateTicketSaveEnabled() {
    ticketSaveBtn.disabled = !(ticketState.photoBlob && validNet(netLbInput.value.trim()));
  }
  netLbInput.addEventListener('input', updateTicketSaveEnabled);

  moreToggle.addEventListener('click', () => {
    const opening = moreBlock.classList.contains('hidden');
    moreBlock.classList.toggle('hidden');
    moreToggle.textContent = opening ? '− Gross / tare / facility' : '+ Gross / tare / facility';
  });

  function renderTicketHeader(record) {
    const now = new Date();
    el('ticketDayLine').textContent = `${DAY_SHORT[now.getDay()]} ${now.getDate()} ${MONTH_SHORT[now.getMonth()]}`;
    const today = todaysStops();
    const stop = today.find((s) => s.address === record.address || (record.container && s.container === record.container));
    el('ticketRoutePos').innerHTML = stop
      ? `<b>Scale ticket</b> · stop ${stop.routeOrder} of ${today.length}`
      : '<b>Scale ticket</b>';
    el('ticketPickedUp').textContent = record.capturedAt ? `picked up ${formatTime(record.capturedAt)}` : '';
    const parts = (record.address || '').split(',');
    el('ticketAddr').textContent = parts[0].trim();
    const rest = parts.slice(1).join(',').trim();
    const meta = el('ticketMeta');
    meta.innerHTML = '';
    if (rest) meta.append(rest);
    if (record.container) {
      if (rest) meta.append(' · ');
      const code = document.createElement('code');
      code.textContent = record.container;
      meta.appendChild(code);
    }
  }

  function resetTicketForm() {
    netLbInput.value = '';
    grossInput.value = '';
    tareInput.value = '';
    facilityInput.value = '';
    moreBlock.classList.add('hidden');
    moreToggle.textContent = '+ Gross / tare / facility';
    ticketError.classList.add('hidden');
    ticketError.textContent = '';
    ticketSaveBtn.disabled = true;
    ticketSaveBtn.textContent = 'Save ticket';
    ticketState.t0 = null;
    resetTicketCamera();
  }

  function openTicketView(record) {
    ticketState.recordId = record.id;
    ticketState.address = record.address;
    ticketState.container = record.container || null;
    ticketState.pricing = record.pricing || null;
    resetTicketForm();
    renderTicketHeader(record);
    captureView.classList.add('hidden');
    confirmView.classList.add('hidden');
    ticketSavedWrap.classList.add('hidden');
    ticketFormWrap.classList.remove('hidden');
    ticketView.classList.remove('hidden');
  }

  function showTicketError(status) {
    let msg;
    if (status === 409) msg = 'This pull already has a ticket.';
    else if (status === 400) msg = 'Check the photo and the net weight.';
    else if (status === 404) msg = 'That record no longer exists.';
    else msg = 'Could not save. Check your connection and try again.';
    ticketError.textContent = msg;
    ticketError.classList.remove('hidden');
  }

  function showTicketSaved(url, netLb, pricing) {
    ticketFormWrap.classList.add('hidden');
    ticketSavedWrap.classList.remove('hidden');
    const includedLb = pricing && typeof pricing.includedLb === 'number' ? pricing.includedLb : 2000;
    const overLb = Math.max(0, netLb - includedLb);
    let headline = `Ticket tied · ${netLb.toLocaleString()} lb`;
    if (overLb > 0) headline += ` · ${overLb.toLocaleString()} lb over`;
    el('ticketSavedHeadline').textContent = headline;
    el('ticketSavedSub').textContent =
      ticketState.address.split(',')[0].trim() + (ticketState.container ? ` · ${ticketState.container}` : '');
    el('ticketProofUrlText').textContent = location.origin + url;
    el('ticketCopyLinkBtn').onclick = () => {
      navigator.clipboard?.writeText(location.origin + url);
      el('ticketCopyLinkBtn').textContent = 'Copied';
      setTimeout(() => (el('ticketCopyLinkBtn').textContent = 'Copy link'), 1500);
    };
    el('ticketDoneBtn').onclick = () => {
      ticketView.classList.add('hidden');
      resetForNext();
    };
  }

  ticketSaveBtn.addEventListener('click', async () => {
    if (ticketSaveBtn.disabled) return;
    markTicketInteraction();
    ticketSaveBtn.disabled = true;
    ticketSaveBtn.textContent = 'Saving…';
    ticketError.classList.add('hidden');
    const ticketMs = Date.now() - (ticketState.t0 || Date.now());
    const netLb = parseInt(netLbInput.value.trim(), 10);
    try {
      const photoBase64 = await blobToBase64(ticketState.photoBlob);
      const payload = {
        photo: photoBase64,
        netLb,
        grossLb: grossInput.value.trim() ? parseInt(grossInput.value.trim(), 10) : null,
        tareLb: tareInput.value.trim() ? parseInt(tareInput.value.trim(), 10) : null,
        facility: facilityInput.value.trim() || null,
        weighedAt: new Date().toISOString(),
        gps: state.gpsFixed ? state.gps : null,
        ticketMs,
      };
      const res = await fetch(`/api/records/${ticketState.recordId}/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const status = res.status;
      const data = await res.json().catch(() => ({}));
      if (status < 200 || status >= 300) {
        showTicketError(status);
        ticketSaveBtn.disabled = false;
        ticketSaveBtn.textContent = 'Save ticket';
        return;
      }
      const rec = state.todayRecords.find((r) => r.id === ticketState.recordId);
      if (rec) rec.ticket = { netLb };
      renderAwaiting();
      showTicketSaved(data.url, netLb, ticketState.pricing);
    } catch (err) {
      showTicketError(0);
      ticketSaveBtn.disabled = false;
      ticketSaveBtn.textContent = 'Save ticket';
    }
  });

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
      state.todayRecords.push({
        id: data.id,
        address: payload.address,
        capturedAt: payload.capturedAt,
        container: payload.container,
        status: payload.status,
        ticket: null,
        pricing: null,
      });
      showConfirm(data.id, data.url, captureMs);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save record';
      alert('Could not save. Check your connection and try again.');
    }
  });

  function showConfirm(id, url, ms) {
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
    const addTicketBtn = el('addTicketBtn');
    const eligible = state.status === 'collected' && !!state.container && state.container.startsWith('RO-');
    addTicketBtn.classList.toggle('hidden', !eligible);
    if (eligible) {
      const savedRecord = {
        id,
        address: state.address,
        container: state.container,
        status: state.status,
        capturedAt: state.capturedAt || new Date().toISOString(),
        ticket: null,
        pricing: null,
      };
      addTicketBtn.onclick = () => openTicketView(savedRecord);
    }
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
        .map((r) => ({
          id: r.id,
          address: r.address,
          capturedAt: r.capturedAt,
          container: r.container,
          status: r.status,
          ticket: r.ticket || null,
          pricing: r.pricing || null,
        }));
      defaultToRouteStop();
      maybeAutoSelectNearest();
      renderRoute();
    })
    .catch(() => {
      el('stopAddr').textContent = 'Could not load the route';
      el('stopMeta').textContent = 'Search by address or container.';
    });
})();
