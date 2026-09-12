const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const STORAGE_DIR = path.join(__dirname, 'storage', 'recordings');
const DB_FILE = path.join(__dirname, 'storage', 'metadata.json');
const LOCATIONS_FILE = path.join(__dirname, 'storage', 'locations.json');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Helpers for metadata persistence
function loadMetadata() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      console.error('Error reading metadata.json:', err);
    }
  }
  return [];
}

function saveMetadata(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Helpers for locations persistence
function loadLocations() {
  if (fs.existsSync(LOCATIONS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf8'));
    } catch (err) {
      console.error('Error reading locations.json:', err);
    }
  }
  return [];
}

function saveLocations(data) {
  fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Multer storage setup for incoming audio files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(file.originalname) || '.m4a';
    cb(null, `rec_${timestamp}${ext}`);
  }
});

const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected devices and dashboard clients
const connectedDevices = new Map(); // id -> { ws, info, lastSeen }
const connectedDashboards = new Set(); // Set of ws

function broadcastToDashboards(messageObj) {
  const payload = JSON.stringify(messageObj);
  for (const client of connectedDashboards) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function getDevicesList() {
  const list = [];
  for (const [id, dev] of connectedDevices.entries()) {
    list.push({
      id,
      name: dev.info?.name || `Dispositivo ${id}`,
      battery: dev.info?.battery ?? null,
      isCharging: dev.info?.isCharging ?? false,
      networkType: dev.info?.networkType || 'UNKNOWN',
      status: dev.info?.status || 'idle', // 'idle' | 'recording' | 'uploading'
      lastSeen: dev.lastSeen,
      activeRecording: dev.info?.activeRecording || null
    });
  }
  return list;
}

// WebSocket Connection Handling
wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.replace(/^.*\?/, ''));
  const clientType = urlParams.get('type') || 'dashboard';
  const deviceId = urlParams.get('deviceId') || 'default_phone';

  if (clientType === 'device') {
    console.log(`📱 Dispositivo Android conectado: ${deviceId}`);
    connectedDevices.set(deviceId, {
      ws,
      info: {
        name: urlParams.get('deviceName') || 'Teléfono Cuarto de Máquinas',
        battery: 100,
        isCharging: false,
        networkType: 'UNKNOWN',
        status: 'idle'
      },
      lastSeen: Date.now()
    });

    // Notify dashboards of device status
    broadcastToDashboards({
      type: 'DEVICE_LIST_UPDATED',
      devices: getDevicesList()
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        const device = connectedDevices.get(deviceId);
        if (!device) return;

        device.lastSeen = Date.now();

        if (data.type === 'heartbeat' || data.type === 'status_update') {
          if (data.battery !== undefined) device.info.battery = data.battery;
          if (data.isCharging !== undefined) device.info.isCharging = data.isCharging;
          if (data.networkType !== undefined) device.info.networkType = data.networkType;
          if (data.status !== undefined) device.info.status = data.status;
          if (data.activeRecording !== undefined) device.info.activeRecording = data.activeRecording;

          broadcastToDashboards({
            type: 'DEVICE_STATUS_UPDATE',
            deviceId,
            info: device.info
          });
        } else if (data.type === 'recording_progress') {
          broadcastToDashboards({
            type: 'RECORDING_PROGRESS',
            deviceId,
            elapsedSeconds: data.elapsedSeconds,
            totalSeconds: data.totalSeconds
          });
        } else if (data.type === 'location_report') {
          console.log(`📍 Reporte de ubicación recibido de ${deviceId}: Lat ${data.latitude}, Lon ${data.longitude}`);
          const locations = loadLocations();
          const newLoc = {
            id: `loc_${Date.now()}`,
            deviceId: data.deviceId || deviceId,
            deviceName: data.deviceName || device.info?.name || 'Teléfono Cuarto de Máquinas',
            latitude: data.latitude ?? null,
            longitude: data.longitude ?? null,
            accuracy: data.accuracy ?? null,
            mapsUrl: data.mapsUrl || (data.latitude && data.longitude ? `https://maps.google.com/?q=${data.latitude},${data.longitude}` : null),
            provider: data.provider || 'gps',
            battery: data.battery ?? device.info?.battery ?? null,
            networkType: data.networkType ?? device.info?.networkType ?? 'UNKNOWN',
            notes: data.notes || '',
            error: data.error || null,
            createdAt: new Date().toISOString()
          };

          locations.unshift(newLoc);
          saveLocations(locations);

          broadcastToDashboards({
            type: 'NEW_LOCATION_REPORT',
            location: newLoc
          });
        }
      } catch (err) {
        console.error('Error procesando mensaje WebSocket del dispositivo:', err);
      }
    });

    ws.on('close', () => {
      console.log(`❌ Dispositivo desconectado: ${deviceId}`);
      connectedDevices.delete(deviceId);
      broadcastToDashboards({
        type: 'DEVICE_LIST_UPDATED',
        devices: getDevicesList()
      });
    });

  } else {
    // Dashboard web client
    console.log('💻 Cliente Dashboard conectado');
    connectedDashboards.add(ws);

    // Send initial status immediately
    ws.send(JSON.stringify({
      type: 'INIT_STATE',
      devices: getDevicesList()
    }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        if (data.action === 'trigger_record') {
          const targetDeviceId = data.deviceId || Array.from(connectedDevices.keys())[0];
          const durationSeconds = parseInt(data.durationSeconds, 10) || 60;

          if (!targetDeviceId || !connectedDevices.has(targetDeviceId)) {
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: 'No hay ningún teléfono Android conectado actualmente.'
            }));
            return;
          }

          const target = connectedDevices.get(targetDeviceId);
          if (target.ws.readyState === WebSocket.OPEN) {
            console.log(`🎙️ Enviando orden de grabación a ${targetDeviceId} por ${durationSeconds} segundos...`);
            target.ws.send(JSON.stringify({
              action: 'record',
              durationSeconds: durationSeconds,
              recordId: `rec_${Date.now()}`
            }));

            target.info.status = 'recording';
            target.info.activeRecording = { durationSeconds, startedAt: Date.now() };

            broadcastToDashboards({
              type: 'RECORDING_STARTED',
              deviceId: targetDeviceId,
              durationSeconds
            });
          }
        } else if (data.action === 'cancel_record') {
          const targetDeviceId = data.deviceId || Array.from(connectedDevices.keys())[0];
          if (targetDeviceId && connectedDevices.has(targetDeviceId)) {
            const target = connectedDevices.get(targetDeviceId);
            if (target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(JSON.stringify({ action: 'cancel' }));
            }
          }
        } else if (data.action === 'request_location') {
          const targetDeviceId = data.deviceId || Array.from(connectedDevices.keys())[0];
          if (!targetDeviceId || !connectedDevices.has(targetDeviceId)) {
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: 'No hay ningún teléfono Android conectado para solicitar ubicación.'
            }));
            return;
          }

          const target = connectedDevices.get(targetDeviceId);
          if (target.ws.readyState === WebSocket.OPEN) {
            console.log(`📍 Solicitando ubicación GPS en tiempo real a ${targetDeviceId}...`);
            target.ws.send(JSON.stringify({
              action: 'get_location',
              requestId: `loc_req_${Date.now()}`
            }));

            broadcastToDashboards({
              type: 'LOCATION_REQUESTED',
              deviceId: targetDeviceId
            });
          }
        }
      } catch (err) {
        console.error('Error procesando mensaje del dashboard:', err);
      }
    });

    ws.on('close', () => {
      connectedDashboards.delete(ws);
    });
  }
});

