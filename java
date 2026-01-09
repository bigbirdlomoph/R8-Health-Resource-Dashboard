/**
 * Google Apps Script สำหรับดึงข้อมูลทรัพยากรสุขภาพ เขต 8
 */

const SPREADSHEET_ID = '1PMdzm4Not07JIqL9sf_pW_v87kKsKzLh5S7I_b4QdnE';
const SHEET_NAME = 'R8HealthResource';

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('R8 Health Resource Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDashboardData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error(`ไม่พบแผ่นงานชื่อ "${SHEET_NAME}"`);
    const data = sheet.getDataRange().getValues();
    return { status: 'success', data: data };
  } catch (error) {
    return { status: 'error', message: error.toString() };
  }
}
