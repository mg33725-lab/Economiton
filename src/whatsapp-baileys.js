require('dotenv').config();
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  downloadMediaMessage,
  Browsers 
} = require('@whiskeysockets/baileys');

const { parseExpenseFromText, parseExpenseFromAudio } = require('./services/gemini');
const { recordExpense, getMonthlyStatsFromCsv } = require('./services/sheets');

const AUTH_FOLDER = path.join(__dirname, '..', 'auth_info_baileys');
const QR_HTML_PATH = path.join(__dirname, '..', 'qr.html');

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount);
}

function getSenderName(msg) {
  return msg.pushName || (msg.key.participant || msg.key.remoteJid).split('@')[0];
}

// Obtener número para vincular por código si se pasa por argumento o .env
const phoneArgIndex = process.argv.indexOf('--phone');
const pairingNumber = (phoneArgIndex !== -1 ? process.argv[phoneArgIndex + 1] : null) || process.env.WHATSAPP_PAIRING_NUMBER;

async function startWhatsAppBot() {
  console.log('🚀 Iniciando servicio de WhatsApp (Baileys)...');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: !pairingNumber
  });

  sock.ev.on('creds.update', saveCreds);

  // Si se solicitó vincular por número de teléfono (código de 8 dígitos)
  if (pairingNumber && !sock.authState.creds.registered) {
    const cleanNumber = pairingNumber.replace(/\D/g, '');
    console.log(`📲 Solicitando código de vinculación para el número: +${cleanNumber}...`);
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanNumber);
        console.log('\n======================================================');
        console.log(`🔑 TU CÓDIGO DE VINCULACIÓN ES:  ${code}`);
        console.log('------------------------------------------------------');
        console.log('1. Abrí WhatsApp en tu celular.');
        console.log('2. Andá a Dispositivos vinculados > Vincular un dispositivo.');
        console.log('3. Abajo tocá "Vincular con el número de teléfono".');
        console.log(`4. Escribí el código: ${code}`);
        console.log('======================================================\n');
      } catch (err) {
        console.error('Error al solicitar código de vinculación:', err.message);
      }
    }, 4000);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !pairingNumber) {
      console.log('\n======================================================');
      console.log('📱 ESCANEÁ ESTE CÓDIGO QR CON TU WHATSAPP (SE ACTUALIZA EN VIVO):');
      console.log('(WhatsApp > Dispositivos Vinculados > Vincular dispositivo)');
      console.log('======================================================\n');
      qrcodeTerminal.generate(qr, { small: true });

      // Generar HTML con autorefresh cada 4 segundos para que nunca esté vencido
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
        const nowTime = new Date().toLocaleTimeString();
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta http-equiv="refresh" content="4">
              <title>Escanear WhatsApp - Economitin</title>
            </head>
            <body style="font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #eef2f6;">
              <div style="background: white; padding: 35px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); text-align: center; max-width: 420px;">
                <h2 style="margin-top: 0; color: #128c7e;">📱 Vincular WhatsApp a Economitin</h2>
                <p style="color: #444; font-size: 15px; line-height: 1.5;">
                  1. Abrí <b>WhatsApp</b> en tu celular.<br>
                  2. Tocá <b>Dispositivos vinculados</b> > <b>Vincular dispositivo</b>.<br>
                  3. Escaneá este código QR en vivo:
                </p>
                <div style="padding: 10px; background: #fafafa; border: 2px dashed #25d366; border-radius: 12px; display: inline-block;">
                  <img src="${qrDataUrl}" style="display: block; border-radius: 8px;">
                </div>
                <p style="color: #888; font-size: 13px; margin-top: 15px;">
                  🔄 Actualizado a las ${nowTime} (se refresca automáticamente cada 4s).
                </p>
              </div>
            </body>
          </html>
        `;
        fs.writeFileSync(QR_HTML_PATH, html, 'utf8');
      } catch (err) {}
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Conexión cerrada. Motivo: ${lastDisconnect?.error?.message || statusCode}. ¿Reconectar?: ${shouldReconnect}`);
      if (shouldReconnect) {
        startWhatsAppBot();
      } else {
        console.log('❌ Sesión cerrada permanentemente. Limpiando para volver a intentar...');
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        startWhatsAppBot();
      }
    } else if (connection === 'open') {
      console.log('\n======================================================');
      console.log('✅ ¡WHATSAPP CONECTADO EXITOSAMENTE!');
      console.log('🟢 Economitin está listo y escuchando audios y mensajes.');
      console.log('======================================================\n');
      if (fs.existsSync(QR_HTML_PATH)) {
        try { fs.unlinkSync(QR_HTML_PATH); } catch (e) {}
      }
    }
  });

  // Escuchar mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid === 'status@broadcast') continue;

      const senderName = getSenderName(msg);
      const isAudio = msg.message?.audioMessage;
      const textMessage = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

      // 1. Mensaje de texto
      if (textMessage) {
        const text = textMessage.trim();
        console.log(`\n💬 Texto de ${senderName}: "${text}"`);

        const lower = text.toLowerCase();
        if (lower.includes('cuanto gastamos') || lower.includes('cuánto gastamos') || lower.includes('total mes') || lower.includes('resumen')) {
          const stats = getMonthlyStatsFromCsv();
          let desglose = '';
          for (const [p, total] of Object.entries(stats.porPersona)) {
            desglose += `• ${p}: ${formatCurrency(total)}\n`;
          }

          const replySummary = 
            `📊 *Resumen de Gastos del Mes*\n\n` +
            `💰 *Total acumulado:* ${formatCurrency(stats.totalMes)}\n\n` +
            `*Por persona:*\n${desglose || 'Sin gastos registrados este mes.'}\n` +
            `_Para registrar un gasto, mandá un audio o texto (ej: "Gasté 33 mil en el kiosco")_`;

          await sock.sendMessage(remoteJid, { text: replySummary }, { quoted: msg });
          continue;
        }

        try {
          console.log('🧠 Procesando texto con Gemini...');
          const parsed = await parseExpenseFromText(text);

          if (parsed && parsed.es_gasto && parsed.monto > 0) {
            const { expenseData, stats, savedToSheets } = await recordExpense({
              persona: senderName,
              monto: parsed.monto,
              comercio: parsed.comercio,
              detalle: parsed.detalle,
              categoria: parsed.categoria,
              mensajeOriginal: text
            });

            let desgloseMensual = Object.entries(stats.porPersona)
              .map(([p, m]) => `${p}: ${formatCurrency(m)}`)
              .join(' | ');

            const reply = 
              `✅ *Gasto Registrado*\n\n` +
              `💵 *Monto:* ${formatCurrency(expenseData.monto)}\n` +
              `🏪 *Lugar:* ${expenseData.comercio}\n` +
              `🏷️ *Categoría:* ${expenseData.categoria}\n` +
              `📝 *Detalle:* ${expenseData.detalle}\n` +
              `👤 *Anotado por:* ${senderName}\n\n` +
              `📊 *Total mes:* ${formatCurrency(stats.totalMes)}\n` +
              `(${desgloseMensual})\n` +
              (savedToSheets ? `☁️ _Sincronizado con Google Sheets_` : `📁 _Anotado en planilla_`);

            await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
            console.log(`✅ Gasto guardado: $${expenseData.monto}`);
          }
        } catch (err) {
          console.error('❌ Error al procesar texto con Gemini:', err.message);
        }
      }

      // 2. Nota de voz / Audio
      if (isAudio) {
        console.log(`\n🎙️ Audio recibido de ${senderName}...`);

        try {
          console.log('📥 Descargando nota de voz...');
          const audioBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger, reuploadRequest: sock.updateMediaMessage }
          );

          console.log(`🧠 Enviando audio (${audioBuffer.length} bytes) a Gemini...`);
          const parsed = await parseExpenseFromAudio(audioBuffer, isAudio.mimetype || 'audio/ogg; codecs=opus');

          if (parsed && parsed.es_gasto && parsed.monto > 0) {
            const { expenseData, stats, savedToSheets } = await recordExpense({
              persona: senderName,
              monto: parsed.monto,
              comercio: parsed.comercio,
              detalle: parsed.detalle,
              categoria: parsed.categoria,
              mensajeOriginal: '[Nota de voz]'
            });

            let desgloseMensual = Object.entries(stats.porPersona)
              .map(([p, m]) => `${p}: ${formatCurrency(m)}`)
              .join(' | ');

            const reply = 
              `✅ *Gasto Registrado por Audio*\n\n` +
              `💵 *Monto:* ${formatCurrency(expenseData.monto)}\n` +
              `🏪 *Lugar:* ${expenseData.comercio}\n` +
              `🏷️ *Categoría:* ${expenseData.categoria}\n` +
              `📝 *Detalle:* ${expenseData.detalle}\n` +
              `👤 *Anotado por:* ${senderName}\n\n` +
              `📊 *Total mes:* ${formatCurrency(stats.totalMes)}\n` +
              `(${desgloseMensual})\n` +
              (savedToSheets ? `☁️ _Sincronizado con Google Sheets_` : `📁 _Anotado en planilla_`);

            await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
            console.log(`✅ Gasto por audio guardado: $${expenseData.monto}`);
          }
        } catch (err) {
          console.error('❌ Error al procesar audio con Gemini:', err.message);
        }
      }
    }
  });
}

startWhatsAppBot().catch(err => console.error('Error fatal al iniciar bot:', err));