// Periodic cleanup check for inactive devices (30s timeout)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, dev] of connectedDevices.entries()) {
    if (now - dev.lastSeen > 35000) {
      console.log(`⚠️ Desconectando dispositivo inactivo por timeout: ${id}`);
      dev.ws.terminate();
      connectedDevices.delete(id);
      changed = true;
    }
  }
  if (changed) {
    broadcastToDashboards({
      type: 'DEVICE_LIST_UPDATED',
      devices: getDevicesList()
    });
  }
}, 10000);

// --- REST API Endpoints ---

// 1. Get Devices List
app.get('/api/devices', (req, res) => {
  res.json(getDevicesList());
});

// 2. Trigger Recording via HTTP
app.post('/api/record/trigger', (req, res) => {
  const { durationSeconds = 60, deviceId } = req.body;
  const targetId = deviceId || Array.from(connectedDevices.keys())[0];

  if (!targetId || !connectedDevices.has(targetId)) {
    return res.status(404).json({ error: 'No hay dispositivo Android conectado' });
  }

  const target = connectedDevices.get(targetId);
  target.ws.send(JSON.stringify({
    action: 'record',
    durationSeconds: Number(durationSeconds),
    recordId: `rec_${Date.now()}`
  }));

  res.json({ success: true, message: `Grabación de ${durationSeconds}s iniciada en ${targetId}` });
});

// 3. Request Instant Location via HTTP
app.post('/api/location/request', (req, res) => {
  const { deviceId } = req.body;
  const targetId = deviceId || Array.from(connectedDevices.keys())[0];

  if (!targetId || !connectedDevices.has(targetId)) {
    return res.status(404).json({ error: 'No hay dispositivo Android conectado' });
  }

  const target = connectedDevices.get(targetId);
  target.ws.send(JSON.stringify({
    action: 'get_location',
    requestId: `loc_req_${Date.now()}`
  }));

  broadcastToDashboards({
    type: 'LOCATION_REQUESTED',
    deviceId: targetId
  });

  res.json({ success: true, message: `Solicitud de ubicación enviada a ${targetId}` });
});

