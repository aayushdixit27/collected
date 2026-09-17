(() => {
  const state = {
    schedule: [],
    todayRecords: [], // records captured today, for the route progress line
    mode: 'capture', // 'capture' | 'addLater'
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
    ticketPhotoBlob: null,
    ticketT0: null,
  };

  // ---- add-later mode: opening this same screen for a record awaiting a ticket ----
  const laState = {
    record: null, // {id, address, container, status, capturedAt, photoUrl, pricing}
    photoBlob: null,
    t0: null,
    returnTo: null, // 'capture' | 'confirm' — which view to restore on Back
  };

  const el = (id) => document.getElementById(id);
  const captureView = el('captureView');
  const confirmView = el('confirmView');
  const backBtn = el('backBtn');
  const heroWrap = el('heroWrap');
  const statusBlock = el('statusBlock');
  const statusStaticBlock = el('statusStaticBlock');
  const statusRow = el('statusRow');
  const reasonRow = el('reasonRow');
  const noteRow = el('noteRow');
  const noteToggle = el('noteToggle');
  const noteInput = el('noteInput');
  const saveBtn = el('saveBtn');
  const saveError = el('saveError');
  const stopDialog = el('stopDialog');
  const addressInput = el('addressInput');
  const stopList = el('stopList');
  const stopCard = el('stopCard');
  const stopCardStatic = el('stopCardStatic');
  const awaitingRow = el('awaitingRow');
  const awaitingDialog = el('awaitingDialog');
  const awaitingList = el('awaitingList');

  // ---- scale ticket slot (ticketSlotSub/ticketLibraryBtn live inside ticketSlotWrap's
  // innerHTML, which is replaced on every reset, so they're always looked up fresh) ----
  const ticketSlotWrap = el('ticketSlotWrap');
  const ticketHint = el('ticketHint');
  const weightBlock = el('weightBlock');
  const moreToggleWrap = el('moreToggleWrap');
  const netLbInput = el('netLbInput');
  const grossInput = el('grossInput');
  const tareInput = el('tareInput');
  const facilityInput = el('facilityInput');
  const moreToggle = el('moreToggle');
  const moreBlock = el('moreBlock');

  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function markInteraction() {
    if (state.t0 === null) state.t0 = Date.now();
  }
  function markTicketInteraction() {
    if (state.ticketT0 === null) state.ticketT0 = Date.now();
  }
  // Add-later mode: ticketMs is first tap on that whole screen.
  function markAddLaterInteraction() {
    if (state.mode === 'addLater' && laState.t0 === null) laState.t0 = Date.now();
  }
  captureView.addEventListener('click', markAddLaterInteraction, true);
  captureView.addEventListener('input', markAddLaterInteraction, true);
  captureView.addEventListener('focus', markAddLaterInteraction, true);

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
    if (state.mode !== 'capture') return;
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

  function findStopFor(address, container) {
    return state.schedule.find((s) => s.address === address || (container && s.container === container));
  }

  // ---- awaiting a scale ticket: today's collected/removed pulls with no ticket yet ----
  function awaitingTickets() {
    return state.todayRecords.filter((r) => (r.status === 'collected' || r.status === 'removed') && !r.ticket);
  }
  function renderAwaiting() {
    if (state.mode !== 'capture') return;
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
      b.querySelector('.pi-meta').textContent = `${rest}${rest ? ' · ' : ''}${r.container || ''} · picked up ${formatTime(r.capturedAt)}`;
      b.addEventListener('click', () => {
        awaitingDialog.close();
        openAddLater(r, 'capture');
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
    if (state.mode !== 'capture') return;
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
  stopCard.addEventListener('click', () => {
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

  // ---- camera / downscale (shared by pickup hero, ticket slot, and drag-drop) ----
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

  function isImageFile(file) {
    return file && (file.type ? file.type.startsWith('image/') : true);
  }

  // ---- pickup hero ----
  function wireCameraInput() {
    const input = el('cameraInput');
    if (!input) return;
    input.addEventListener('click', markInteraction);
    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handlePickupFile(file);
    });
    const lib = el('libraryInput');
    if (lib) {
      lib.addEventListener('click', markInteraction);
      lib.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handlePickupFile(file);
      });
    }
  }
  const heroEmptyHtml = heroWrap.innerHTML;

  function resetCamera() {
    state.photoBlob = null;
    heroWrap.innerHTML = heroEmptyHtml;
    heroWrap.classList.remove('has-photo', 'locked');
    wireCameraInput();
    updateSaveEnabled();
  }

  // Renders a pickup photo from an already-decoded blob — shared by a fresh
  // capture and by restoring a snapshot taken before add-later opened (the blob
  // itself is never revoked, so its object URL is still good).
  function renderPickupPhotoFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    heroWrap.classList.add('has-photo');
    heroWrap.innerHTML = `<img class="hero-photo" src="${url}" alt="Captured photo"><button type="button" class="retake" id="retakeBtn">Retake</button>`;
    el('retakeBtn').addEventListener('click', resetCamera);
  }

  async function handlePickupFile(file) {
    markInteraction();
    state.capturedAt = new Date().toISOString();
    let blob;
    try {
      blob = await downscaleImage(file, 1400, 0.72);
    } catch {
      blob = file;
    }
    state.photoBlob = blob;
    renderPickupPhotoFromBlob(blob);
    updateSaveEnabled();
  }
  wireCameraInput();

  ['dragover', 'dragleave', 'drop'].forEach((ev) => {
    heroWrap.addEventListener(ev, (e) => {
      // The pickup hero is locked and uneditable in add-later mode.
      if (state.mode !== 'capture' || state.photoBlob) return;
      if (ev === 'dragover') { e.preventDefault(); heroWrap.classList.add('dragover'); }
      else if (ev === 'dragleave') { heroWrap.classList.remove('dragover'); }
      else if (ev === 'drop') {
        e.preventDefault();
        heroWrap.classList.remove('dragover');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && isImageFile(file)) handlePickupFile(file);
      }
    });
  });

  // ---- scale ticket slot ----
  function wireTicketCameraInput() {
    const input = el('ticketCameraInput');
    if (!input) return;
    input.addEventListener('click', markTicketInteraction);
    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleTicketFile(file);
    });
    const lib = el('ticketLibraryInput');
    if (lib) {
      lib.addEventListener('click', markTicketInteraction);
      lib.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleTicketFile(file);
      });
    }
    // The "or choose from library" text lives inside the camera <label>; keep it
    // clicking its own hidden input rather than triggering the camera capture.
    const altBtn = el('ticketLibraryBtn');
    if (altBtn) {
      altBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        markTicketInteraction();
        const libInput = el('ticketLibraryInput');
        if (libInput) libInput.click();
      });
    }
  }
  const ticketSlotEmptyHtml = ticketSlotWrap.innerHTML;

  function currentTicketSub() {
    return state.mode === 'addLater' ? 'The paper ticket from the scale house' : 'Optional now — add it later from the route';
  }

  // Retake: replaces just the photo, keeping any net/gross/tare/facility the
  // driver already typed (mirrors the pickup hero's Retake, which never wipes
  // the rest of the record either).
  function resetTicketPhoto() {
    if (state.mode === 'addLater') laState.photoBlob = null;
    else state.ticketPhotoBlob = null;
    ticketSlotWrap.innerHTML = ticketSlotEmptyHtml;
    ticketSlotWrap.classList.remove('has-photo');
    el('ticketSlotSub').textContent = currentTicketSub();
    wireTicketCameraInput();
    updateWeightVisibility();
    updateSaveEnabled();
  }

  // Full reset: used when leaving/entering add-later mode or moving to the next stop.
  function resetTicketSlot() {
    resetTicketPhoto();
    resetWeightFields();
    updateWeightVisibility();
    updateSaveEnabled();
  }

  // The blob lives on state (capture mode) or laState (add-later mode).
  function currentTicketBlob() {
    return state.mode === 'addLater' ? laState.photoBlob : state.ticketPhotoBlob;
  }

  // Renders a ticket photo from an already-decoded blob — shared by a fresh
  // capture, by restoring a snapshot, and by carrying an already-taken ticket
  // photo into add-later mode when only the net weight was missing.
  function renderTicketPhotoFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    ticketSlotWrap.classList.add('has-photo');
    ticketSlotWrap.innerHTML = `<img class="slot-photo" src="${url}" alt="Ticket photo"><button type="button" class="retake" id="ticketRetakeBtn">Retake</button>`;
    el('ticketRetakeBtn').addEventListener('click', resetTicketPhoto);
  }

  async function handleTicketFile(file) {
    markTicketInteraction();
    let blob;
    try {
      blob = await downscaleImage(file, 1400, 0.72);
    } catch {
      blob = file;
    }
    if (state.mode === 'addLater') laState.photoBlob = blob;
    else state.ticketPhotoBlob = blob;
    renderTicketPhotoFromBlob(blob);
    updateWeightVisibility();
    updateSaveEnabled();
  }
  wireTicketCameraInput();

  ['dragover', 'dragleave', 'drop'].forEach((ev) => {
    ticketSlotWrap.addEventListener(ev, (e) => {
      if (currentTicketBlob()) return;
      if (ev === 'dragover') { e.preventDefault(); ticketSlotWrap.classList.add('dragover'); }
      else if (ev === 'dragleave') { ticketSlotWrap.classList.remove('dragover'); }
      else if (ev === 'drop') {
        e.preventDefault();
        ticketSlotWrap.classList.remove('dragover');
        markTicketInteraction();
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && isImageFile(file)) handleTicketFile(file);
      }
    });
  });

  function validNet(v) {
    if (!/^[0-9]+$/.test(v)) return false;
    const n = parseInt(v, 10);
    return n >= 1 && n <= 80000;
  }
  function digitsOnlyInput(input) {
    input.addEventListener('input', () => {
      const cleaned = input.value.replace(/[^0-9]/g, '');
      if (cleaned !== input.value) input.value = cleaned;
    });
  }
  digitsOnlyInput(grossInput);
  digitsOnlyInput(tareInput);
  function optionalWeight(v) {
    const s = v.trim();
    if (!/^[0-9]+$/.test(s)) return null;
    const n = parseInt(s, 10);
    return n >= 1 && n <= 80000 ? n : null;
  }

  netLbInput.addEventListener('focus', markTicketInteraction);
  netLbInput.addEventListener('input', () => {
    markTicketInteraction();
    updateTicketHint();
    updateSaveEnabled();
  });

  function resetWeightFields() {
    netLbInput.value = '';
    grossInput.value = '';
    tareInput.value = '';
    facilityInput.value = '';
    moreBlock.classList.add('hidden');
    moreToggle.textContent = '+ Gross / tare / facility';
  }

  function updateWeightVisibility() {
    const hasPhoto = !!currentTicketBlob();
    weightBlock.classList.toggle('hidden', !hasPhoto);
    moreToggleWrap.classList.toggle('hidden', !hasPhoto);
    if (!hasPhoto) moreBlock.classList.add('hidden');
    updateTicketHint();
  }
  function updateTicketHint() {
    const hasPhoto = !!currentTicketBlob();
    const netOk = validNet(netLbInput.value.trim());
    ticketHint.classList.toggle('hidden', !(hasPhoto && !netOk));
  }

  moreToggle.addEventListener('click', () => {
    const opening = moreBlock.classList.contains('hidden');
    moreBlock.classList.toggle('hidden');
    moreToggle.textContent = opening ? '− Gross / tare / facility' : '+ Gross / tare / facility';
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

  // ---- save enablement ----
  function updateSaveEnabled() {
    if (state.mode === 'addLater') {
      saveBtn.disabled = !(laState.photoBlob && validNet(netLbInput.value.trim()));
    } else {
      saveBtn.disabled = !(state.photoBlob && state.address && state.address.trim());
    }
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

  function hideError() {
    saveError.classList.add('hidden');
    saveError.textContent = '';
  }
  function showError(text) {
    saveError.textContent = text;
    saveError.classList.remove('hidden');
  }
  async function errorTextFromResponse(res) {
    const data = await res.json().catch(() => null);
    if (data && typeof data.error === 'string' && data.error) return data.error;
    return `Server error ${res.status}`;
  }

  // ---- error line above Save: never alert(), always textContent ----

  saveBtn.addEventListener('click', () => {
    if (saveBtn.disabled) return;
    if (state.mode === 'addLater') onSaveTicketOnly();
    else onSaveOneGo();
  });

  async function onSaveTicketOnly() {
    markAddLaterInteraction();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    hideError();
    const ticketMs = Date.now() - (laState.t0 || Date.now());
    const netLb = parseInt(netLbInput.value.trim(), 10);
    let res;
    try {
      const photoBase64 = await blobToBase64(laState.photoBlob);
      const payload = {
        photo: photoBase64,
        netLb,
        grossLb: optionalWeight(grossInput.value),
        tareLb: optionalWeight(tareInput.value),
        facility: facilityInput.value.trim() || null,
        weighedAt: new Date().toISOString(),
        gps: state.gpsFixed ? state.gps : null,
        ticketMs,
      };
      res = await fetch(`/api/records/${laState.record.id}/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      showError('Could not save. Check your connection and try again.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save ticket';
      return;
    }
    if (!res.ok) {
      showError(await errorTextFromResponse(res));
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save ticket';
      return;
    }
    const data = await res.json().catch(() => ({}));
    const rec = state.todayRecords.find((r) => r.id === laState.record.id);
    if (rec) rec.ticket = { netLb };
    showTicketTiedConfirm(laState.record, netLb, data.url);
  }

  async function onSaveOneGo() {
    markInteraction();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    hideError();
    // Stop the ticket timer at the tap, before the (up to 2.5s) GPS wait below —
    // it measures the driver, not however long a location fix takes.
    const hasTicketPhoto = !!state.ticketPhotoBlob;
    const ticketMs = hasTicketPhoto ? Date.now() - (state.ticketT0 || Date.now()) : null;
    const netValid = hasTicketPhoto && validNet(netLbInput.value.trim());
    await waitForGps(2500);
    const captureMs = Date.now() - (state.t0 || Date.now());

    const stop = findStopFor(state.address, state.container);
    const pricing = stop && typeof stop.includedLb === 'number' && typeof stop.ratePerTon === 'number'
      ? { includedLb: stop.includedLb, ratePerTon: stop.ratePerTon }
      : undefined;

    const capturedAtIso = state.capturedAt || new Date().toISOString();
    const payload = {
      address: state.address,
      container: state.container,
      status: state.status,
      reason: state.status === 'not_collected' ? state.reason : null,
      note: state.note,
      capturedAt: capturedAtIso,
      gps: state.gpsFixed ? state.gps : null,
      captureMs,
      photo: null,
      pricing,
    };

    let recordId, recordUrl;
    try {
      payload.photo = await blobToBase64(state.photoBlob);
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showError(await errorTextFromResponse(res));
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save record';
        return;
      }
      const data = await res.json();
      recordId = data.id;
      recordUrl = data.url;
    } catch (err) {
      showError('Could not save. Check your connection and try again.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save record';
      return;
    }

    // The record exists from here on; a ticket failure never re-shows the capture screen.
    // POST /api/records returns only {id, url} — no photoUrl — so the just-taken pickup
    // blob (and, if present, the ticket photo/weights not yet valid enough to send) are
    // carried on the record object itself for "Add ticket now" to reuse without a GET.
    const effectivePricing = pricing || { includedLb: 2000, ratePerTon: 95 };
    const newRec = {
      id: recordId,
      address: payload.address,
      capturedAt: payload.capturedAt,
      container: payload.container,
      status: payload.status,
      photoUrl: null,
      photoBlob: state.photoBlob,
      ticket: null,
      pricing: effectivePricing,
    };
    state.todayRecords.push(newRec);

    let ticketOutcome = 'none'; // 'none' | 'later' | 'ok' | 'failed'
    let ticketErrText = null;
    let netLb = null;

    if (hasTicketPhoto && netValid) {
      netLb = parseInt(netLbInput.value.trim(), 10);
      try {
        const ticketPhotoBase64 = await blobToBase64(state.ticketPhotoBlob);
        const tpayload = {
          photo: ticketPhotoBase64,
          netLb,
          grossLb: optionalWeight(grossInput.value),
          tareLb: optionalWeight(tareInput.value),
          facility: facilityInput.value.trim() || null,
          weighedAt: new Date().toISOString(),
          gps: state.gpsFixed ? state.gps : null,
          ticketMs,
        };
        const tres = await fetch(`/api/records/${recordId}/ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tpayload),
        });
        if (tres.ok) {
          ticketOutcome = 'ok';
          newRec.ticket = { netLb };
        } else {
          ticketOutcome = 'failed';
          ticketErrText = await errorTextFromResponse(tres);
        }
      } catch (err) {
        ticketOutcome = 'failed';
        ticketErrText = 'Could not save. Check your connection and try again.';
      }
    } else if (hasTicketPhoto) {
      ticketOutcome = 'later';
    }

    // Carry an already-taken ticket photo (and any gross/tare/facility) forward so
    // "Add ticket now" only ever has to ask for what's actually missing.
    if (hasTicketPhoto && ticketOutcome !== 'ok') {
      newRec.ticketPhotoBlob = state.ticketPhotoBlob;
      newRec.ticketGross = grossInput.value;
      newRec.ticketTare = tareInput.value;
      newRec.ticketFacility = facilityInput.value;
    }

    renderAwaiting();
    showConfirmOneGo({ id: recordId, url: recordUrl, captureMs, netLb, ticketOutcome, ticketErrText, record: newRec });
  }

  function overageLine(netLb, pricing) {
    const includedLb = pricing && typeof pricing.includedLb === 'number' ? pricing.includedLb : 2000;
    const overLb = Math.max(0, netLb - includedLb);
    const span = document.createElement('span');
    span.className = 'dim';
    span.textContent = ` · ${overLb.toLocaleString()} lb over`;
    return { overLb, span };
  }

  function showConfirmOneGo({ id, url, captureMs, netLb, ticketOutcome, ticketErrText, record }) {
    captureView.classList.add('hidden');
    confirmView.classList.remove('hidden');
    el('elapsedText').textContent = `Recorded in ${(captureMs / 1000).toFixed(1)}s`;

    const savedSlots = el('savedSlots');
    savedSlots.innerHTML = '';
    const pickupPart = document.createElement('span');
    pickupPart.textContent = 'Pickup ✓';
    savedSlots.appendChild(pickupPart);

    const savedTicketError = el('savedTicketError');
    savedTicketError.classList.add('hidden');
    savedTicketError.textContent = '';

    if (ticketOutcome === 'ok') {
      savedSlots.append(' · ');
      const t = document.createElement('span');
      t.textContent = `Ticket ✓ ${netLb.toLocaleString()} lb`;
      savedSlots.appendChild(t);
      const { overLb, span } = overageLine(netLb, record.pricing);
      if (overLb > 0) savedSlots.appendChild(span);
    } else {
      // A record whose status isn't collected/removed can never take a ticket —
      // "add later" would be a promise the app can't keep, so it reads differently
      // and never offers "Add ticket now" below.
      const canEverAttach = record.status === 'collected' || record.status === 'removed';
      savedSlots.append(' · ');
      const t = document.createElement('span');
      t.className = 'dim';
      t.textContent = canEverAttach ? 'Ticket — add later' : 'Ticket — not attached';
      savedSlots.appendChild(t);
      if (ticketOutcome === 'failed') {
        savedTicketError.textContent = `Saved. Ticket not attached: ${ticketErrText}`;
        savedTicketError.classList.remove('hidden');
      }
    }

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
    } else {
      shareBtn.classList.add('hidden');
    }
    el('nextStopBtn').onclick = resetForNext;

    const addTicketBtn = el('addTicketBtn');
    const ticketMissing = ticketOutcome !== 'ok';
    const eligible = ticketMissing && (record.status === 'collected' || record.status === 'removed');
    addTicketBtn.classList.toggle('hidden', !eligible);
    if (eligible) {
      addTicketBtn.onclick = () => openAddLater(record, 'confirm');
    }
  }

  function showTicketTiedConfirm(record, netLb, url) {
    captureView.classList.add('hidden');
    confirmView.classList.remove('hidden');
    el('elapsedText').textContent = 'Ticket tied';

    const savedSlots = el('savedSlots');
    savedSlots.innerHTML = '';
    const t = document.createElement('span');
    t.textContent = `Ticket ✓ ${netLb.toLocaleString()} lb`;
    savedSlots.appendChild(t);
    const { overLb, span } = overageLine(netLb, record.pricing);
    if (overLb > 0) savedSlots.appendChild(span);

    el('savedTicketError').classList.add('hidden');
    el('savedTicketError').textContent = '';

    el('savedStop').textContent = record.address.split(',')[0] + (record.container ? ` · ${record.container}` : '');
    el('proofUrlText').textContent = location.origin + url;
    el('gpsWarning').classList.add('hidden');
    el('copyLinkBtn').onclick = () => {
      navigator.clipboard?.writeText(location.origin + url);
      el('copyLinkBtn').textContent = 'Copied';
      setTimeout(() => (el('copyLinkBtn').textContent = 'Copy link'), 1500);
    };
    const shareBtn = el('shareBtn');
    if (navigator.share) {
      shareBtn.classList.remove('hidden');
      shareBtn.onclick = () => navigator.share({ title: 'Collected — service record', url: location.origin + url }).catch(() => {});
    } else {
      shareBtn.classList.add('hidden');
    }
    el('addTicketBtn').classList.add('hidden');
    // After an add-later save, Next stop must also drop the add-later UI
    // (static stop card, locked hero, back button) before it resets for real.
    el('nextStopBtn').onclick = () => { exitAddLaterUI(); resetForNext(); };
  }

  // ---- add-later mode: this same screen, opened for a record awaiting a ticket ----
  function renderAddLaterHeader(record) {
    const parts = (record.address || '').split(',');
    el('stopAddrStatic').textContent = parts[0].trim();
    const rest = parts.slice(1).join(',').trim();
    const meta = el('stopMetaStatic');
    meta.innerHTML = '';
    if (rest) meta.append(rest);
    if (record.container) {
      if (rest) meta.append(' · ');
      const code = document.createElement('code');
      code.textContent = record.container;
      meta.appendChild(code);
    }
    meta.append(` · picked up ${formatTime(record.capturedAt)}`);
  }

  function renderLockedHero(record) {
    heroWrap.classList.add('has-photo', 'locked');
    heroWrap.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'hero-photo';
    img.alt = '';
    // POST /api/records returns only {id, url}, no photoUrl — a record saved this
    // session still has its blob in memory, so prefer that over an unset photoUrl.
    img.src = record.photoBlob ? URL.createObjectURL(record.photoBlob) : (record.photoUrl || '');
    const tag = document.createElement('span');
    tag.className = 'hero-tag';
    tag.textContent = `Pickup · ${formatTime(record.capturedAt)}`;
    heroWrap.appendChild(img);
    heroWrap.appendChild(tag);
  }

  const STATUS_LABEL = { collected: 'Collected', delivered: 'Delivered', removed: 'Removed', not_collected: "Couldn't" };

  // The capture screen's in-progress state, captured the instant before add-later
  // takes over the shared DOM (hero, ticket slot, weight inputs, status, note).
  // Add-later's own inputs never write into this object — it is only written by
  // snapshotCaptureScreen() and only read/cleared by restoreCaptureScreen(), so
  // whatever the driver types while inside add-later can never leak into it.
  const captureSnapshot = {
    photoBlob: null,
    ticketPhotoBlob: null,
    netLb: '', grossLb: '', tareLb: '', facility: '', moreOpen: false,
    status: 'collected', reason: null,
    note: '', noteInputValue: '', noteOpen: false,
    t0: null, ticketT0: null,
    address: '', container: null, routeOrder: null, stopSource: null, capturedAt: null,
  };

  function snapshotCaptureScreen() {
    captureSnapshot.photoBlob = state.photoBlob;
    captureSnapshot.ticketPhotoBlob = state.ticketPhotoBlob;
    captureSnapshot.netLb = netLbInput.value;
    captureSnapshot.grossLb = grossInput.value;
    captureSnapshot.tareLb = tareInput.value;
    captureSnapshot.facility = facilityInput.value;
    captureSnapshot.moreOpen = !moreBlock.classList.contains('hidden');
    captureSnapshot.status = state.status;
    captureSnapshot.reason = state.reason;
    captureSnapshot.note = state.note;
    captureSnapshot.noteInputValue = noteInput.value;
    captureSnapshot.noteOpen = !noteInput.classList.contains('hidden');
    captureSnapshot.t0 = state.t0;
    captureSnapshot.ticketT0 = state.ticketT0;
    captureSnapshot.address = state.address;
    captureSnapshot.container = state.container;
    captureSnapshot.routeOrder = state.routeOrder;
    captureSnapshot.stopSource = state.stopSource;
    captureSnapshot.capturedAt = state.capturedAt;
  }

  // Puts the capture screen back exactly as snapshotCaptureScreen() found it —
  // pickup photo, ticket photo, typed weights, status, reason, note, both timers
  // and the selected stop — instead of resetting it blank.
  function restoreCaptureScreen() {
    state.photoBlob = captureSnapshot.photoBlob;
    if (state.photoBlob) {
      renderPickupPhotoFromBlob(state.photoBlob);
    } else {
      heroWrap.innerHTML = heroEmptyHtml;
      heroWrap.classList.remove('has-photo', 'locked');
      wireCameraInput();
    }

    state.ticketPhotoBlob = captureSnapshot.ticketPhotoBlob;
    if (state.ticketPhotoBlob) {
      renderTicketPhotoFromBlob(state.ticketPhotoBlob);
    } else {
      // #ticketSlotSub only exists in the empty-slot markup — the has-photo markup
      // has no subtitle line, so it must not be touched in that branch.
      ticketSlotWrap.innerHTML = ticketSlotEmptyHtml;
      ticketSlotWrap.classList.remove('has-photo');
      wireTicketCameraInput();
      el('ticketSlotSub').textContent = currentTicketSub();
    }

    netLbInput.value = captureSnapshot.netLb;
    grossInput.value = captureSnapshot.grossLb;
    tareInput.value = captureSnapshot.tareLb;
    facilityInput.value = captureSnapshot.facility;
    moreBlock.classList.toggle('hidden', !captureSnapshot.moreOpen);
    moreToggle.textContent = captureSnapshot.moreOpen ? '− Gross / tare / facility' : '+ Gross / tare / facility';

    state.status = captureSnapshot.status;
    state.reason = captureSnapshot.reason;
    [...statusRow.children].forEach((c) => {
      const on = c.dataset.status === state.status;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    reasonRow.classList.toggle('hidden', state.status !== 'not_collected');
    [...reasonRow.children].forEach((c) => c.classList.toggle('on', c.dataset.reason === state.reason));

    state.note = captureSnapshot.note;
    noteInput.value = captureSnapshot.noteInputValue;
    noteInput.classList.toggle('hidden', !captureSnapshot.noteOpen);

    state.t0 = captureSnapshot.t0;
    state.ticketT0 = captureSnapshot.ticketT0;
    state.address = captureSnapshot.address;
    state.container = captureSnapshot.container;
    state.routeOrder = captureSnapshot.routeOrder;
    state.stopSource = captureSnapshot.stopSource;
    state.capturedAt = captureSnapshot.capturedAt;

    updateWeightVisibility();
    updateSaveEnabled();
  }

  function openAddLater(record, returnTo) {
    snapshotCaptureScreen();

    state.mode = 'addLater';
    laState.record = record;
    laState.photoBlob = null;
    laState.t0 = null;
    laState.returnTo = returnTo === 'confirm' ? 'confirm' : 'capture';

    backBtn.classList.remove('hidden');
    awaitingRow.classList.add('hidden');
    stopCard.classList.add('hidden');
    stopCardStatic.classList.remove('hidden');
    renderAddLaterHeader(record);

    renderLockedHero(record);

    statusBlock.classList.add('hidden');
    statusStaticBlock.classList.remove('hidden');
    el('statusStaticText').textContent = STATUS_LABEL[record.status] || record.status;

    noteRow.classList.add('hidden');

    // A one-go save that took a ticket photo but had no valid net weight already
    // has that photo (and any gross/tare/facility) in memory — carry it in so
    // only the net weight is missing, instead of making the driver retake it.
    if (record.ticketPhotoBlob) {
      laState.photoBlob = record.ticketPhotoBlob;
      renderTicketPhotoFromBlob(record.ticketPhotoBlob);
      netLbInput.value = '';
      grossInput.value = record.ticketGross || '';
      tareInput.value = record.ticketTare || '';
      facilityInput.value = record.ticketFacility || '';
      const hasMore = !!(record.ticketGross || record.ticketTare || record.ticketFacility);
      moreBlock.classList.toggle('hidden', !hasMore);
      moreToggle.textContent = hasMore ? '− Gross / tare / facility' : '+ Gross / tare / facility';
      updateWeightVisibility();
      updateSaveEnabled();
    } else {
      resetTicketSlot();
    }

    saveBtn.textContent = 'Save ticket';
    hideError();

    captureView.classList.remove('hidden');
    confirmView.classList.add('hidden');

    // Ticket slot gets focus (and is keyboard-focusable) on open.
    requestAnimationFrame(() => {
      ticketSlotWrap.scrollIntoView({ block: 'center' });
      const camBtn = el('ticketCameraBtn');
      if (camBtn) camBtn.focus({ preventScroll: true });
    });
  }

  // Flips the DOM/mode back to plain capture; shared by "Back" (cancel, restores
  // whatever view was underneath) and a post-save "Next stop" (which then runs a
  // full resetForNext on top of it).
  function exitAddLaterUI() {
    state.mode = 'capture';
    laState.record = null;
    laState.photoBlob = null;
    laState.t0 = null;

    backBtn.classList.add('hidden');
    stopCard.classList.remove('hidden');
    stopCardStatic.classList.add('hidden');
    statusStaticBlock.classList.add('hidden');
    statusBlock.classList.remove('hidden');
    noteRow.classList.remove('hidden');
  }

  // Back leaves whichever view opened the add-later screen exactly as it was —
  // never resetForNext, so an in-progress pickup underneath survives a
  // mistaken open (restored from the snapshot, not reset), and a failed Save
  // doesn't strand the driver here.
  function closeAddLater() {
    const returnTo = laState.returnTo;
    exitAddLaterUI();

    restoreCaptureScreen();
    saveBtn.textContent = 'Save record';
    hideError();
    renderStopCard();
    renderRoute();

    // Exactly one of the two views is shown — never both stacked.
    if (returnTo === 'confirm') {
      captureView.classList.add('hidden');
      confirmView.classList.remove('hidden');
    } else {
      confirmView.classList.add('hidden');
      captureView.classList.remove('hidden');
    }
  }
  backBtn.addEventListener('click', closeAddLater);

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
    state.ticketT0 = null;
    state.ticketPhotoBlob = null;
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
    resetTicketSlot();
    hideError();
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
          photoUrl: r.photoUrl || null,
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
