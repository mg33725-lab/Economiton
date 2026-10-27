/**
 * ==============================================================
 * ECONOMITIN - GOOGLE SHEETS (SUMA MENSUAL + DESHACER + EDITAR)
 * ==============================================================
 * 
 * Funcionalidades:
 * 1. Crea automáticamente una pestaña por cada mes (ej: "Octubre 2026", "Noviembre 2026").
 * 2. Suma automáticamente todo lo gastado en el mes con fórmulas y panel de resumen.
 * 3. Soporta deshacer el último gasto (/deshacer) y editar el último gasto (/editar o por voz).
 * 4. Devuelve siempre el total real de la planilla al bot para que estén 100% sincronizados.
 */

var NOMBRES_MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

function obtenerNombreMes(fechaStr) {
  if (fechaStr && typeof fechaStr === "string" && fechaStr.indexOf("/") !== -1) {
    var partes = fechaStr.split("/");
    if (partes.length === 3) {
      var mesIndex = parseInt(partes[1], 10) - 1;
      var anio = partes[2];
      if (mesIndex >= 0 && mesIndex < 12) {
        return NOMBRES_MESES[mesIndex] + " " + anio;
      }
    }
  }
  var hoy = new Date();
  return NOMBRES_MESES[hoy.getMonth()] + " " + hoy.getFullYear();
}

function obtenerOCrearHojaMes(ss, nombreMes) {
  var sheet = ss.getSheetByName(nombreMes);
  if (!sheet) {
    var primeraHoja = ss.getSheets()[0];
    var nombrePrimera = primeraHoja.getName();
    if (nombrePrimera === "Hoja 1" || nombrePrimera === "Sheet1" || nombrePrimera === "Gastos") {
      primeraHoja.setName(nombreMes);
      sheet = primeraHoja;
    } else {
      sheet = ss.insertSheet(nombreMes, 0);
    }
  }

  if (sheet.getLastRow() === 0) {
    configurarEncabezados(sheet);
  } else {
    var primerValor = sheet.getRange(1, 1).getValue();
    if (primerValor !== "Fecha") {
      sheet.insertRowBefore(1);
      configurarEncabezados(sheet);
    }
  }

  return sheet;
}