// 4. Report Location from Android via REST
app.post('/api/location/report', (req, res) => {
  const { deviceId, deviceName, latitude, longitude, accuracy, mapsUrl, notes, provider, battery, networkType, error } = req.body;
  const locations = loadLocations();

  const newLoc = {
    id: `loc_${Date.now()}`,
    deviceId: deviceId || 'desconocido',
    deviceName: deviceName || 'Teléfono Cuarto de Máquinas',
    latitude: latitude ? parseFloat(latitude) : null,
    longitude: longitude ? parseFloat(longitude) : null,
    accuracy: accuracy ? parseFloat(accuracy) : null,
    mapsUrl: mapsUrl || (latitude && longitude ? `https://maps.google.com/?q=${latitude},${longitude}` : null),
    provider: provider || 'gps',
    battery: battery ?? null,
    networkType: networkType || 'UNKNOWN',
    notes: notes || '',
    error: error || null,
    createdAt: new Date().toISOString()
  };

  locations.unshift(newLoc);
  saveLocations(locations);

  console.log(`📍 Reporte de ubicación REST guardado para ${newLoc.deviceName}: Lat ${latitude}, Lon ${longitude}`);

  broadcastToDashboards({
    type: 'NEW_LOCATION_REPORT',
    location: newLoc
  });

  res.json({ success: true, location: newLoc });
});

// 5. Get Stored Locations History
app.get('/api/locations', (req, res) => {
  res.json(loadLocations());
});

// 6. Delete Location Record
app.delete('/api/locations/:id', (req, res) => {
  const locId = req.params.id;
  let locations = loadLocations();
  locations = locations.filter(item => item.id !== locId);
  saveLocations(locations);

  broadcastToDashboards({
    type: 'LOCATION_DELETED',
    id: locId
  });

  res.json({ success: true, message: 'Registro de ubicación eliminado' });
});

// 7. Upload Audio File from Android
app.post('/api/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo de audio' });
  }

  const duration = req.body.durationSeconds ? parseInt(req.body.durationSeconds, 10) : null;
  const deviceName = req.body.deviceName || 'Android Cuarto Máquinas';
  const deviceId = req.body.deviceId || 'cuarto_maquinas';
  const notes = req.body.notes || '';
  const latitude = req.body.latitude ? parseFloat(req.body.latitude) : null;
  const longitude = req.body.longitude ? parseFloat(req.body.longitude) : null;
  const accuracy = req.body.accuracy ? parseFloat(req.body.accuracy) : null;
  const mapsUrl = req.body.mapsUrl || (latitude && longitude ? `https://maps.google.com/?q=${latitude},${longitude}` : null);
  const locationProvider = req.body.locationProvider || (latitude ? 'gps' : null);

  const metadata = loadMetadata();
  const fileStat = fs.statSync(req.file.path);

  const newRecord = {
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: fileStat.size,
    durationSeconds: duration,
    createdAt: new Date().toISOString(),
    deviceId,
    deviceName,
    latitude,
    longitude,
    accuracy,
    mapsUrl,
    locationProvider,
    notes
  };

  metadata.unshift(newRecord);
  saveMetadata(metadata);

  console.log(`✅ Nuevo audio guardado: ${req.file.filename} (${(fileStat.size / 1024 / 1024).toFixed(2)} MB) ${latitude ? `[📍 Lat: ${latitude}, Lon: ${longitude}]` : ''}`);

  // Notify all connected dashboard clients
  broadcastToDashboards({
    type: 'NEW_RECORDING',
    recording: newRecord
  });

  res.json({
    success: true,
    message: 'Audio subido y procesado exitosamente',
    file: newRecord
  });
});

// 8. List all stored recordings
app.get('/api/recordings', (req, res) => {
  const metadata = loadMetadata();
  const validRecords = metadata.filter(rec => {
    return fs.existsSync(path.join(STORAGE_DIR, rec.filename));
  });
  res.json(validRecords);
});

// 9. Stream / Download audio file
app.get('/api/recordings/:filename', (req, res) => {
  const filePath = path.join(STORAGE_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Archivo no encontrado');
  }

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mp4'
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': 'audio/mp4'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// 10. Delete recording
app.delete('/api/recordings/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(STORAGE_DIR, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  let metadata = loadMetadata();
  metadata = metadata.filter(item => item.filename !== filename);
  saveMetadata(metadata);

  broadcastToDashboards({
    type: 'RECORDING_DELETED',
    filename
  });

  res.json({ success: true, message: 'Grabación eliminada' });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎙️  Servidor de Monitoreo de Audio Activo`);
  console.log(`🌐  Panel Web: http://localhost:${PORT}`);
  console.log(`📱  Endpoint Dispositivo: ws://<TU-IP-LOCAL>:${PORT}/ws?type=device&deviceId=cuarto_maquinas`);
  console.log(`====================================================`);
});
