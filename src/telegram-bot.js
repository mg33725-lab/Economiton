require('dotenv').config();
const http = require('http');
const { Bot } = require('node-telegram-bot-api');
const axios = require('axios');
const { parseExpenseFromText, parseExpenseFromAudio } = require('./services/gemini');
const { recordExpense, getMonthlyStatsFromCsv, resetLocalCsv } = require('./services/sheets');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ Falta TELEGRAM_BOT_TOKEN en el archivo .env');
  process.exit(1);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount);
}

function getSenderName(ctx) {
  if (ctx.from?.first_name) {
    return ctx.from.first_name;
  }
  return ctx.from?.username || 'Usuario';
}

const bot = new Bot(token);

async function responderResumen(ctx) {
  const stats = getMonthlyStatsFromCsv();
  let desglose = '';
  for (const [p, total] of Object.entries(stats.porPersona)) {
    desglose += `• *${p}:* ${formatCurrency(total)}\n`;
  }

  const replySummary = 
    `📊 *Balance de Gastos del Mes*\n\n` +
    `💰 *Total acumulado:* ${formatCurrency(stats.totalMes)}\n\n` +
    `*Gastos por persona:*\n${desglose || 'Sin gastos registrados este mes.'}\n\n` +
    `_Para registrar un gasto nuevo, mandame un audio o texto (ej: "Gasté 10mil en el kiosco")._`;

  await ctx.reply(replySummary, { parse_mode: 'Markdown' });
}

