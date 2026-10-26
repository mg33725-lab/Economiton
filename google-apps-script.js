/**
 * ==============================================================
 * ECONOMITIN - CONECTOR PARA GOOGLE SHEETS
 * ==============================================================
 * 
 * Instrucciones:
 * 1. En tu Google Sheet, andá a: Extensiones > Apps Script
 * 2. Borrá todo y pegá este código completo.
 * 3. Hacé clic en: Implementar > Administrar implementaciones
 * 4. Tocá el lápiz (Editar) > Versión: "Nueva versión" > Implementar.
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput("OK");
    }

    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // Usa la hoja 'Gastos' o la primera hoja visible
    var sheet = ss.getSheetByName("Gastos") || ss.getSheets()[0];

    // Si viene un gasto directo desde el bot
    if (data.monto !== undefined) {
      // Si la hoja está vacía, crear encabezados
      if (sheet.getLastRow() === 0) {
        sheet.appendRow([
          "Fecha",
          "Hora",
          "Persona",
          "Comercio",
          "Detalle",
          "Monto",
          "Categoría",
          "Mensaje Original"
        ]);
        sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#e8f0fe");
      }

      // Agregar fila con los datos
      sheet.appendRow([
        data.fecha,
        data.hora,
        data.persona,
        data.comercio,
        data.detalle,
        data.monto,
        data.categoria,
        data.mensajeOriginal
      ]);

      // Formatear columna F como moneda
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow, 6).setNumberFormat("$ #,##0");

      return ContentService.createTextOutput("OK");
    }

    // Si viene comando de reset
    if (data.action === "reset") {
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
      }
      return ContentService.createTextOutput("OK");
    }

    return ContentService.createTextOutput("OK");
  } catch (error) {
    return ContentService.createTextOutput("Error: " + error.message);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("Economitin Webhook Activo");
}
