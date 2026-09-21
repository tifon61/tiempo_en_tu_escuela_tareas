/**
 * Pegá acá la URL del Web App de Google Apps Script del backend de QC
 * después de desplegarlo (ver apps-script-qc/README.md). Tiene que
 * terminar en /exec. Mientras esto quede vacío, la sección de Control de
 * Calidad del Laboratorio de Análisis queda deshabilitada (el resto del
 * informe funciona igual).
 */
const QC_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzwho5UwhIyZi3w6BelIMyTTkYVCyq3TQZIh6veYRzADrdWueQonQX0FMDyO8wWztTL/exec";

/**
 * Tiene que coincidir con la Script Property TOKEN que configures en ESE
 * proyecto de Apps Script (es un backend separado del de observaciones,
 * puede tener su propio token distinto).
 */
const QC_APPS_SCRIPT_TOKEN = "Pagina1emaverde";
