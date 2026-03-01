/**
 * R8 Health Resource Dashboard
 * Performance Edition: Server Cache (split keys) + LockService + Admin Cache Clear
 */

const SPREADSHEET_ID = '1PMdzm4Not07JIqL9sf_pW_v87kKsKzLh5S7I_b4QdnE';

// เปลี่ยนเลขเวอร์ชันที่นี่ที่เดียว
const VERSION = '690228-1725'; // อัปเดตเพื่อล้างแคชให้ข้อมูล SP ใหม่ปรากฏ


// ปรับได้ตามรอบอัปเดตข้อมูลจริง (สำหรับ 100+ concurrent แนะนำ 60–300s)
const CACHE_TTL_SEC = 180;

function doGet() {
    const t = HtmlService.createTemplateFromFile('index');
    t.version = VERSION;

    return t.evaluate()
        .setTitle('R8 Health Resource Dashboard (v.' + VERSION + ')')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Add include function for script/style injection
function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDashboardData() {
    const cache = CacheService.getScriptCache();
    const bundleKey = `R8:${VERSION}:bundle`;

    // Fast Path Helper
    function getBundledData() {
        try {
            const chunkCountStr = cache.get(`${bundleKey}:count`);
            if (!chunkCountStr) return null;

            const numChunks = parseInt(chunkCountStr, 10);
            const keysToGet = [];
            for (let i = 0; i < numChunks; i++) keysToGet.push(`${bundleKey}:${i}`);

            const chunksObj = cache.getAll(keysToGet);
            let fullStr = '';
            for (let i = 0; i < numChunks; i++) {
                const part = chunksObj[`${bundleKey}:${i}`];
                if (!part) return null; // Cache incomplete
                fullStr += part;
            }
            return JSON.parse(fullStr);
        } catch (e) {
            return null;
        }
    }

    const cachedPayload = getBundledData();
    if (cachedPayload) return cachedPayload;

    // Prevent cache stampede
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);

    try {
        // Double-check after lock
        const cachedPayload2 = getBundledData();
        if (cachedPayload2) return cachedPayload2;

        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

        const hospital = ss.getSheetByName('hospital').getDataRange().getValues();
        const population = ss.getSheetByName('population').getDataRange().getValues();
        const sap = ss.getSheetByName('sap_level').getDataRange().getValues();
        const medical = ss.getSheetByName('medical').getDataRange().getValues();

        const bed = ss.getSheetByName('bed').getDataRange().getValues();
        const hospital_structure = ss.getSheetByName('hospital_structure').getDataRange().getValues();
        const meqsp = ss.getSheetByName('m_eq_sp').getDataRange().getValues();
        const msp = ss.getSheetByName('m_sp').getDataRange().getValues();

        // OPTIMIZE: Only keep necessary columns from meqmoph to save payload size (D, E, & G)
        const meqmophRaw = ss.getSheetByName('m_eq_moph').getDataRange().getValues();
        const meqmoph = meqmophRaw.map(r => [null, null, null, r[3], r[4], null, r[6]]);

        // lastUpdated
        let lastUpdatedISO = new Date().toISOString();
        try { lastUpdatedISO = DriveApp.getFileById(SPREADSHEET_ID).getLastUpdated().toISOString(); } catch (e) { }

        const payload = {
            status: 'success',
            data: { hospital, population, sap, medical, bed, hospital_structure, meqsp, msp, meqmoph },
            meta: { version: VERSION, lastUpdated: lastUpdatedISO }
        };

        // Put to cache using chunks
        try {
            const payloadStr = JSON.stringify(payload);
            const chunkSize = 90000;
            const numChunks = Math.ceil(payloadStr.length / chunkSize);

            const toCache = {};
            toCache[`${bundleKey}:count`] = numChunks.toString();
            for (let i = 0; i < numChunks; i++) {
                toCache[`${bundleKey}:${i}`] = payloadStr.substring(i * chunkSize, (i + 1) * chunkSize);
            }
            cache.putAll(toCache, CACHE_TTL_SEC);
        } catch (e) { /* ignore cache errors */ }

        return payload;

    } catch (error) {
        return { status: 'error', message: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

// Admin: Clear server cache immediately (used by navbar refresh button)
function clearDashboardCache() {
    const cache = CacheService.getScriptCache();
    cache.remove(`R8:${VERSION}:bundle:count`);
    return { status: 'success' };
}

// Function to add new equipment record
function addEquipmentRecord(record) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_eq_sp');

        sheet.appendRow([
            record.year,
            record.sp,
            record.prov,
            record.hosp,
            record.item,
            record.price,
            record.qty,
            record.amt,
            record.fundSrc,
            record.itemCode,
            record.priority,
            record.provPriority
        ]);

        clearDashboardCache();
        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// Function to edit existing equipment record
function editEquipmentRecord(record) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_eq_sp');

        const rowIdx = parseInt(record.rowIdx, 10);
        if (!rowIdx || rowIdx < 2) throw new Error("Invalid Row Index");

        const range = sheet.getRange(rowIdx, 1, 1, 12); // Assuming Col A to L
        range.setValues([[
            record.year,
            record.sp,
            record.prov,
            record.hosp,
            record.item,
            record.price,
            record.qty,
            record.amt,
            record.fundSrc,
            record.itemCode,
            record.priority,
            record.provPriority
        ]]);

        clearDashboardCache();
        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// Helper: generate stable VERSION format "YYMMDD-HHMM" in Buddhist year (2 digits)
function genStableVersion_(dateObj) {
    const tz = Session.getScriptTimeZone() || "Asia/Bangkok";
    const d = dateObj || new Date();

    const buddhistYY = String(d.getFullYear() + 543).slice(-2);
    const mmdd = Utilities.formatDate(d, tz, "MMdd");
    const hhmm = Utilities.formatDate(d, tz, "HHmm");

    return `${buddhistYY}${mmdd}-${hhmm}`;
}

// Run this when you're ready to deploy stable, then copy the output into const VERSION
function printNextStableVersion() {
    const v = genStableVersion_(new Date());
    Logger.log("NEXT_STABLE_VERSION = " + v);
    return v;
}

// Temporary Debug Function for Medical Headers
function printMedicalHeaders() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('medical');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    Logger.log("MEDICAL HEADERS: " + JSON.stringify(headers));
    return headers;
}
