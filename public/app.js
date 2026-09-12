// Audio Monitor Pro - Frontend Client Logic

let socket = null;
let reconnectTimer = null;
let currentDevices = [];
let selectedDurationSeconds = 20;
let activeRecordingTimer = null;
let activeRecordingEndAt = null;

// Audio Player State
const audioElement = document.getElementById('global-audio-element');
let currentPlayingFile = null;

// DOM Elements
const serverWsStatus = document.getElementById('server-ws-status');
const deviceCountBadge = document.getElementById('device-count-badge');
const deviceCardContent = document.getElementById('device-card-content');
const btnStartRecord = document.getElementById('btn-start-record');
const durationPresetBtns = document.querySelectorAll('.preset-btn');
const customDurationContainer = document.getElementById('custom-duration-container');
const customDurationInput = document.getElementById('custom-duration-input');
const recordingActiveBanner = document.getElementById('recording-active-banner');
const recordingCountdownText = document.getElementById('recording-countdown-text');
const recordingProgressFill = document.getElementById('recording-progress-fill');
const btnCancelRecording = document.getElementById('btn-cancel-recording');
const recordingsTableContainer = document.getElementById('recordings-table-container');
const recordingsStats = document.getElementById('recordings-stats');
const btnRefreshList = document.getElementById('btn-refresh-list');

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
      fetchRecordings();
      break;

    case 'RECORDING_DELETED':
      fetchRecordings();
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
    return;
  }

  const primaryDevice = devices[0];
  const isRecording = primaryDevice.status === 'recording';
  btnStartRecord.disabled = isRecording;

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

// Start Recording Trigger
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
      recordingCountdownText.textContent = 'Subiendo archivo al servidor...';
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

// Fetch and Render Recordings from REST API
async function fetchRecordings() {
  try {
    const res = await fetch('/api/recordings');
    const data = await res.json();
    renderRecordings(data);
  } catch (err) {
    console.error('Error fetching recordings:', err);
    recordingsStats.textContent = 'Error al cargar grabaciones';
  }
}

function renderRecordings(recordings) {
  const totalSize = recordings.reduce((acc, r) => acc + (r.size || 0), 0);
  const sizeMb = (totalSize / 1024 / 1024).toFixed(1);
  recordingsStats.textContent = `${recordings.length} archivos almacenados (${sizeMb} MB en total)`;

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
});

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
