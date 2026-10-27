const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');

const CSV_FILE_PATH = path.join(__dirname, '..', '..', 'gastos.csv');
const DEFAULT_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxdXTmMIsXvqQQQfSteeZCtIuJgHyXIqoINvzv01NLMtd-86-eiXyCt6w03Ko0eswVQ/exec';

function getWebhookUrls() {
  const urls = [DEFAULT_SHEETS_URL];
  if (process.env.GOOGLE_SHEET_WEBHOOK_URL && process.env.GOOGLE_SHEET_WEBHOOK_URL !== DEFAULT_SHEETS_URL) {
    urls.push(process.env.GOOGLE_SHEET_WEBHOOK_URL);
  }
  return urls;
}

function initLocalCsv() {
  if (!fs.existsSync(CSV_FILE_PATH)) {
    const headers = 'Fecha,Hora,Persona,Comercio,Detalle,Monto,Categoria,Mensaje Original\n';
    fs.writeFileSync(CSV_FILE_PATH, '\ufeff' + headers, 'utf8');
  }
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

function saveExpenseToLocalCsv(expenseData) {
  initLocalCsv();

  const row = [
    escapeCsv(expenseData.fecha),
    escapeCsv(expenseData.hora),
    escapeCsv(expenseData.persona),
    escapeCsv(expenseData.comercio),
    escapeCsv(expenseData.detalle),
    expenseData.monto,
    escapeCsv(expenseData.categoria),
    escapeCsv(expenseData.mensajeOriginal)
  ].join(',') + '\n';

  fs.appendFileSync(CSV_FILE_PATH, row, 'utf8');
}

function getMonthlyStatsFromCsv() {
  initLocalCsv();
  const content = fs.readFileSync(CSV_FILE_PATH, 'utf8');
  const lines = content.trim().split('\n').slice(1);

  const now = new Date();
  const currentMonthYear = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  let totalMes = 0;
  const porPersona = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (!matches || matches.length < 6) continue;

    const fecha = matches[0].replace(/"/g, '');
    const persona = matches[2].replace(/"/g, '');
    const monto = parseFloat(matches[5].replace(/"/g, '')) || 0;

    if (fecha.includes(currentMonthYear)) {
      totalMes += monto;
      porPersona[persona] = (porPersona[persona] || 0) + monto;
    }
  }

  return { totalMes, porPersona };
}

async function postToSheetsWebhook(payload) {
  const urlsToTry = getWebhookUrls();
  for (const url of urlsToTry) {
    try {
      const res = await axios.post(url, payload, { timeout: 10000 });
      console.log(`📊 Respuesta Google Sheets: Status ${res.status}`, typeof res.data === 'object' ? JSON.stringify(res.data) : res.data);
      return { ok: true, data: res.data };
    } catch (err) {
      console.warn(`⚠️ Intento en ${url.slice(-15)} falló: ${err.message}`);
    }
  }
  return { ok: false, data: null };
}

async function recordExpense({ persona, monto, comercio, detalle, categoria, mensajeOriginal }) {
  const now = new Date();
  const fecha = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const hora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const expenseData = {
    fecha,
    hora,
    persona,
    comercio: comercio || 'Varios',
    detalle: detalle || comercio || 'Gasto registrado',
    monto: Number(monto) || 0,
    categoria: categoria || 'Otros',
    mensajeOriginal: mensajeOriginal || ''
  };

  // 1. Guardar en CSV local
  saveExpenseToLocalCsv(expenseData);

  // 2. Guardar en Google Sheets y obtener las estadísticas reales si el script devuelve JSON
  const sheetRes = await postToSheetsWebhook(expenseData);
  const savedToSheets = sheetRes.ok;

  let stats = getMonthlyStatsFromCsv();
  if (sheetRes.ok && sheetRes.data && typeof sheetRes.data === 'object' && sheetRes.data.stats) {
    stats = sheetRes.data.stats;
  }

  return {
    expenseData,
    stats,
    savedToSheets
  };
}

/**
 * Deshace (elimina) el último gasto registrado tanto en CSV local como en Google Sheets.
 */
async function undoLastExpense() {
  initLocalCsv();
  const content = fs.readFileSync(CSV_FILE_PATH, 'utf8');
  const lines = content.trim().split('\n');

  let deletedLocal = null;
  if (lines.length > 1) {
    const lastLine = lines.pop();
    const matches = lastLine.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (matches && matches.length >= 7) {
      deletedLocal = {
        fecha: matches[0].replace(/"/g, ''),
        hora: matches[1].replace(/"/g, ''),
        persona: matches[2].replace(/"/g, ''),
        comercio: matches[3].replace(/"/g, ''),
        detalle: matches[4].replace(/"/g, ''),
        monto: parseFloat(matches[5].replace(/"/g, '')) || 0,
        categoria: matches[6].replace(/"/g, '')
      };
    }
    fs.writeFileSync(CSV_FILE_PATH, lines.join('\n') + '\n', 'utf8');
  }

  const sheetRes = await postToSheetsWebhook({ action: 'undo' });
  let stats = getMonthlyStatsFromCsv();
  let deleted = deletedLocal;

  if (sheetRes.ok && sheetRes.data && typeof sheetRes.data === 'object') {
    if (sheetRes.data.stats) stats = sheetRes.data.stats;
    if (sheetRes.data.deleted) deleted = sheetRes.data.deleted;
  }

  return {
    ok: Boolean(deleted),
    deleted,
    stats
  };
}

/**
 * Edita el último gasto registrado tanto en CSV local como en Google Sheets.
 */
async function editLastExpense({ monto, comercio, detalle, categoria }) {
  initLocalCsv();
  const content = fs.readFileSync(CSV_FILE_PATH, 'utf8');
  const lines = content.trim().split('\n');

  let updatedLocal = null;
  let previousMonto = 0;

  if (lines.length > 1) {
    const lastLine = lines.pop();
    const matches = lastLine.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (matches && matches.length >= 7) {
      const fecha = matches[0].replace(/"/g, '');
      const hora = matches[1].replace(/"/g, '');
      const persona = matches[2].replace(/"/g, '');
      const oldComercio = matches[3].replace(/"/g, '');
      const oldDetalle = matches[4].replace(/"/g, '');
      previousMonto = parseFloat(matches[5].replace(/"/g, '')) || 0;
      const oldCat = matches[6].replace(/"/g, '');
      const oldMsg = matches[7] ? matches[7].replace(/"/g, '') : '';

      const newMonto = (monto && monto > 0) ? Number(monto) : previousMonto;
      const newComercio = (comercio && comercio !== 'Desconocido' && comercio !== 'Varios') ? comercio : oldComercio;
      const newDetalle = (detalle && detalle !== 'Sin detalle' && detalle !== 'Gasto registrado') ? detalle : oldDetalle;
      const newCat = (categoria && categoria !== 'Otros') ? categoria : oldCat;

      updatedLocal = {
        fecha,
        hora,
        persona,
        comercio: newComercio,
        detalle: newDetalle,
        monto: newMonto,
        categoria: newCat
      };

      const newRow = [
        escapeCsv(fecha),
        escapeCsv(hora),
        escapeCsv(persona),
        escapeCsv(newComercio),
        escapeCsv(newDetalle),
        newMonto,
        escapeCsv(newCat),
        escapeCsv(oldMsg)
      ].join(',');

      lines.push(newRow);
      fs.writeFileSync(CSV_FILE_PATH, lines.join('\n') + '\n', 'utf8');
    }
  }

  const sheetRes = await postToSheetsWebhook({
    action: 'edit',
    monto,
    comercio,
    detalle,
    categoria
  });

  let stats = getMonthlyStatsFromCsv();
  let updated = updatedLocal;

  if (sheetRes.ok && sheetRes.data && typeof sheetRes.data === 'object') {
    if (sheetRes.data.stats) stats = sheetRes.data.stats;
    if (sheetRes.data.updated) updated = sheetRes.data.updated;
    if (sheetRes.data.previousMonto !== undefined) previousMonto = sheetRes.data.previousMonto;
  }

  return {
    ok: Boolean(updated),
    previousMonto,
    updated,
    stats
  };
}

/**
 * Obtiene el resumen sincronizado (consulta primero Google Sheets si devuelve JSON, sino CSV local)
 */
async function getSyncedMonthlyStats() {
  const sheetRes = await postToSheetsWebhook({ action: 'summary' });
  if (sheetRes.ok && sheetRes.data && typeof sheetRes.data === 'object' && sheetRes.data.stats) {
    return sheetRes.data.stats;
  }
  return getMonthlyStatsFromCsv();
}

function resetLocalCsv() {
  const headers = 'Fecha,Hora,Persona,Comercio,Detalle,Monto,Categoria,Mensaje Original\n';
  fs.writeFileSync(CSV_FILE_PATH, '\ufeff' + headers, 'utf8');
  postToSheetsWebhook({ action: 'reset' }).catch(() => {});
}

module.exports = {
  recordExpense,
  undoLastExpense,
  editLastExpense,
  getMonthlyStatsFromCsv,
  getSyncedMonthlyStats,
  resetLocalCsv,
  CSV_FILE_PATH
};
