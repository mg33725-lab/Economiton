require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const CSV_FILE_PATH = path.join(__dirname, 'gastos.csv');

async function syncAllToSheets() {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('Falta GOOGLE_SHEET_WEBHOOK_URL en .env');
    return;
  }

  const content = fs.readFileSync(CSV_FILE_PATH, 'utf8');
  const lines = content.trim().split('\n').slice(1);

  console.log(`📤 Sincronizando ${lines.length} gastos pendientes a Google Sheets...`);

  for (const line of lines) {
    if (!line.trim()) continue;
    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (!matches || matches.length < 7) continue;

    const data = {
      fecha: matches[0].replace(/"/g, ''),
      hora: matches[1].replace(/"/g, ''),
      persona: matches[2].replace(/"/g, ''),
      comercio: matches[3].replace(/"/g, ''),
      detalle: matches[4].replace(/"/g, ''),
      monto: parseFloat(matches[5].replace(/"/g, '')) || 0,
      categoria: matches[6].replace(/"/g, ''),
      mensajeOriginal: matches[7]?.replace(/"/g, '') || ''
    };

    try {
      await axios.post(webhookUrl, data);
      console.log(`✅ Fila enviada: ${data.persona} - $${data.monto} (${data.detalle})`);
    } catch (e) {
      console.error(`❌ Error enviando fila:`, e.message);
    }
  }

  console.log('🎉 Sincronización finalizada.');
}

syncAllToSheets();
