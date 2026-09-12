// Simulador de Teléfono Android para pruebas locales rápidas del Dashboard
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SERVER_HOST = 'localhost:3000';
const WS_URL = `ws://${SERVER_HOST}/ws?type=device&deviceId=simulador_cuarto_maquinas&deviceName=Simulador+Android+Maquinaria`;

console.log('🤖 Iniciando Simulador de Teléfono Android...');
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Simulador conectado exitosamente al Servidor');
  
  // Enviar telemetría inicial
  ws.send(JSON.stringify({
    type: 'heartbeat',
    battery: 88,
    isCharging: true,
    networkType: 'WIFI',
    status: 'idle'
  }));

  // Latido cada 10s
  setInterval(() => {
    ws.send(JSON.stringify({
      type: 'heartbeat',
      battery: 88,
      isCharging: true,
      networkType: 'WIFI',
      status: 'idle'
    }));
  }, 10000);
});

ws.on('message', (msg) => {
  const data = JSON.parse(msg);
  console.log('📩 Orden recibida del Dashboard:', data);

  if (data.action === 'record') {
    const duration = data.durationSeconds;
    console.log(`🎙️ Simulando grabación de audio por ${duration} segundos...`);
    
    // Notificar estado grabando
    ws.send(JSON.stringify({
      type: 'status_update',
      status: 'recording',
      battery: 88,
      activeRecording: { durationSeconds: duration, startedAt: Date.now() }
    }));

    setTimeout(() => {
      console.log('⬆️ Grabación simulada finalizada. Subiendo archivo al servidor...');
      
      // Crear archivo de audio simulado
      const tempFile = path.join(__dirname, 'temp_simulated.m4a');
      fs.writeFileSync(tempFile, 'SIMULATED_AUDIO_BINARY_DATA');

      uploadSimulatedFile(tempFile, duration, () => {
        console.log('✅ Audio simulado subido correctamente al dashboard');
        ws.send(JSON.stringify({
          type: 'status_update',
          status: 'idle',
          battery: 87
        }));
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      });
    }, Math.min(duration * 1000, 3000)); // En simulación responde en máx 3 segundos para pruebas
  }
});

function uploadSimulatedFile(filePath, duration, callback) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const fileData = fs.readFileSync(filePath);

  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="audio"; filename="simulated_${Date.now()}.m4a"\r\n`;
  body += `Content-Type: audio/mp4\r\n\r\n`;
  
  const postDataStart = Buffer.from(body, 'utf8');
  
  let endBody = `\r\n--${boundary}\r\n`;
  endBody += `Content-Disposition: form-data; name="durationSeconds"\r\n\r\n${duration}\r\n`;
  endBody += `--${boundary}\r\n`;
  endBody += `Content-Disposition: form-data; name="deviceName"\r\n\r\nSimulador Android Maquinaria\r\n`;
  endBody += `--${boundary}--\r\n`;
  const postDataEnd = Buffer.from(endBody, 'utf8');

  const fullPayload = Buffer.concat([postDataStart, fileData, postDataEnd]);

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/upload',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullPayload.length
    }
  }, (res) => {
    callback();
  });

  req.write(fullPayload);
  req.end();
}
