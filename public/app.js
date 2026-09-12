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
const tabRecordings = document.getElementById('tab-recordings');
const tabLocations = document.getElementById('tab-locations');
const recordingsTableContainer = document.getElementById('recordings-table-container');
const locationsTableContainer = document.getElementById('locations-table-container');
const recordingsCountBadge = document.getElementById('recordings-count-badge');
const locationsCountBadge = document.getElementById('locations-count-badge');
const btnRefreshList = document.getElementById('btn-refresh-list');
const toastContainer = document.getElementById('toast-container');

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

    case 'ERROR':
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
  const isRecording = primaryDevice.status === 'recording';
  btnStartRecord.disabled = isRecording;
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
  } else if (!isRecording && activeRecordingTimer) {
    stopLocalRecordingCountdown();
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

// Start Recording Trigger (Audio + GPS)
btnStartRecord.addEventListener('click', () => {
  if (currentDevices.length === 0) {
    alert('No hay ningún teléfono Android conectado.');
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      action: 'trigger_record',
      durationSeconds: selectedDurationSeconds,
      deviceId: currentDevices[0].id
    }));
  }
});

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
  if (confirm('¿Deseas detener la grabación inmediatamente?')) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        action: 'cancel_record',
        deviceId: currentDevices[0]?.id
      }));
    }
    stopLocalRecordingCountdown();
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
tabBtnRecordings.addEventListener('click', () => {
  tabBtnRecordings.classList.add('active');
  tabBtnLocations.classList.remove('active');
  tabRecordings.classList.remove('hidden');
  tabLocations.classList.add('hidden');
});

tabBtnLocations.addEventListener('click', () => {
  tabBtnLocations.classList.add('active');
  tabBtnRecordings.classList.remove('active');
  tabLocations.classList.remove('hidden');
  tabRecordings.classList.add('hidden');
});

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
    const acc = loc.accuracy ? `±${Math.round(loc.accuracy)}m` : 'N/A';
    const mapsUrl = loc.mapsUrl || (loc.latitude && loc.longitude ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` : '#');

    html += `
      <div class="location-item" data-id="${loc.id}">
        <div class="recording-info">
          <div class="location-icon-badge">📍</div>
          <div class="recording-details">
            <div class="recording-name">${escapeHtml(loc.deviceName || 'Teléfono')} <span style="font-weight: 400; color: var(--text-dim); font-size: 0.85rem;">(${escapeHtml(loc.deviceId)})</span></div>
            <div class="recording-meta">
              <span>📅 ${dateFormatted} ${timeFormatted}</span>
              <span class="meta-pill" style="color: #38bdf8;">🌐 Lat: ${lat}, Lon: ${lon}</span>
              <span class="meta-pill">🎯 Precisión: ${acc}</span>
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
});

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