function configurarEncabezados(sheet) {
  var headers = ["Fecha", "Hora", "Persona", "Comercio", "Detalle", "Monto", "Categoría", "Mensaje Original"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange("A1:H1")
    .setFontWeight("bold")
    .setBackground("#1a73e8")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

// Encuentra la última fila real con datos en las columnas A:H (ignorando el panel lateral J:K)
function obtenerUltimaFilaGastos(sheet) {
  var maxRows = sheet.getLastRow();
  if (maxRows <= 1) return 1;
  var colA = sheet.getRange(1, 1, maxRows, 6).getValues();
  for (var i = colA.length - 1; i >= 1; i--) {
    if (colA[i][0] !== "" || colA[i][5] !== "") {
      return i + 1;
    }
  }
  return 1;
}

function actualizarPanelResumenMes(sheet, nombreMes) {
  var lastExpenseRow = obtenerUltimaFilaGastos(sheet);
  var totalMes = 0;
  var porPersona = {};
  var porCategoria = {};

  if (lastExpenseRow > 1) {
    var datos = sheet.getRange(2, 1, lastExpenseRow - 1, 7).getValues();
    for (var i = 0; i < datos.length; i++) {
      var persona = String(datos[i][2] || "").trim();
      var monto = parseFloat(datos[i][5]) || 0;
      var categoria = String(datos[i][6] || "Otros").trim();

      if (monto > 0 && persona !== "") {
        totalMes += monto;
        porPersona[persona] = (porPersona[persona] || 0) + monto;
        porCategoria[categoria] = (porCategoria[categoria] || 0) + monto;
      }
    }
  }

  // Limpiar área del panel lateral (Columnas J y K)
  sheet.getRange("J1:K30").clearContent().clearFormat();

  // 1. Bloque Total General del Mes
  sheet.getRange("J1:K1").merge().setValue("📊 RESUMEN: " + nombreMes.toUpperCase())
    .setFontWeight("bold").setBackground("#1a73e8").setFontColor("#ffffff").setHorizontalAlignment("center");

  sheet.getRange("J2").setValue("💰 TOTAL GASTADO:").setFontWeight("bold").setBackground("#e6f4ea");
  sheet.getRange("K2").setFormula("=SUM(F2:F)").setFontWeight("bold").setFontSize(12).setBackground("#e6f4ea").setNumberFormat("$ #,##0");

  // 2. Desglose por Persona
  var filaActual = 4;
  sheet.getRange(filaActual, 10, 1, 2).setValues([["👤 Persona", "Subtotal"]])
    .setFontWeight("bold").setBackground("#e8f0fe");
  filaActual++;

  var personasKeys = Object.keys(porPersona);
  if (personasKeys.length === 0) {
    sheet.getRange(filaActual, 10, 1, 2).setValues([["Sin registros", 0]]);
    sheet.getRange(filaActual, 11).setNumberFormat("$ #,##0");
    filaActual++;
  } else {
    for (var p = 0; p < personasKeys.length; p++) {
      var kP = personasKeys[p];
      sheet.getRange(filaActual, 10, 1, 2).setValues([[kP, porPersona[kP]]]);
      sheet.getRange(filaActual, 11).setNumberFormat("$ #,##0");
      filaActual++;
    }
  }

  // 3. Desglose por Categoría
  filaActual++;
  sheet.getRange(filaActual, 10, 1, 2).setValues([["🏷️ Categoría", "Subtotal"]])
    .setFontWeight("bold").setBackground("#fce8e6");
  filaActual++;

  var catKeys = Object.keys(porCategoria);
  if (catKeys.length === 0) {
    sheet.getRange(filaActual, 10, 1, 2).setValues([["Sin registros", 0]]);
    sheet.getRange(filaActual, 11).setNumberFormat("$ #,##0");
    filaActual++;
  } else {
    for (var c = 0; c < catKeys.length; c++) {
      var kC = catKeys[c];
      sheet.getRange(filaActual, 10, 1, 2).setValues([[kC, porCategoria[kC]]]);
      sheet.getRange(filaActual, 11).setNumberFormat("$ #,##0");
      filaActual++;
    }
  }

  sheet.setColumnWidth(10, 190);
  sheet.setColumnWidth(11, 130);

  return { totalMes: totalMes, porPersona: porPersona };
}

function actualizarHojaResumenAnual(ss) {
  var nombreResumen = "📊 Resumen por Mes";
  var resSheet = ss.getSheetByName(nombreResumen);
  if (!resSheet) {
    resSheet = ss.insertSheet(nombreResumen, ss.getSheets().length);
  }

  resSheet.clearContents().clearFormats();
  resSheet.getRange("A1:C1").setValues([["Mes", "Cantidad de Gastos", "Total Gastado en el Mes"]])
    .setFontWeight("bold").setBackground("#137333").setFontColor("#ffffff");

  var allSheets = ss.getSheets();
  var fila = 2;

  for (var i = 0; i < allSheets.length; i++) {
    var s = allSheets[i];
    var sName = s.getName();
    if (sName === nombreResumen) continue;

    var lastR = obtenerUltimaFilaGastos(s);
    var cantGastos = lastR > 1 ? lastR - 1 : 0;

    resSheet.getRange(fila, 1).setValue(sName).setFontWeight("bold");
    resSheet.getRange(fila, 2).setValue(cantGastos);
    resSheet.getRange(fila, 3).setFormula("=SUM('" + sName + "'!F2:F)").setNumberFormat("$ #,##0").setFontWeight("bold");
    fila++;
  }

  if (fila > 2) {
    resSheet.getRange(fila, 1, 1, 2).merge().setValue("TOTAL ACUMULADO GENERAL").setFontWeight("bold").setBackground("#e6f4ea");
    resSheet.getRange(fila, 3).setFormula("=SUM(C2:C" + (fila - 1) + ")").setFontWeight("bold").setBackground("#e6f4ea").setNumberFormat("$ #,##0");
  }

  resSheet.setColumnWidth(1, 160);
  resSheet.setColumnWidth(2, 150);
  resSheet.setColumnWidth(3, 180);
}

function responderJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return responderJson({ ok: false, error: "Sin datos" });
    }

    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var nombreMes = obtenerNombreMes(data.fecha);
    var sheet = obtenerOCrearHojaMes(ss, nombreMes);

    // 1. COMANDO RESET: Limpiar todos los gastos del mes actual
    if (data.action === "reset") {
      var lastR = obtenerUltimaFilaGastos(sheet);
      if (lastR > 1) {
        sheet.getRange(2, 1, lastR - 1, 8).clearContent();
      }
      var statsReset = actualizarPanelResumenMes(sheet, nombreMes);
      actualizarHojaResumenAnual(ss);
      return responderJson({ ok: true, stats: statsReset });
    }

    // 2. COMANDO UNDO (/deshacer): Borrar el último gasto registrado
    if (data.action === "undo") {
      var lastRowUndo = obtenerUltimaFilaGastos(sheet);
      if (lastRowUndo <= 1) {
        var statsEmpty = actualizarPanelResumenMes(sheet, nombreMes);
        return responderJson({ ok: false, message: "No hay gastos para deshacer en este mes.", stats: statsEmpty });
      }

      var filaBorrada = sheet.getRange(lastRowUndo, 1, 1, 8).getValues()[0];
      var gastoBorrado = {
        fecha: filaBorrada[0],
        hora: filaBorrada[1],
        persona: filaBorrada[2],
        comercio: filaBorrada[3],
        detalle: filaBorrada[4],
        monto: filaBorrada[5],
        categoria: filaBorrada[6]
      };

      sheet.getRange(lastRowUndo, 1, 1, 8).clearContent();
      var statsAfterUndo = actualizarPanelResumenMes(sheet, nombreMes);
      actualizarHojaResumenAnual(ss);

      return responderJson({ ok: true, deleted: gastoBorrado, stats: statsAfterUndo });
    }

    // 3. COMANDO EDIT (/editar): Modificar el último gasto registrado
    if (data.action === "edit") {
      var lastRowEdit = obtenerUltimaFilaGastos(sheet);
      if (lastRowEdit <= 1) {
        var statsEmptyEdit = actualizarPanelResumenMes(sheet, nombreMes);
        return responderJson({ ok: false, message: "No hay gastos previos para editar en este mes.", stats: statsEmptyEdit });
      }

      var actual = sheet.getRange(lastRowEdit, 1, 1, 8).getValues()[0];
      var nuevoMonto = (data.monto && data.monto > 0) ? data.monto : actual[5];
      var nuevoComercio = (data.comercio && data.comercio !== "Desconocido" && data.comercio !== "Varios") ? data.comercio : actual[3];
      var nuevoDetalle = (data.detalle && data.detalle !== "Sin detalle" && data.detalle !== "Gasto registrado") ? data.detalle : actual[4];
      var nuevaCategoria = (data.categoria && data.categoria !== "Otros") ? data.categoria : actual[6];

      sheet.getRange(lastRowEdit, 4, 1, 4).setValues([[nuevoComercio, nuevoDetalle, nuevoMonto, nuevaCategoria]]);
      sheet.getRange(lastRowEdit, 6).setNumberFormat("$ #,##0");

      var statsAfterEdit = actualizarPanelResumenMes(sheet, nombreMes);
      actualizarHojaResumenAnual(ss);

      return responderJson({
        ok: true,
        previousMonto: actual[5],
        updated: {
          persona: actual[2],
          comercio: nuevoComercio,
          detalle: nuevoDetalle,
          monto: nuevoMonto,
          categoria: nuevaCategoria
        },
        stats: statsAfterEdit
      });
    }

    // 4. CONSULTAR RESUMEN EN VIVO
    if (data.action === "summary") {
      var statsCurrent = actualizarPanelResumenMes(sheet, nombreMes);
      return responderJson({ ok: true, stats: statsCurrent });
    }

    // 5. AGREGAR NUEVO GASTO
    if (data.monto !== undefined) {
      var targetRow = obtenerUltimaFilaGastos(sheet) + 1;
      sheet.getRange(targetRow, 1, 1, 8).setValues([[
        data.fecha,
        data.hora,
        data.persona,
        data.comercio,
        data.detalle,
        data.monto,
        data.categoria,
        data.mensajeOriginal
      ]]);
      sheet.getRange(targetRow, 6).setNumberFormat("$ #,##0");

      var statsNew = actualizarPanelResumenMes(sheet, nombreMes);
      actualizarHojaResumenAnual(ss);

      return responderJson({ ok: true, stats: statsNew });
    }

    return responderJson({ ok: true });
  } catch (error) {
    return responderJson({ ok: false, error: error.message });
  }
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var nombreMes = obtenerNombreMes(null);
    var sheet = obtenerOCrearHojaMes(ss, nombreMes);
    var stats = actualizarPanelResumenMes(sheet, nombreMes);
    return responderJson({ ok: true, status: "Economitin Webhook Activo con Suma, Deshacer y Editar", stats: stats });
  } catch (err) {
    return ContentService.createTextOutput("Economitin Webhook Activo");
  }
}
