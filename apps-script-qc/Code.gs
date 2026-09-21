/**
 * Backend de Google Apps Script para el Control de Calidad (QC) y el
 * Historial de Mantenimiento del Laboratorio de Análisis de EMAs
 * (informe-verde.html).
 *
 * Es un backend INDEPENDIENTE del que usa el módulo de observaciones
 * (apps-script/Code.gs) — Sheet propia, deployment propio, token propio.
 *
 * Guarda dos cosas, en dos hojas separadas de la misma Sheet:
 * - QC_EMAs: qué lecturas puntuales de las EMAs (Verde/Blanca/Campbell/Daza)
 *   se marcaron como anómalas, para excluirlas del análisis.
 * - Mantenimiento_EMAs: intervenciones registradas sobre cada estación
 *   (recalibración, cambio de sensor, limpieza, mudanza, etc.), para poder
 *   explicar saltos o cambios de comportamiento en los gráficos.
 *
 * Expone un GET para que el informe lea ambas cosas y las aplique/muestre.
 *
 * Instrucciones de despliegue: ver apps-script-qc/README.md
 */

var SHEET_NAME = "QC_EMAs";
var SHEET_MANTENIMIENTO = "Mantenimiento_EMAs";

// Token compartido simple (mismo mecanismo que apps-script/Code.gs). Se
// configura en Project Settings > Script Properties (clave TOKEN).
function getToken_() {
  return PropertiesService.getScriptProperties().getProperty("TOKEN") || "";
}

// Columnas de la Sheet, en orden.
var COLUMNAS = [
  { key: "estacion", header: "Estación" },       // verde | blanca | campbell | daza
  { key: "variable", header: "Variable" },        // temp | hum | pres | lluvia
  { key: "timestampIso", header: "Timestamp (ISO)" }, // instante exacto de la lectura original marcada
  { key: "valor", header: "Valor original" },
  { key: "motivo", header: "Motivo" },
  { key: "marcadoPor", header: "Marcado por" },
  { key: "fechaMarcado", header: "Fecha de marcado" },
];

// Columnas de la hoja de mantenimiento, en orden.
var COLUMNAS_MANTENIMIENTO = [
  { key: "estacion", header: "Estación" },     // verde | blanca | campbell | daza | general
  { key: "fecha", header: "Fecha" },            // YYYY-MM-DD, fecha de la intervención
  { key: "tipo", header: "Tipo" },              // Recalibración | Reemplazo de sensor | Limpieza | Mudanza/Reubicación | Instalación | Otro
  { key: "descripcion", header: "Descripción" },
  { key: "cargadoPor", header: "Cargado por" },
  { key: "fechaCarga", header: "Fecha de carga" },
];

function getSheetGenerica_(nombre, columnas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(columnas.map(function (c) { return c.header; }));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSheet_() {
  return getSheetGenerica_(SHEET_NAME, COLUMNAS);
}

function getSheetMantenimiento_() {
  return getSheetGenerica_(SHEET_MANTENIMIENTO, COLUMNAS_MANTENIMIENTO);
}

function claveFila_(estacion, variable, timestampIso) {
  return estacion + "|" + variable + "|" + timestampIso;
}

// Devuelve un mapa clave->numeroDeFila (1-indexado) de todo lo que ya está
// marcado, para no duplicar ni tener que recorrer la Sheet por cada punto.
function indiceExistente_(sheet) {
  var valores = sheet.getDataRange().getValues();
  var colEstacion = COLUMNAS.findIndex(function (c) { return c.key === "estacion"; });
  var colVariable = COLUMNAS.findIndex(function (c) { return c.key === "variable"; });
  var colTs = COLUMNAS.findIndex(function (c) { return c.key === "timestampIso"; });
  var indice = {};
  for (var i = 1; i < valores.length; i++) {
    var clave = claveFila_(valores[i][colEstacion], valores[i][colVariable], valores[i][colTs]);
    indice[clave] = i + 1; // fila real en la Sheet (1-indexada)
  }
  return indice;
}

// Marca uno o varios puntos como anómalos. body.puntos: array de
// { estacion, variable, timestampIso, valor, motivo }. body.marcadoPor: opcional.
function marcarPuntos_(body) {
  var puntos = body.puntos;
  if (!Array.isArray(puntos) || puntos.length === 0) {
    return { ok: false, error: "No se recibió ningún punto para marcar." };
  }

  var sheet = getSheet_();
  var indice = indiceExistente_(sheet);
  var ahora = new Date().toISOString();
  var filasNuevas = [];
  var yaMarcados = 0;

  puntos.forEach(function (p) {
    if (!p.estacion || !p.variable || !p.timestampIso) return;
    var clave = claveFila_(p.estacion, p.variable, p.timestampIso);
    if (indice[clave]) { yaMarcados++; return; } // ya estaba marcado, no duplicar

    filasNuevas.push([
      p.estacion,
      p.variable,
      p.timestampIso,
      p.valor != null ? p.valor : "",
      p.motivo || "",
      body.marcadoPor || "",
      ahora,
    ]);
  });

  if (filasNuevas.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, filasNuevas.length, COLUMNAS.length).setValues(filasNuevas);
  }

  return { ok: true, marcados: filasNuevas.length, yaMarcados: yaMarcados };
}

