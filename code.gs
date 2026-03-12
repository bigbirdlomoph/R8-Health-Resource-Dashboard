/**
 * R8 Health Resource Dashboard
 * Performance Edition: Server Cache (split keys) + LockService + Admin Cache Clear
 */

const SPREADSHEET_ID = '1PMdzm4Not07JIqL9sf_pW_v87kKsKzLh5S7I_b4QdnE';
const VERSION = '690310-1030'; // เพิ่ม Service Delivery module
const CACHE_TTL_SEC = 180;

function doGet() {
    const t = HtmlService.createTemplateFromFile('index');
    t.version = VERSION;
    return t.evaluate()
        .setTitle('R8 Health Resource Dashboard (v.' + VERSION + ')')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDashboardData() {
    const cache = CacheService.getScriptCache();
    const bundleKey = `R8:${VERSION}:bundle`;

    function getBundledDataStr() {
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
                if (!part) return null;
                fullStr += part;
            }
            return fullStr;
        } catch (e) {
            return null;
        }
    }

    const cachedStr = getBundledDataStr();
    if (cachedStr) return cachedStr;

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        const cachedStr2 = getBundledDataStr();
        if (cachedStr2) return cachedStr2;

        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const hospital = ss.getSheetByName('hospital').getDataRange().getValues();
        const population = ss.getSheetByName('population').getDataRange().getValues();
        const sap = ss.getSheetByName('sap_level').getDataRange().getValues();
        const medical = ss.getSheetByName('medical').getDataRange().getValues();
        const bed = ss.getSheetByName('bed').getDataRange().getValues();
        const hospital_structure = ss.getSheetByName('hospital_structure').getDataRange().getValues();
        const meqsp = ss.getSheetByName('m_eq_sp').getDataRange().getValues();
        const msp = ss.getSheetByName('m_sp').getDataRange().getValues();

        const meqmophRaw = ss.getSheetByName('m_eq_moph').getDataRange().getValues();
        const meqmoph = meqmophRaw.map(r => [null, null, null, r[3], r[4], null, r[6]]);

        // Service Delivery sheets
        const msd = ss.getSheetByName('m_sd').getDataRange().getValues();
        const cspsd = ss.getSheetByName('c_sp_sd').getDataRange().getValues();
        const csdcriteria = ss.getSheetByName('c_sd_criteria').getDataRange().getValues();
        const csdmethod = ss.getSheetByName('c_sd_method').getDataRange().getValues();

        let lastUpdatedISO = new Date().toISOString();
        try { lastUpdatedISO = DriveApp.getFileById(SPREADSHEET_ID).getLastUpdated().toISOString(); } catch (e) { }

        const payload = {
            status: 'success',
            data: { hospital, population, sap, medical, bed, hospital_structure, meqsp, msp, meqmoph, msd, cspsd, csdcriteria, csdmethod },
            meta: { version: VERSION, lastUpdated: lastUpdatedISO }
        };

        const payloadStr = JSON.stringify(payload);

        try {
            // ปรับ Chunk Size ลงเหลือ 40,000 เพื่อไม่ให้เกินข้อจำกัด 100KB ของ Google Cache (ป้องกันโหลดค้าง)
            const chunkSize = 40000;
            const numChunks = Math.ceil(payloadStr.length / chunkSize);
            const toCache = {};
            toCache[`${bundleKey}:count`] = numChunks.toString();
            for (let i = 0; i < numChunks; i++) {
                toCache[`${bundleKey}:${i}`] = payloadStr.substring(i * chunkSize, (i + 1) * chunkSize);
            }
            cache.putAll(toCache, CACHE_TTL_SEC);
        } catch (e) { }

        // คืนค่าเป็น String ป้องกัน Google Script Crash
        return payloadStr;

    } catch (error) {
        return JSON.stringify({ status: 'error', message: error.toString() });
    } finally {
        lock.releaseLock();
    }
}

function clearDashboardCache() {
    const cache = CacheService.getScriptCache();
    cache.remove(`R8:${VERSION}:bundle:count`);
    return { status: 'success' };
}

function addEquipmentRecord(record) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_eq_sp');
        sheet.appendRow([
            record.year, record.sp, record.prov, record.hosp, record.item, record.price, record.qty, record.amt, record.fundSrc, record.itemCode, record.priority, record.provPriority
        ]);
        clearDashboardCache();
        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

function editEquipmentRecord(record) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_eq_sp');
        const rowIdx = parseInt(record.rowIdx, 10);
        if (!rowIdx || rowIdx < 2) throw new Error("Invalid Row Index");
        const range = sheet.getRange(rowIdx, 1, 1, 12);
        range.setValues([[
            record.year, record.sp, record.prov, record.hosp, record.item, record.price, record.qty, record.amt, record.fundSrc, record.itemCode, record.priority, record.provPriority
        ]]);
        clearDashboardCache();
        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * Batch upsert Service Delivery records (wide format)
 * records = [{hosp_name, sd_code, value}, ...]
 */
function batchEditSdRecords(records) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(15000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_sd');
        const data = sheet.getDataRange().getValues();
        const headers = data[0].map(h => String(h || '').trim());

        // Find hospital name column
        const hospCol = headers.findIndex(h => h.includes('โรงพยาบาล') || h.includes('ชื่อ'));
        if (hospCol === -1) throw new Error('ไม่พบคอลัมน์ชื่อโรงพยาบาลใน m_sd');

        // Build row lookup: hospName -> row number (1-based)
        const rowMap = {};
        for (let i = 1; i < data.length; i++) {
            const name = String(data[i][hospCol] || '').trim();
            if (name) rowMap[name] = i + 1;
        }

        // Build column lookup: sdCode -> column number (1-based)
        const colMap = {};
        headers.forEach((h, i) => { colMap[h] = i + 1; });

        records.forEach(r => {
            const rowNum = rowMap[String(r.hosp_name).trim()];
            const colNum = colMap[String(r.sd_code).trim()];
            if (rowNum && colNum) {
                sheet.getRange(rowNum, colNum).setValue(r.value);
            }
        });

        clearDashboardCache();
        return { status: 'success', updated: records.length };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}