// Comando /start
bot.command('start', async (ctx) => {
  const name = getSenderName(ctx);
  const welcomeText = 
    `¡Hola ${name}! 👋 Soy *Economitin*, tu asistente de gastos familiares 🪙\n\n` +
    `Podés mandarme *audios* o *textos* cada vez que hagas un gasto:\n` +
    `🎙️ _"Gasté 10 mil pesos en el kiosco comprando alfajores"_\n` +
    `💬 _"45 lucas de nafta en la YPF"_\n\n` +
    `Yo me encargo de:\n` +
    `✅ Extraer el monto exacto, comercio y categoría con IA (Gemini).\n` +
    `✅ Anotarlo en tu planilla y en el archivo local.\n` +
    `✅ Llevar el control mensual de cuánto van gastando vos y tu mujer.\n\n` +
    `📌 *Comando útil:* preguntame _"¿Cuánto gastamos en el mes?"_ o escribí /resumen para ver el balance.`;

  await ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// Comando /resumen
bot.command('resumen', async (ctx) => {
  await responderResumen(ctx);
});

// Comando /reset para poner el balance en $0
bot.command(['reset', 'borrar', 'limpiar'], async (ctx) => {
  resetLocalCsv();
  console.log('🧹 Gastos reseteados a $0 por usuario.');
  await ctx.reply(
    `🧹 *Gastos reseteados con éxito*\n\n` +
    `El balance mensual del bot vuelve a *$0*.\n\n` +
    `💡 _Nota: Para borrar las filas viejas en Google Sheets, simplemente entrá a tu planilla y borralas normalmente._`,
    { parse_mode: 'Markdown' }
  );
});

// Manejador principal de mensajes (Audios y Textos)
bot.on('message', async (ctx) => {
  const message = ctx.message;
  if (!message) return;

  const persona = getSenderName(ctx);

  // 1. Si es NOTA DE VOZ o AUDIO
  if (message.voice || message.audio) {
    const media = message.voice || message.audio;
    console.log(`\n🎙️ Audio recibido de ${persona} (${media.duration || 0} seg)...`);

    // Mensaje temporal para que el usuario sepa que la IA está trabajando
    const statusMsg = await ctx.reply('🎧 _Escuchando audio y calculando gasto..._', { parse_mode: 'Markdown' });

    try {
      const fileId = media.file_id;
      const file = await ctx.api.getFile({ file_id: fileId });
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      console.log('📥 Descargando archivo de audio de Telegram...');
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(response.data);

      console.log(`🧠 Procesando audio con Google Gemini...`);
      const parsed = await parseExpenseFromAudio(audioBuffer, 'audio/ogg');
      console.log('📦 Resultado IA:', JSON.stringify(parsed));

      if (parsed && parsed.es_gasto && parsed.monto > 0) {
        const { expenseData, stats, savedToSheets } = await recordExpense({
          persona,
          monto: parsed.monto,
          comercio: parsed.comercio,
          detalle: parsed.detalle,
          categoria: parsed.categoria,
          mensajeOriginal: '[Nota de voz]'
        });

        let desgloseMensual = Object.entries(stats.porPersona)
          .map(([p, m]) => `${p}: ${formatCurrency(m)}`)
          .join(' | ');

        const confirmation = 
          `✅ *Gasto Registrado por Audio*\n\n` +
          `💵 *Monto:* ${formatCurrency(expenseData.monto)}\n` +
          `🏪 *Lugar:* ${expenseData.comercio}\n` +
          `🏷️ *Categoría:* ${expenseData.categoria}\n` +
          `📝 *Detalle:* ${expenseData.detalle}\n` +
          `👤 *Anotado por:* ${persona}\n\n` +
          `📊 *Total mes:* ${formatCurrency(stats.totalMes)}\n` +
          `(${desgloseMensual})\n` +
          (savedToSheets ? `☁️ _Sincronizado con Google Sheets_` : `📁 _Anotado en planilla_`);

        await ctx.reply(confirmation, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(
          `ℹ️ No llegué a detectar un gasto en el audio.\nProbá diciendo claramente: *"Gasté 10 mil pesos en el kiosco"*`
        );
      }
    } catch (error) {
      console.error('❌ Error al procesar audio:', error);
      await ctx.reply('⚠️ Ocurrió un error al procesar el audio con la IA. Por favor, reintentá en un momento.');
    }
    return;
  }

  // 2. Si es MENSAJE DE TEXTO
  if (message.text) {
    const text = message.text.trim();
    if (text.startsWith('/')) return; // Ya manejado por bot.command

    console.log(`\n💬 Texto recibido de ${persona}: "${text}"`);

    const lower = text.toLowerCase();
    if (lower.includes('resetear') || lower.includes('borrar gastos') || lower.includes('reiniciar gastos') || lower.includes('limpiar gastos')) {
      resetLocalCsv();
      console.log('🧹 Gastos reseteados a $0 por usuario.');
      await ctx.reply(
        `🧹 *Gastos reseteados con éxito*\n\n` +
        `El balance mensual del bot vuelve a *$0*.\n\n` +
        `💡 _Nota: Para borrar las filas viejas en Google Sheets, simplemente entrá a tu planilla y borralas normalmente._`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (lower.includes('cuanto gastamos') || lower.includes('cuánto gastamos') || lower.includes('total mes') || lower.includes('balance')) {
      await responderResumen(ctx);
      return;
    }

    try {
      console.log('🧠 Analizando texto con Google Gemini...');
      const parsed = await parseExpenseFromText(text);
      console.log('📦 Resultado IA:', JSON.stringify(parsed));

      if (parsed && parsed.es_gasto && parsed.monto > 0) {
        const { expenseData, stats, savedToSheets } = await recordExpense({
          persona,
          monto: parsed.monto,
          comercio: parsed.comercio,
          detalle: parsed.detalle,
          categoria: parsed.categoria,
          mensajeOriginal: text
        });

        let desgloseMensual = Object.entries(stats.porPersona)
          .map(([p, m]) => `${p}: ${formatCurrency(m)}`)
          .join(' | ');

        const confirmation = 
          `✅ *Gasto Registrado*\n\n` +
          `💵 *Monto:* ${formatCurrency(expenseData.monto)}\n` +
          `🏪 *Lugar:* ${expenseData.comercio}\n` +
          `🏷️ *Categoría:* ${expenseData.categoria}\n` +
          `📝 *Detalle:* ${expenseData.detalle}\n` +
          `👤 *Anotado por:* ${persona}\n\n` +
          `📊 *Total mes:* ${formatCurrency(stats.totalMes)}\n` +
          `(${desgloseMensual})\n` +
          (savedToSheets ? `☁️ _Sincronizado con Google Sheets_` : `📁 _Anotado en planilla_`);

        await ctx.reply(confirmation, { parse_mode: 'Markdown' });
        console.log(`✅ Confirmación enviada.`);
      } else {
        if (parsed?.observacion) {
          await ctx.reply(
            `ℹ️ No pude interpretar un gasto con ese mensaje.\n_${parsed.observacion}_\n\nProbá con: *"Gasté 10 mil en el kiosco alfajor y gaseosa"*`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } catch (error) {
      console.error('❌ Error al procesar texto:', error);
      await ctx.reply('⚠️ Ocurrió un error al procesar el mensaje con la IA.');
    }
  }
});

// Manejo de errores globales del bot
bot.catch((err) => {
  console.error('Error no capturado en Telegram Bot:', err.error || err.message);
});

console.log('\n======================================================');
console.log('🤖 Economitin Telegram Bot INICIADO con éxito');
console.log('🟢 Conectado como: @Economitin_gastos_bot');
console.log('🟢 Escuchando audios y mensajes de texto en tiempo real...');
console.log('======================================================\n');

// Servidor HTTP ligero para que Render / hosting en la nube sepan que el servicio está vivo
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Economitin Bot Activo 24/7');
}).listen(PORT, () => {
  console.log(`📡 Health-check HTTP escuchando en puerto ${PORT} (listo para Render)`);
});

// Auto-ping anti-suspensión para Render (cada 10 minutos para evitar que se duerma)
const KEEP_ALIVE_URL = process.env.RENDER_EXTERNAL_URL || 'https://economiton.onrender.com';
setInterval(() => {
  console.log(`⏰ Enviando ping keep-alive a ${KEEP_ALIVE_URL}...`);
  axios.get(KEEP_ALIVE_URL)
    .then(() => console.log('✅ Keep-alive exitoso (evita suspensión de Render)'))
    .catch((err) => console.log('ℹ️ Keep-alive ping:', err.message));
}, 10 * 60 * 1000); // 10 minutos

// Bucle de conexión con reconexión automática si se corta o hay conflicto
async function runBot() {
  while (true) {
    try {
      console.log('🔄 Conectando polling con Telegram...');
      await bot.startPolling();
    } catch (err) {
      console.error('⚠️ Error en polling de Telegram:', err.message);
      console.log('⏳ Reintentando conexión en 5 segundos...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

runBot();