// Desmarca (elimina la fila de) un punto. body: { estacion, variable, timestampIso }.
function desmarcarPunto_(body) {
  if (!body.estacion || !body.variable || !body.timestampIso) {
    return { ok: false, error: "Faltan estacion/variable/timestampIso para identificar el punto." };
  }
  var sheet = getSheet_();
  var indice = indiceExistente_(sheet);
  var clave = claveFila_(body.estacion, body.variable, body.timestampIso);
  var fila = indice[clave];
  if (!fila) {
    return { ok: false, error: "Ese punto no estaba marcado." };
  }
  sheet.deleteRow(fila);
  return { ok: true };
}

// Registra una intervención de mantenimiento. body: { estacion, fecha, tipo,
// descripcion, cargadoPor }.
function agregarMantenimiento_(body) {
  if (!body.estacion || !body.fecha || !body.tipo) {
    return { ok: false, error: "Faltan estacion/fecha/tipo para registrar la intervención." };
  }
  var sheet = getSheetMantenimiento_();
  var fila = [
    body.estacion,
    body.fecha,
    body.tipo,
    body.descripcion || "",
    body.cargadoPor || "",
    new Date().toISOString(),
  ];
  sheet.appendRow(fila);
  return { ok: true, fila: fila };
}

// Elimina una intervención de mantenimiento por número de fila (1-indexado,
// tal cual lo devuelve el GET en "_fila"). Solo para corregir cargas erróneas.
function borrarMantenimiento_(body) {
  var numeroFila = parseInt(body.fila, 10);
  if (!numeroFila || numeroFila < 2) {
    return { ok: false, error: "Falta un número de fila válido para borrar." };
  }
  var sheet = getSheetMantenimiento_();
  if (numeroFila > sheet.getLastRow()) {
    return { ok: false, error: "No existe esa fila." };
  }
  sheet.deleteRow(numeroFila);
  return { ok: true };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function jsonpOut_(obj, callback) {
  var body = callback ? callback + "(" + JSON.stringify(obj) + ");" : JSON.stringify(obj);
  return ContentService.createTextOutput(body).setMimeType(
    callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON
  );
}

// ---- Endpoints ----

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var expectedToken = getToken_();
    if (expectedToken && body.token !== expectedToken) {
      return jsonOut_({ ok: false, error: "Token inválido." });
    }

    if (body.accion === "desmarcar") {
      return jsonOut_(desmarcarPunto_(body));
    }
    if (body.accion === "agregar_mantenimiento") {
      return jsonOut_(agregarMantenimiento_(body));
    }
    if (body.accion === "borrar_mantenimiento") {
      return jsonOut_(borrarMantenimiento_(body));
    }
    // Por defecto (o accion === "marcar"): marcar uno o varios puntos.
    return jsonOut_(marcarPuntos_(body));
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

// GET: por defecto devuelve los puntos de QC marcados (opcionalmente
// filtrados por estacion/variable), igual que antes. Con
// ?recurso=mantenimiento devuelve el historial de intervenciones en su
// lugar. Formato JSONP si viene ?callback=... (igual que el otro backend),
// porque GitHub Pages + Apps Script no siempre negocian bien CORS para GET
// con fetch() directo en todos los navegadores.
function doGet(e) {
  var callback = e.parameter.callback;
  try {
    var expectedToken = getToken_();
    if (expectedToken && e.parameter.token !== expectedToken) {
      return jsonpOut_({ ok: false, error: "Token inválido." }, callback);
    }

    if (e.parameter.recurso === "mantenimiento") {
      var sheetM = getSheetMantenimiento_();
      var valoresM = sheetM.getDataRange().getValues();
      var eventos = [];
      for (var j = 1; j < valoresM.length; j++) {
        var filaM = valoresM[j];
        var objM = { _fila: j + 1 };
        COLUMNAS_MANTENIMIENTO.forEach(function (c, idx) { objM[c.key] = filaM[idx]; });
        if (e.parameter.estacion && objM.estacion !== e.parameter.estacion) continue;
        eventos.push(objM);
      }
      return jsonpOut_({ ok: true, eventos: eventos }, callback);
    }

    var sheet = getSheet_();
    var valores = sheet.getDataRange().getValues();
    var puntos = [];
    for (var i = 1; i < valores.length; i++) {
      var fila = valores[i];
      var obj = {};
      COLUMNAS.forEach(function (c, idx) { obj[c.key] = fila[idx]; });
      if (e.parameter.estacion && obj.estacion !== e.parameter.estacion) continue;
      if (e.parameter.variable && obj.variable !== e.parameter.variable) continue;
      puntos.push(obj);
    }
    return jsonpOut_({ ok: true, puntos: puntos }, callback);
  } catch (err) {
    return jsonpOut_({ ok: false, error: String(err) }, callback);
  }
}
