const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CSV_FILE_PATH = path.join(__dirname, '..', '..', 'gastos.csv');

// Inicializar archivo CSV local si no existe (con BOM UTF-8 para compatibilidad directa con Excel)
function initLocalCsv() {
  if (!fs.existsSync(CSV_FILE_PATH)) {
    const headers = 'Fecha,Hora,Persona,Comercio,Detalle,Monto,Categoria,Mensaje Original\n';
    fs.writeFileSync(CSV_FILE_PATH, '\ufeff' + headers, 'utf8');
  }
}

/**
 * Guarda el gasto en el archivo CSV local.
 */
function saveExpenseToLocalCsv(expenseData) {
  initLocalCsv();
  
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

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

/**
 * Obtiene el total del mes actual desde el CSV local para el reporte rápido.
 */
function getMonthlyStatsFromCsv() {
  initLocalCsv();
  const content = fs.readFileSync(CSV_FILE_PATH, 'utf8');
  const lines = content.trim().split('\n').slice(1); // saltar headers

  const now = new Date();
  const currentMonthYear = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`; // ej: 10/2026

  let totalMes = 0;
  const porPersona = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    // Parse básico de CSV respetando comillas
    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (!matches || matches.length < 6) continue;

    const fecha = matches[0].replace(/"/g, ''); // "DD/MM/YYYY"
    const persona = matches[2].replace(/"/g, '');
    const monto = parseFloat(matches[5].replace(/"/g, '')) || 0;

    if (fecha.includes(currentMonthYear)) {
      totalMes += monto;
      porPersona[persona] = (porPersona[persona] || 0) + monto;
    }
  }

  return { totalMes, porPersona };
}

const DEFAULT_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyja7RdoBAod6FfcPq1uxhmvDnhOs1oRrr20oONRiPKNlOxfUpAmKa9Rz1NKmG5cSOD/exec';

/**
 * Guarda en Google Sheets mediante Webhook de Google Apps Script (el método más sencillo y rápido)
 */
async function saveExpenseToGoogleSheetsWebhook(expenseData) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL || DEFAULT_SHEETS_URL;
  if (!webhookUrl) return false;
  try {
    const axios = require('axios');
    const res = await axios.post(webhookUrl, expenseData);
    console.log(`📊 Envío a Google Sheets: Status ${res.status} (${res.data})`);
    return true;
  } catch (err) {
    console.error('❌ Error al enviar a Google Sheets Webhook:', err.message);
    return false;
  }
}

/**
 * Guarda en Google Sheets si están las credenciales configuradas en .env o archivo json.
 */
async function saveExpenseToGoogleSheets(expenseData) {
  // 1. Probar primero si hay Webhook URL configurado
  if (process.env.GOOGLE_SHEET_WEBHOOK_URL || DEFAULT_SHEETS_URL) {
    return await saveExpenseToGoogleSheetsWebhook(expenseData);
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!spreadsheetId || !clientEmail || !privateKey) {
    // Si no están configuradas las credenciales de Google Sheets, operamos en modo CSV local
    return false;
  }

  try {
    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });

    // Agregar fila en la hoja 'Gastos'
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Gastos!A:H',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          expenseData.fecha,
          expenseData.hora,
          expenseData.persona,
          expenseData.comercio,
          expenseData.detalle,
          expenseData.monto,
          expenseData.categoria,
          expenseData.mensajeOriginal
        ]]
      }
    });

    return true;
  } catch (error) {
    console.error('Error al guardar en Google Sheets:', error.message);
    return false;
  }
}

/**
 * Función principal que guarda el gasto tanto en CSV local (backup siempre disponible)
 * como en Google Sheets si está configurado.
 */
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

  // 1. Guardar en CSV local (funciona sin internet y sin configurar nada extra)
  saveExpenseToLocalCsv(expenseData);

  // 2. Guardar en Google Sheets (si está configurado)
  const savedToSheets = await saveExpenseToGoogleSheets(expenseData);

  // 3. Obtener resumen acumulado del mes
  const stats = getMonthlyStatsFromCsv();

  return {
    expenseData,
    stats,
    savedToSheets
  };
}

// Reiniciar archivo CSV local a cero
function resetLocalCsv() {
  const headers = 'Fecha,Hora,Persona,Comercio,Detalle,Monto,Categoria,Mensaje Original\n';
  fs.writeFileSync(CSV_FILE_PATH, '\ufeff' + headers, 'utf8');
}

module.exports = {
  recordExpense,
  getMonthlyStatsFromCsv,
  resetLocalCsv,
  CSV_FILE_PATH
};
