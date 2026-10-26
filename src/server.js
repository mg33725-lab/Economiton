require('dotenv').config();
const express = require('express');
const { parseExpenseFromText, parseExpenseFromAudio } = require('./services/gemini');
const { downloadWhatsAppMedia, sendWhatsAppMessage } = require('./services/whatsapp');
const { recordExpense, getMonthlyStatsFromCsv } = require('./services/sheets');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'economitin_token_secreto_2026';

// Mapeo opcional de teléfonos a nombres
function getPersonName(fromNumber, contactName) {
  const phone1 = process.env.PHONE_USER_1?.replace(/\D/g, '');
  const phone2 = process.env.PHONE_USER_2?.replace(/\D/g, '');
  const cleanFrom = fromNumber?.replace(/\D/g, '');

  if (phone1 && cleanFrom && cleanFrom.includes(phone1)) {
    return process.env.NAME_USER_1 || 'Usuario 1';
  }
  if (phone2 && cleanFrom && cleanFrom.includes(phone2)) {
    return process.env.NAME_USER_2 || 'Usuario 2';
  }
  return contactName || `+${fromNumber}`;
}

// Formateador de moneda (estilo Argentina: $ 33.000)
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount);
}

// 1. Ruta de prueba / Estado del bot
app.get('/', (req, res) => {
  const stats = getMonthlyStatsFromCsv();
  res.json({
    status: 'online',
    bot: 'Economitin Gastos Bot',
    mesActual: {
      total: formatCurrency(stats.totalMes),
      porPersona: stats.porPersona
    }
  });
});

// 2. Verificación del Webhook por parte de Meta (GET /webhook)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado con éxito por Meta.');
      return res.status(200).send(challenge);
    } else {
      console.warn('❌ Token de verificación incorrecto en /webhook.');
      return res.sendStatus(403);
    }
  }

  res.sendStatus(400);
});

// 3. Recepción de mensajes de WhatsApp (POST /webhook)
app.post('/webhook', async (req, res) => {
  // Respondemos 200 inmediatamente a Meta para cumplir con el timeout de 3 segundos
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    // Verificar si es un evento de mensaje de WhatsApp
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (!message) {
      // Puede ser una notificación de estado (entregado, leído, etc.)
      return;
    }

    const from = message.from; // Número del remitente (ej: "54911xxxxxxxx")
    const contactName = change?.contacts?.[0]?.profile?.name || '';
    const persona = getPersonName(from, contactName);
    const messageType = message.type;

    console.log(`\n📩 Nuevo mensaje recibido de ${persona} (${from}) [Tipo: ${messageType}]`);

    let parsedExpense = null;
    let mensajeOriginal = '';

    // A. Si es un mensaje de voz o audio
    if (messageType === 'audio' || messageType === 'voice') {
      const mediaId = message.audio?.id || message.voice?.id;
      console.log(`🎙️ Descargando audio ID: ${mediaId}...`);
      
      const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);
      console.log(`🧠 Procesando audio con Google Gemini...`);
      
      parsedExpense = await parseExpenseFromAudio(buffer, mimeType);
      mensajeOriginal = '[Nota de voz procesada por Gemini]';
    } 
    // B. Si es un mensaje de texto
    else if (messageType === 'text') {
      const text = message.text.body.trim();
      mensajeOriginal = text;
      console.log(`💬 Texto recibido: "${text}"`);

      // Consulta de saldo / total rápido
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
          `_Para agregar un gasto, mandame un audio o texto (ej: "Gasté 33 mil en el kiosco")_`;

        await sendWhatsAppMessage(from, replySummary);
        return;
      }

      console.log(`🧠 Analizando texto con Google Gemini...`);
      parsedExpense = await parseExpenseFromText(text);
    } else {
      console.log(`ℹ️ Mensaje ignorado de tipo no soportado: ${messageType}`);
      return;
    }

    // C. Si la IA detectó que es un gasto
    if (parsedExpense && parsedExpense.es_gasto && parsedExpense.monto > 0) {
      console.log(`💾 Guardando gasto: $${parsedExpense.monto} en ${parsedExpense.comercio}...`);

      const { expenseData, stats, savedToSheets } = await recordExpense({
        persona,
        monto: parsedExpense.monto,
        comercio: parsedExpense.comercio,
        detalle: parsedExpense.detalle,
        categoria: parsedExpense.categoria,
        mensajeOriginal
      });

      // Formatear respuesta amigable para WhatsApp
      let desgloseMensual = Object.entries(stats.porPersona)
        .map(([p, m]) => `${p}: ${formatCurrency(m)}`)
        .join(' | ');

      const confirmationMessage = 
        `✅ *Gasto Registrado*\n\n` +
        `💵 *Monto:* ${formatCurrency(expenseData.monto)}\n` +
        `🏪 *Lugar:* ${expenseData.comercio}\n` +
        `🏷️ *Categoría:* ${expenseData.categoria}\n` +
        `📝 *Detalle:* ${expenseData.detalle}\n` +
        `👤 *Anotado por:* ${persona}\n\n` +
        `📊 *Total mes:* ${formatCurrency(stats.totalMes)}\n` +
        `(${desgloseMensual})\n` +
        (savedToSheets ? `☁️ _Sincronizado con Google Sheets_` : `📁 _Guardado localmente en CSV_`);

      await sendWhatsAppMessage(from, confirmationMessage);
      console.log(`✅ Confirmación enviada a ${from}`);
    } else {
      // No era un gasto
      console.log(`ℹ️ El mensaje no fue interpretado como un gasto.`);
      if (parsedExpense?.observacion) {
        await sendWhatsAppMessage(
          from,
          `ℹ️ No pude registrar un gasto con ese mensaje.\n_${parsedExpense.observacion}_\n\nProbá con: *"Gasté 33 mil en el kiosco alfajor y coca"*`
        );
      }
    }
  } catch (error) {
    console.error('❌ Error procesando el webhook:', error);
  }
});

app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Servidor Economitin corriendo en el puerto ${PORT}`);
  console.log(`📡 Endpoint del Webhook: http://localhost:${PORT}/webhook`);
  console.log(`=================================================\n`);
});
